import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePositions,
  reconcileHoldings,
  applyReconcile,
  normalizeSavings,
  reconcileSavings,
  applySavingsReconcile,
} from '../src/utils/statementReconcile.js'

let seq = 0
const newId = () => `id${++seq}`
const freshIds = () => { seq = 0 }

function holding(over = {}) {
  const shares = over.shares ?? 10
  return {
    id: over.id ?? 'h-nvda',
    ticker: over.ticker ?? 'NVDA',
    shares,
    purchasePrice: over.purchasePrice ?? 100,
    purchaseDate: over.purchaseDate ?? '2024-03-01',
    accountType: over.accountType ?? 'TFSA',
    purchases: over.purchases ?? [
      { id: 'lot-a', shares, purchasePrice: over.purchasePrice ?? 100, purchaseDate: over.purchaseDate ?? '2024-03-01' },
    ],
  }
}

const rowFor = (plan, ticker) => plan.rows.find(r => r.ticker === ticker)

// ── normalizePositions ──────────────────────────────────────────────────────────────────────────

test('a position with no ticker or no shares is dropped', () => {
  const out = normalizePositions([
    { ticker: '', shares: 10 },
    { ticker: 'AAPL', shares: 0 },
    { ticker: 'MSFT', shares: null },
    { ticker: 'VOO', shares: 5, costBasis: 500 },
  ])
  assert.deepEqual(out.map(p => p.ticker), ['VOO'])
})

test('a repeated ticker across page batches keeps the first reading', () => {
  const out = normalizePositions([
    { ticker: 'nvda', shares: 40, costBasis: 26700 },
    { ticker: 'NVDA', shares: 999, costBasis: 1 },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].shares, 40)
  assert.equal(out[0].ticker, 'NVDA')
})

test('a missing cost basis stays null rather than becoming the market value', () => {
  const [position] = normalizePositions([{ ticker: 'VTI', shares: 20, marketValue: 3600 }])
  assert.equal(position.costBasis, null, 'a fabricated cost would record a zero gain as fact')
  assert.equal(position.marketValue, 3600)
})

// ── reconcileHoldings ───────────────────────────────────────────────────────────────────────────

test('a ticker the account has never held is an add', () => {
  const plan = reconcileHoldings({
    holdings: [],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'VOO', shares: 35, costBasis: 24100 }]),
  })
  assert.equal(rowFor(plan, 'VOO').action, 'add')
  assert.equal(rowFor(plan, 'VOO').prevShares, null)
  assert.deepEqual(plan.counts, { added: 1, updated: 0, unchanged: 0, removed: 0 })
})

test('a changed share count is an update, and carries what it was', () => {
  const plan = reconcileHoldings({
    holdings: [holding({ shares: 35 })],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 40, costBasis: 4200 }]),
  })
  const row = rowFor(plan, 'NVDA')
  assert.equal(row.action, 'update')
  assert.equal(row.prevShares, 35)
  assert.equal(row.prevCostBasis, 3500)
  assert.equal(row.avgCost, 105)
})

test('re-running the same statement reports every position unchanged', () => {
  const holdings = [holding({ shares: 40, purchasePrice: 667.5 })]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-08-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 40, costBasis: 26700 }]),
  })
  assert.deepEqual(plan.counts, { added: 0, updated: 0, unchanged: 1, removed: 0 })
})

test('an unchanged plan writes nothing at all', () => {
  freshIds()
  const holdings = [holding({ shares: 40, purchasePrice: 667.5 })]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-08-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 40, costBasis: 26700 }]),
  })
  const result = applyReconcile(holdings, plan.rows, { newId })
  assert.deepEqual(result.purchaseIds, [])
  assert.deepEqual(result.holdings, holdings, 'a second upload of one statement is a no-op')
})

test('a stored position the statement omits is proposed for removal', () => {
  const plan = reconcileHoldings({
    holdings: [holding(), holding({ id: 'h-intc', ticker: 'INTC', shares: 90 })],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 10, costBasis: 1000 }]),
  })
  const removed = rowFor(plan, 'INTC')
  assert.equal(removed.action, 'remove')
  assert.equal(removed.prevShares, 90)
  assert.equal(plan.counts.removed, 1)
})

test('an unticked removal leaves the holding alone', () => {
  freshIds()
  const holdings = [holding(), holding({ id: 'h-intc', ticker: 'INTC', shares: 90 })]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 10, costBasis: 1000 }]),
  })
  const kept = plan.rows.filter(r => r.action !== 'remove')
  const result = applyReconcile(holdings, kept, { newId })
  assert.ok(result.holdings.some(h => h.ticker === 'INTC'), 'one statement need not cover the account')
})

test('holdings under another account type are never read and never written', () => {
  freshIds()
  const holdings = [
    holding({ id: 'tfsa-nvda' }),
    holding({ id: 'rrsp-voo', ticker: 'VOO', accountType: 'RRSP', shares: 35, purchasePrice: 688 }),
  ]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 10, costBasis: 1000 }]),
  })
  assert.equal(plan.rows.length, 1, 'the RRSP position is not even considered for removal')
  const { holdings: next } = applyReconcile(holdings, plan.rows, { newId })
  assert.deepEqual(next.find(h => h.id === 'rrsp-voo'), holdings[1])
})

test('a ticker held in two accounts is matched within the named one only', () => {
  const holdings = [
    holding({ id: 'tfsa-nvda', shares: 10 }),
    holding({ id: 'rrsp-nvda', accountType: 'RRSP', shares: 99 }),
  ]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'RRSP',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 99, costBasis: 9900 }]),
  })
  assert.equal(rowFor(plan, 'NVDA').holdingId, 'rrsp-nvda')
  assert.equal(rowFor(plan, 'NVDA').prevShares, 99)
})

// ── The purchaseDate rule ───────────────────────────────────────────────────────────────────────

test('an existing position keeps its earliest lot date, not the statement date', () => {
  const plan = reconcileHoldings({
    holdings: [holding({
      shares: 30,
      purchases: [
        { id: 'l1', shares: 10, purchasePrice: 100, purchaseDate: '2023-05-04' },
        { id: 'l2', shares: 20, purchasePrice: 120, purchaseDate: '2025-02-11' },
      ],
    })],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 40, costBasis: 5000 }]),
  })
  assert.equal(
    rowFor(plan, 'NVDA').purchaseDate,
    '2023-05-04',
    'net worth history includes a lot only when purchaseDate <= asOf; re-dating erases the past',
  )
})

test('a position the app has never seen is dated by the statement', () => {
  const plan = reconcileHoldings({
    holdings: [],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'VOO', shares: 35, costBasis: 24100 }]),
  })
  assert.equal(rowFor(plan, 'VOO').purchaseDate, '2026-07-31')
})

test('a pre-lots holding falls back to its own purchaseDate', () => {
  const plan = reconcileHoldings({
    holdings: [{ id: 'legacy', ticker: 'NVDA', shares: 5, purchasePrice: 50, purchaseDate: '2022-01-09', accountType: 'TFSA' }],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 8, costBasis: 900 }]),
  })
  assert.equal(rowFor(plan, 'NVDA').purchaseDate, '2022-01-09')
})

// ── applyReconcile ──────────────────────────────────────────────────────────────────────────────

test('a position collapses to one lot at its average cost', () => {
  freshIds()
  const holdings = [holding({
    shares: 30,
    purchases: [
      { id: 'l1', shares: 10, purchasePrice: 100, purchaseDate: '2023-05-04' },
      { id: 'l2', shares: 20, purchasePrice: 120, purchaseDate: '2025-02-11' },
    ],
  })]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 40, costBasis: 5000 }]),
  })
  const { holdings: next, purchaseIds } = applyReconcile(holdings, plan.rows, { newId })
  const stored = next[0]
  assert.equal(stored.purchases.length, 1)
  assert.equal(stored.shares, 40)
  assert.equal(stored.purchasePrice, 125)
  assert.equal(stored.purchaseDate, '2023-05-04')
  assert.deepEqual(purchaseIds, [stored.purchases[0].id])
})

test('an added position becomes a new holding with its own lot', () => {
  freshIds()
  const plan = reconcileHoldings({
    holdings: [],
    accountType: 'Roth IRA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'VTI', shares: 20, costBasis: 3150 }]),
  })
  const { holdings: next, purchaseIds } = applyReconcile([], plan.rows, { newId })
  assert.equal(next.length, 1)
  assert.equal(next[0].accountType, 'Roth IRA')
  assert.equal(next[0].purchasePrice, 157.5)
  assert.equal(purchaseIds.length, 1)
  assert.equal(next[0].purchases[0].id, purchaseIds[0])
})

test('an approved removal drops the holding entirely', () => {
  freshIds()
  const holdings = [holding(), holding({ id: 'h-intc', ticker: 'INTC', shares: 90 })]
  const plan = reconcileHoldings({
    holdings,
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'NVDA', shares: 10, costBasis: 1000 }]),
  })
  const { holdings: next } = applyReconcile(holdings, plan.rows, { newId })
  assert.deepEqual(next.map(h => h.ticker), ['NVDA'])
})

test('a row with no cost basis is refused even if the UI let it through', () => {
  freshIds()
  const plan = reconcileHoldings({
    holdings: [],
    accountType: 'TFSA',
    statementDate: '2026-07-31',
    positions: normalizePositions([{ ticker: 'VTI', shares: 20, marketValue: 3600 }]),
  })
  assert.equal(rowFor(plan, 'VTI').needsCostBasis, true)
  assert.throws(
    () => applyReconcile([], plan.rows, { newId }),
    /VTI has no cost basis/,
    'the disabled button is a courtesy; this is the guarantee',
  )
})

test('a row with no date to record it under is refused', () => {
  freshIds()
  const plan = reconcileHoldings({
    holdings: [],
    accountType: 'TFSA',
    statementDate: null,
    positions: normalizePositions([{ ticker: 'VTI', shares: 20, costBasis: 3150 }]),
  })
  assert.throws(() => applyReconcile([], plan.rows, { newId }), /no date/)
})

test('applyReconcile refuses to run without an id factory', () => {
  assert.throws(() => applyReconcile([], []), /newId factory/)
})

test('an account name is required to reconcile anything', () => {
  assert.throws(() => reconcileHoldings({ accountType: '   ', positions: [] }), /account type is required/)
})

// ── Savings ─────────────────────────────────────────────────────────────────────────────────────

test('a savings account is matched by name, ignoring case and padding', () => {
  const { rows } = reconcileSavings({
    accounts: [{ id: 's1', name: 'Marcus HYSA', accountType: 'HYSA', balance: 10000, apy: 4.2 }],
    parsed: normalizeSavings([{ name: '  marcus hysa ', balance: 14300, apy: 4.2 }]),
  })
  assert.equal(rows[0].action, 'update')
  assert.equal(rows[0].accountId, 's1')
  assert.equal(rows[0].prevBalance, 10000)
})

test('an unrecognised account name is added rather than merged into a neighbour', () => {
  const { rows, counts } = reconcileSavings({
    accounts: [{ id: 's1', name: 'Marcus HYSA', balance: 10000, apy: 4.2 }],
    parsed: normalizeSavings([{ name: 'Ally 12-mo CD', accountType: 'CD / GIC', balance: 7000, apy: 3.8 }]),
  })
  assert.equal(rows[0].action, 'add')
  assert.deepEqual(counts, { added: 1, updated: 0, unchanged: 0 })
})

test('a statement with no printed rate keeps the rate already stored', () => {
  const { rows } = reconcileSavings({
    accounts: [{ id: 's1', name: 'EQ Bank', balance: 5000, apy: 4.5 }],
    parsed: normalizeSavings([{ name: 'EQ Bank', balance: 6000 }]),
  })
  assert.equal(rows[0].apy, 4.5, 'silence about the rate must not wipe it to zero')
  assert.equal(rows[0].apyFromStatement, false)
  assert.equal(rows[0].action, 'update')
})

test('the same savings statement twice is unchanged', () => {
  const accounts = [{ id: 's1', name: 'EQ Bank', accountType: 'HYSA', balance: 6000, apy: 4.5 }]
  const { rows, counts } = reconcileSavings({
    accounts,
    parsed: normalizeSavings([{ name: 'EQ Bank', accountType: 'HYSA', balance: 6000, apy: 4.5 }]),
  })
  assert.equal(counts.unchanged, 1)
  freshIds()
  const result = applySavingsReconcile(accounts, rows, { newId })
  assert.deepEqual(result.accounts, accounts)
  assert.deepEqual(result.createdIds, [])
})

test('an account the statement never mentions is left completely alone', () => {
  freshIds()
  const accounts = [
    { id: 's1', name: 'EQ Bank', balance: 5000, apy: 4.5 },
    { id: 's2', name: 'Wealthsimple Cash', balance: 7000, apy: 3.1 },
  ]
  const { rows } = reconcileSavings({
    accounts,
    parsed: normalizeSavings([{ name: 'EQ Bank', balance: 6000, apy: 4.5 }]),
  })
  assert.equal(rows.length, 1, 'a savings statement covers one account; silence says nothing')
  const { accounts: next } = applySavingsReconcile(accounts, rows, { newId })
  assert.deepEqual(next.find(a => a.id === 's2'), accounts[1])
  assert.equal(next.find(a => a.id === 's1').balance, 6000)
})

test('a savings row with no name or a negative balance is dropped', () => {
  const out = normalizeSavings([
    { name: '', balance: 100 },
    { name: 'Overdrawn', balance: -5 },
    { name: 'Real', balance: 100 },
  ])
  assert.deepEqual(out.map(a => a.name), ['Real'])
})
