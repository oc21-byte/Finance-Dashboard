import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInvestmentsModel,
  filterByAccount,
  sortHoldings,
  accountTypeOf,
} from '../src/utils/investmentsModel.js'

function holding(over = {}) {
  return {
    id: over.id ?? 'h1',
    ticker: 'aapl',
    shares: 10,
    purchasePrice: 100,
    purchaseDate: '2025-01-15',
    accountType: 'TFSA',
    purchases: [{ id: 'p1', shares: 10, purchasePrice: 100, purchaseDate: '2025-01-15' }],
    ...over,
  }
}

test('a ticker is upper-cased so a lower-case entry still matches its price', () => {
  const model = buildInvestmentsModel({ holdings: [holding()], prices: { AAPL: 150 } })
  assert.equal(model.rows[0].ticker, 'AAPL')
  assert.equal(model.rows[0].currentPrice, 150)
})

test('a holding with no account type falls back to Non-Registered', () => {
  assert.equal(accountTypeOf({ ticker: 'X' }), 'Non-Registered')
  const model = buildInvestmentsModel({ holdings: [holding({ accountType: undefined })] })
  assert.equal(model.rows[0].accountType, 'Non-Registered')
})

test('gain is market value against cost basis', () => {
  const model = buildInvestmentsModel({ holdings: [holding()], prices: { AAPL: 150 } })
  const row = model.rows[0]
  assert.equal(row.costBasis, 1000)
  assert.equal(row.currentValue, 1500)
  assert.equal(row.gainDollar, 500)
  assert.equal(row.gainPct, 50)
})

test('an unpriced holding keeps a null price but is valued at cost, not at zero', () => {
  const model = buildInvestmentsModel({ holdings: [holding()], prices: {} })
  const row = model.rows[0]
  assert.equal(row.currentPrice, null)
  assert.equal(row.currentValue, null, 'unknown is not the same as worthless')
  assert.equal(row.value, 1000, 'totals fall back to cost basis')
  assert.equal(row.gainDollar, null, 'no price means no knowable gain')
  assert.equal(model.unpricedCount, 1)
})

test('one unpriced holding does not drag the portfolio total below its cost', () => {
  const model = buildInvestmentsModel({
    holdings: [holding(), holding({ id: 'h2', ticker: 'ZZZZ', shares: 5, purchasePrice: 40 })],
    prices: { AAPL: 150 },
  })
  assert.equal(model.totalCost, 1200)
  assert.equal(model.totalValue, 1700, '1500 priced + 200 held at cost')
})

test('rows come back ranked by value descending', () => {
  const model = buildInvestmentsModel({
    holdings: [
      holding({ id: 'small', ticker: 'A', shares: 1, purchasePrice: 10 }),
      holding({ id: 'big', ticker: 'B', shares: 1, purchasePrice: 900 }),
      holding({ id: 'mid', ticker: 'C', shares: 1, purchasePrice: 100 }),
    ],
  })
  assert.deepEqual(model.rows.map(r => r.id), ['big', 'mid', 'small'])
})

test('weights are a share of the portfolio and sum to 100', () => {
  const model = buildInvestmentsModel({
    holdings: [
      holding({ id: 'a', ticker: 'A', shares: 1, purchasePrice: 750 }),
      holding({ id: 'b', ticker: 'B', shares: 1, purchasePrice: 250 }),
    ],
  })
  assert.deepEqual(model.rows.map(r => r.weight), [75, 25])
})

test('an empty portfolio reports zero rather than dividing by zero', () => {
  const model = buildInvestmentsModel({})
  assert.equal(model.totalValue, 0)
  assert.equal(model.totalGainPct, 0)
  assert.deepEqual(model.rollup, [])
  assert.deepEqual(model.accountTypes, [])
})

test('the rollup groups by account type, ranked by value', () => {
  const model = buildInvestmentsModel({
    holdings: [
      holding({ id: 'a', ticker: 'A', accountType: 'TFSA', shares: 1, purchasePrice: 100 }),
      holding({ id: 'b', ticker: 'B', accountType: 'RRSP', shares: 1, purchasePrice: 300 }),
      holding({ id: 'c', ticker: 'C', accountType: 'TFSA', shares: 1, purchasePrice: 100 }),
    ],
  })
  assert.deepEqual(model.rollup.map(r => [r.name, r.value, r.pct]), [
    ['RRSP', 300, 60],
    ['TFSA', 200, 40],
  ])
})

test('chips and donut read the same list, so a chip can never empty the table', () => {
  const model = buildInvestmentsModel({
    holdings: [holding({ accountType: 'FHSA' })],
  })
  assert.deepEqual(model.accountTypes, model.rollup.map(r => r.name))
  for (const type of model.accountTypes) {
    assert.ok(filterByAccount(model.rows, type).length > 0, `${type} chip has rows`)
  }
})

test('savings totals include projected annual interest', () => {
  const model = buildInvestmentsModel({
    savingsAccounts: [
      { id: 's1', name: 'HYSA', balance: 10000, apy: 4.5 },
      { id: 's2', name: 'GIC', balance: 5000, apy: 3 },
    ],
  })
  assert.equal(model.totalSavings, 15000)
  assert.equal(model.totalAnnualInterest, 600)
})

test('filterByAccount passes everything through for All', () => {
  const rows = [{ accountType: 'TFSA' }, { accountType: 'RRSP' }]
  assert.equal(filterByAccount(rows, 'All').length, 2)
  assert.equal(filterByAccount(rows, 'RRSP').length, 1)
})

test('an unpriced row sorts to the bottom of a gain sort in either direction', () => {
  const rows = [
    { ticker: 'A', gainPct: 10 },
    { ticker: 'B', gainPct: null },
    { ticker: 'C', gainPct: -5 },
  ]
  assert.deepEqual(sortHoldings(rows, 'gainPct', 'desc').map(r => r.ticker), ['A', 'C', 'B'])
  assert.deepEqual(sortHoldings(rows, 'gainPct', 'asc').map(r => r.ticker), ['B', 'C', 'A'])
})

test('an unknown sort field leaves the ranking alone', () => {
  const rows = [{ ticker: 'A' }, { ticker: 'B' }]
  assert.equal(sortHoldings(rows, 'nope', 'asc'), rows)
})
