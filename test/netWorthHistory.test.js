import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_VERSION,
  valueHoldingsAsOf,
  cashAsOf,
  statementChecks,
  deriveOpeningBalance,
  ledgerCoverageEnd,
  savingsAsOf,
  buildEntry,
  monthEndDates,
  rebuildHistory,
} from '../server/netWorthHistory.js'

// The Dashboard's change-attribution waterfall splits a move in liquid net worth into "what you
// saved" and "what the markets did". That split is only defensible if history stores the market
// value and the cost basis separately at every point — the whole reason this module exists. These
// tests lock the identity the waterfall depends on:
//
//   Δportfolio = ΔportfolioCost + Δ(market − cost)
//
// If one of them fails, the waterfall is quietly attributing contributions to market performance
// (or the reverse), which is exactly the bug the redesign set out to fix.

const HOLDINGS = [
  // Single implicit lot, bought early.
  { ticker: 'AAA', shares: 10, purchasePrice: 10, purchaseDate: '2026-01-10' },
  // Explicit lots straddling the range, so `asOf` has to filter within a holding, not just across.
  {
    ticker: 'BBB',
    shares: 8,
    purchasePrice: 25,
    purchaseDate: '2026-03-05',
    purchases: [
      { shares: 5, purchasePrice: 20, purchaseDate: '2026-01-20' },
      { shares: 3, purchasePrice: 30, purchaseDate: '2026-03-05' },
    ],
  },
]

const PRICES = { '2026-01': { AAA: 12, BBB: 22 }, '2026-02': { AAA: 15, BBB: 24 } }
const priceOf = (ticker, yyyymm) => PRICES[yyyymm]?.[ticker] ?? null

test('holdings are valued at market and cost from the lots that existed on the date', () => {
  // End of January: AAA's single lot, and only BBB's first lot.
  const jan = valueHoldingsAsOf(HOLDINGS, '2026-01-31', priceOf)
  assert.equal(jan.cost, 10 * 10 + 5 * 20)          // 200
  assert.equal(jan.market, 10 * 12 + 5 * 22)        // 230
  assert.equal(jan.basis, 'market')

  // End of February: BBB's second lot still hasn't been bought.
  const feb = valueHoldingsAsOf(HOLDINGS, '2026-02-28', priceOf)
  assert.equal(feb.cost, 200)
  assert.equal(feb.market, 10 * 15 + 5 * 24)        // 270
})

test('a lot bought mid-range adds cost, not market return', () => {
  // This is the identity the waterfall rests on. Between Jan 31 and Mar 31 the portfolio grows by
  // both a purchase and a price move; the two must stay separable.
  const marchPrices = (ticker) => ({ AAA: 15, BBB: 24 }[ticker] ?? null)
  const jan = valueHoldingsAsOf(HOLDINGS, '2026-01-31', priceOf)
  const mar = valueHoldingsAsOf(HOLDINGS, '2026-03-31', (t) => marchPrices(t))

  const contributions = mar.cost - jan.cost
  const marketReturn = (mar.market - mar.cost) - (jan.market - jan.cost)

  assert.equal(contributions, 3 * 30)                       // the second BBB lot, at what was paid
  assert.equal(mar.market - jan.market, contributions + marketReturn)
})

test('an unpriceable ticker falls back to cost and downgrades the basis', () => {
  const partial = valueHoldingsAsOf(HOLDINGS, '2026-01-31', (t) => (t === 'AAA' ? 12 : null))
  // BBB contributes its cost, so it adds zero market return rather than vanishing.
  assert.equal(partial.market, 10 * 12 + 5 * 20)
  assert.equal(partial.basis, 'partial')

  const none = valueHoldingsAsOf(HOLDINGS, '2026-01-31', () => null)
  assert.equal(none.market, none.cost)
  assert.equal(none.basis, 'cost')

  // No holdings at all is 'cost' too: there is no market valuation to trust.
  assert.equal(valueHoldingsAsOf([], '2026-01-31', () => 5).basis, 'cost')
})

test('cash runs forward from the opening balance through the ledger', () => {
  const rows = [
    { date: '2026-01-05', amount: -50 },
    { date: '2026-02-10', amount: 500 },
    { date: '2026-02-20', amount: -200 },
  ]
  const opening = { date: '2026-01-01', amount: 1000 }
  assert.equal(cashAsOf({ opening, bankRows: rows }, '2026-01-31'), 950)
  assert.equal(cashAsOf({ opening, bankRows: rows }, '2026-02-28'), 1250)
  // The opening date itself predates every row, so it is the balance on that day.
  assert.equal(cashAsOf({ opening, bankRows: rows }, '2026-01-01'), 1000)
  // No anchor means no derivation — zero, not a guess from today.
  assert.equal(cashAsOf({ opening: null, bankRows: rows }, '2026-02-28'), 0)
})

test('a statement balance anchors cash without moving anything before it', () => {
  // The property the whole model exists for. A statement close is a figure the bank issued, so
  // cash IS that number on that date, and every earlier point stays where the ledger put it.
  const rows = [{ date: '2026-02-10', amount: 500 }, { date: '2026-04-10', amount: -100 }]
  const opening = { date: '2026-01-01', amount: 1000 }
  const sources = { opening, statementBalances: [], bankRows: rows }

  const janBefore = cashAsOf(sources, '2026-01-31')
  const after = { ...sources, statementBalances: [{ date: '2026-05-01', balance: 900 }] }

  assert.equal(cashAsOf(after, '2026-05-01'), 900, 'the anchor is the balance, exactly')
  assert.equal(cashAsOf(after, '2026-01-31'), janBefore, 'a May statement must not move January')
  assert.equal(cashAsOf(after, '2026-04-30'), 1400, 'points before the anchor stay on the ledger')
})

test('cash after the newest statement is the anchor plus rows the user added since', () => {
  // The only stretch that is derived rather than issued. A manually added expense moves it; that
  // is the one way cash changes without a new statement.
  const sources = {
    opening: { date: '2026-01-01', amount: 1000 },
    statementBalances: [{ date: '2026-03-31', balance: 2000 }],
    bankRows: [{ date: '2026-02-10', amount: 500 }, { date: '2026-04-10', amount: -120 }],
  }
  assert.equal(cashAsOf(sources, '2026-03-31'), 2000)
  assert.equal(cashAsOf(sources, '2026-04-30'), 1880)
})

test('a discrepancy is derived on read, so correcting the ledger corrects the report', () => {
  // The bug this model was written to kill. The previous design froze the gap at entry time; a
  // ledger fixed afterwards could not recompute it, and a $5,361 phantom outlived its cause.
  const balances = [{ date: '2026-02-28', balance: 1400 }, { date: '2026-03-31', balance: 900 }]
  const opening = { date: '2026-01-01', amount: 1000 }
  const short = [{ date: '2026-02-10', amount: 400 }]

  const before = statementChecks({ opening, statementBalances: balances, bankRows: short })
  assert.equal(before[0].discrepancy, 0, 'the first anchor defines the start, it cannot fail')
  assert.equal(before[1].discrepancy, -500, 'March is short by the missing row')
  assert.equal(before[1].from, '2026-02-28', 'bounded by the last agreement, not by all time')

  // Import the row that was missing, change nothing else.
  const fixed = statementChecks({
    opening, statementBalances: balances,
    bankRows: [...short, { date: '2026-03-15', amount: -500 }],
  })
  assert.equal(fixed[1].discrepancy, 0, 'nothing stored, so the gap simply stops existing')
})

test('a balance for a date the ledger does not reach is a missing import, not a missing row', () => {
  const rows = [{ date: '2026-02-10', amount: 500 }]
  const opening = { date: '2026-01-01', amount: 1000 }
  const checks = statementChecks({
    opening,
    statementBalances: [{ date: '2026-02-05', balance: 900 }, { date: '2026-03-01', balance: 900 }],
    bankRows: rows,
  })
  assert.equal(checks[0].beyondLedger, false)
  assert.equal(checks[1].beyondLedger, true, 'past Feb 10, so its statement was never imported')
  assert.equal(ledgerCoverageEnd(rows), '2026-02-10')
  assert.equal(ledgerCoverageEnd([]), null)
})

test('malformed balances are dropped at the door rather than poisoning every derivation', () => {
  const sources = {
    opening: { date: '2026-01-01', amount: 1000 },
    statementBalances: [
      { date: '2026-02-28', balance: 1500 },
      { date: null, balance: 99 },
      { date: '2026-03-31', balance: 'not a number' },
    ],
    bankRows: [],
  }
  assert.equal(cashAsOf(sources, '2026-06-30'), 1500)
  assert.equal(statementChecks(sources).length, 1)
})

test('an opening balance can be back-derived from a later known balance', () => {
  // The ledger predates the first balance ever recorded, so the early months need an anchor run
  // backwards from the earliest figure we do have.
  const rows = [{ date: '2026-01-15', amount: 300 }, { date: '2026-02-15', amount: -100 }]
  const opening = deriveOpeningBalance(rows, '2026-02-28', 1200, '2026-01-01')
  assert.deepEqual(opening, { date: '2026-01-01', amount: 1000, estimated: true })
  // Round trip: deriving then replaying must reproduce the known balance.
  assert.equal(cashAsOf({ opening, bankRows: rows }, '2026-02-28'), 1200)
})

test('savings is walked backwards through savings transfers only', () => {
  const rows = [
    { date: '2026-02-10', amount: -300, category: 'Savings' },     // a deposit after the cutoff
    { date: '2026-02-12', amount: -400, category: 'Investments' }, // allocation, but not savings
    { date: '2026-02-15', amount: -100, category: 'Expense' },     // ordinary spend
    { date: '2026-01-02', amount: -900, category: 'Savings' },     // before the cutoff
  ]
  // Only the 300 deposited after Jan 31 comes back out.
  assert.equal(savingsAsOf(5000, rows, '2026-01-31'), 4700)
})

test('a savings transfer moves money between buckets and leaves net worth flat', () => {
  // The symmetry that stops an allocation from reading as income in the waterfall: the same row
  // raises historical cash by exactly what it lowers historical savings.
  const transfer = [{ date: '2026-02-10', amount: -300, category: 'Savings' }]
  const opening = { date: '2026-01-01', amount: 1000 }
  const cashAfter = cashAsOf({ opening, bankRows: transfer }, '2026-02-28')
  const savingsBefore = savingsAsOf(5000, transfer, '2026-01-31')

  // The transfer takes 300 out of chequing and puts 300 into savings: liquid net worth is flat.
  assert.equal(cashAfter, 700)
  assert.equal(savingsBefore, 4700)
  assert.equal(cashAfter + 5000, 1000 + savingsBefore)
})

test('month ends run to the last day of each month and stop at today', () => {
  assert.deepEqual(monthEndDates('2026-01-15', '2026-04-10'), [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-10',
  ])
  // Leap year, and a single-month range.
  assert.deepEqual(monthEndDates('2028-02-01', '2028-02-29'), ['2028-02-29'])
})

test('an entry keeps the breakdown keys the chart reads', () => {
  const entry = buildEntry({ date: '2026-02-28', cash: 100, savings: 200, market: 300, cost: 250, basis: 'market' })
  assert.deepEqual(entry, {
    date: '2026-02-28',
    netWorth: 600,
    breakdown: { cash: 100, savings: 200, portfolio: 300 },
    portfolioCost: 250,
    basis: 'market',
  })
})

const REBUILD_INPUT = {
  transactions: [
    { date: '2026-01-15', amount: 2000, category: 'Income' },
    { date: '2026-02-10', amount: -300, category: 'Savings' },
    { date: '2026-02-20', amount: -150, category: 'Expense' },
  ],
  holdings: HOLDINGS,
  savingsAccounts: [{ balance: 5000 }],
  opening: { date: '2026-01-01', amount: 1000 },
  today: '2026-03-15',
  priceOf,
}

test('rebuild is idempotent', () => {
  // It runs on a version bump and can be forced by hand, so identical inputs must give identical
  // output — otherwise history would drift a little every time someone pressed the button.
  const first = rebuildHistory(REBUILD_INPUT)
  const second = rebuildHistory(REBUILD_INPUT)
  assert.deepEqual(first, second)
  assert.deepEqual(rebuildHistory({ ...REBUILD_INPUT, keepDates: first.map(e => e.date) }), first)
})

test('rebuild keeps the dates it is handed so daily granularity survives', () => {
  // The 30-day delta and the KPI sparkline need more than one point per month. A rebuild that
  // dropped the existing dates would flatten history to month ends and break both.
  const withDaily = rebuildHistory({ ...REBUILD_INPUT, keepDates: ['2026-02-05', '2026-02-06'] })
  const dates = withDaily.map(e => e.date)
  assert.ok(dates.includes('2026-02-05') && dates.includes('2026-02-06'))
  assert.deepEqual(dates, [...dates].sort())
  // Dates in the future are not inventable and must be dropped.
  const withFuture = rebuildHistory({ ...REBUILD_INPUT, keepDates: ['2027-01-01'] })
  assert.ok(!withFuture.some(e => e.date === '2027-01-01'))
})

test('rebuilt savings varies across months instead of being frozen at today', () => {
  // The specific regression this module was written for: the old backfill wrote today's savings
  // total into every historical point, so a deposit made months ago looked like it had always
  // been there.
  const history = rebuildHistory(REBUILD_INPUT)
  const jan = history.find(e => e.date === '2026-01-31')
  const mar = history.find(e => e.date === '2026-03-15')
  assert.equal(jan.breakdown.savings, 4700)
  assert.equal(mar.breakdown.savings, 5000)
  assert.notEqual(jan.breakdown.savings, mar.breakdown.savings)
})

test('every rebuilt point carries the fields the waterfall needs', () => {
  for (const entry of rebuildHistory(REBUILD_INPUT)) {
    assert.equal(typeof entry.portfolioCost, 'number')
    assert.ok(['market', 'partial', 'cost'].includes(entry.basis))
    // The stored total must equal its own parts, or the trend's top edge drifts off the KPI card.
    const { cash, savings, portfolio } = entry.breakdown
    assert.equal(entry.netWorth, Math.round((cash + savings + portfolio) * 100) / 100)
  }
})

test('rebuild gives every statement close its own point', () => {
  // An anchor should read as the step it was, not be smeared across the month it landed in.
  const history = rebuildHistory({
    ...REBUILD_INPUT,
    statementBalances: [{ date: '2026-02-14', balance: 800 }],
  })
  const point = history.find(e => e.date === '2026-02-14')
  assert.ok(point, 'the statement date is missing from the rebuilt series')
  assert.equal(point.breakdown.cash, 800)
})

test('a new statement balance leaves every earlier point exactly where it was', () => {
  // End to end through rebuild: the property this model was adopted for. The original design
  // re-derived all of history from today's balance; an anchor cannot reach backwards past the
  // one before it.
  const before = rebuildHistory(REBUILD_INPUT)
  const after = rebuildHistory({
    ...REBUILD_INPUT,
    statementBalances: [{ date: '2026-03-15', balance: 99999 }],
  })

  for (const point of before) {
    if (point.date >= '2026-03-15') continue
    const match = after.find(e => e.date === point.date)
    assert.equal(match.breakdown.cash, point.breakdown.cash, `${point.date} moved`)
  }
  assert.equal(after.find(e => e.date === '2026-03-15').breakdown.cash, 99999)
})

test('HISTORY_VERSION is an integer the rebuild guard can compare', () => {
  assert.ok(Number.isInteger(HISTORY_VERSION) && HISTORY_VERSION >= 5)
})
