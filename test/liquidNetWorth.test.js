import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIQUID_BUCKETS,
  portfolioValueOf,
  holdingsByAccountType,
  historyAt,
  buildLiquidKpis,
  buildTrendSeries,
  buildChangeAttribution,
  buildComposition,
  completeMonths,
  averageMonthlySpend,
  monthsOfSpend,
  goalPace,
  goalProgress,
  accountCount,
  trailingRowCount,
  staleInsightReason,
  expectedBalanceAt,
} from '../src/utils/liquidNetWorth.js'

const r2 = n => Math.round(n * 100) / 100

// Liquid net worth = cash + savings + investments. The tests that matter here are the ones
// guarding the change decomposition: the Dashboard tells the user how much of a gain they earned
// by saving versus how much the market handed them, and that claim is only worth making if the
// arithmetic cannot quietly mix the two.

const entry = (date, cash, savings, portfolio, portfolioCost, basis = 'market') => ({
  date,
  netWorth: Math.round((cash + savings + portfolio) * 100) / 100,
  breakdown: { cash, savings, portfolio },
  portfolioCost,
  basis,
})

// Six months in which the user saved, bought more stock, and watched prices move.
const HISTORY = [
  entry('2026-02-28', 5000, 20000, 10000, 9000),
  entry('2026-03-31', 5200, 21000, 10800, 9500),
  entry('2026-04-30', 5400, 22000, 11500, 10000),
  entry('2026-05-31', 5600, 23000, 12400, 10500),
]

test('history lookup answers with the past, never the future', () => {
  // A range boundary resolved with a later balance would let a deposit made after the range leak
  // into it and show up as savings the user did not make in that period.
  assert.equal(historyAt(HISTORY, '2026-04-15').date, '2026-03-31')
  assert.equal(historyAt(HISTORY, '2026-04-30').date, '2026-04-30')
  assert.equal(historyAt(HISTORY, '2026-01-01'), null)
})

test('the change decomposition adds back up to the change', () => {
  // The identity the waterfall draws: end − start = saved + market + other. If this drifts, the
  // bars stop summing to the total and the card is lying about something.
  const rows = [
    { date: '2026-03-10', amount: 4000, category: 'Income' },
    { date: '2026-04-10', amount: 4000, category: 'Income' },
    { date: '2026-03-20', amount: -1500, category: 'Expense' },
    { date: '2026-04-20', amount: -1500, category: 'Expense' },
  ]
  const a = buildChangeAttribution(HISTORY, rows, { from: '2026-02-28', to: '2026-05-31' })

  assert.equal(a.start, 35000)
  assert.equal(a.end, 41000)
  assert.equal(a.change, 6000)
  assert.equal(a.moneyIn, 8000)
  assert.equal(a.moneyOut, 3000)
  assert.equal(a.saved, 5000)
  assert.equal(a.change, Math.round((a.saved + a.market + a.other) * 100) / 100)
})

test('buying more stock is a contribution, not market performance', () => {
  // Portfolio grew 10000 -> 12400. Cost grew 9000 -> 10500, so 1500 of that was money put in and
  // only 900 was the market. Conflating them is exactly the bug this decomposition exists to fix.
  const a = buildChangeAttribution(HISTORY, [], { from: '2026-02-28', to: '2026-05-31' })
  assert.equal(a.market, 900)

  // With no flows recorded, everything the ledger cannot explain lands in `other` — including
  // that 1500 contribution. It is never silently added to `market`.
  assert.equal(a.other, 6000 - 900)
})

test('the residual is reported, and only flagged when it is material', () => {
  const rows = [{ date: '2026-03-10', amount: 5100, category: 'Income' }]
  const a = buildChangeAttribution(HISTORY, rows, { from: '2026-02-28', to: '2026-05-31' })
  // 6000 change = 5100 saved + 900 market, so nothing is left unexplained.
  assert.equal(a.other, 0)
  assert.equal(a.hasOther, false)

  // A move the ledger knows nothing about must surface rather than be absorbed.
  const withEdit = [...HISTORY, entry('2026-06-30', 25000, 23000, 12400, 10500)]
  const b = buildChangeAttribution(withEdit, rows, { from: '2026-02-28', to: '2026-06-30' })
  assert.equal(b.other, 19400)
  assert.equal(b.hasOther, true)
})

test('a reconciliation is named, not dumped into the residual', () => {
  // Typing a real chequing balance records a dated adjustment. Attributing it to "Other" would
  // tell the user something is wrong without telling them what — and attributing it to "Market"
  // would be an outright lie about investment performance.
  const rows = [{ date: '2026-03-10', amount: 5100, category: 'Income' }]
  const withEdit = [...HISTORY, entry('2026-06-30', 25000, 23000, 12400, 10500)]
  const recs = [{ date: '2026-06-15', discrepancy: 19400, beyondLedger: false }]
  const a = buildChangeAttribution(withEdit, rows, { from: '2026-02-28', to: '2026-06-30' }, recs)

  assert.equal(a.reconciliation, 19400)
  assert.equal(a.unexplained, 19400)
  assert.equal(a.lag, 0)
  assert.equal(a.other, 0, 'once named, nothing is left over')
  assert.equal(a.hasReconciliation, true)
  // The identity still closes with the extra term in it.
  assert.equal(a.change, r2(a.saved + a.market + a.reconciliation + a.other))
})

test('lag is separated from a real discrepancy', () => {
  // Statements arrive weeks late, so an adjustment past the ledger's coverage is spending that
  // genuinely happened and simply is not imported. It must not read as a mystery.
  const rows = [{ date: '2026-03-10', amount: 5100, category: 'Income' }]
  const withEdit = [...HISTORY, entry('2026-06-30', 25000, 23000, 12400, 10500)]
  const recs = [
    { date: '2026-06-14', discrepancy: 20000, beyondLedger: false },
    { date: '2026-06-15', discrepancy: -600, beyondLedger: true },
  ]
  const a = buildChangeAttribution(withEdit, rows, { from: '2026-02-28', to: '2026-06-30' }, recs)
  assert.equal(a.unexplained, 20000)
  assert.equal(a.lag, -600)
  assert.equal(a.reconciliation, 19400)
})

test('only reconciliations inside the range are applied', () => {
  const rows = []
  const recs = [
    { date: '2026-02-28', discrepancy: 999, beyondLedger: false },  // on the start point: already in `start`
    { date: '2026-07-15', discrepancy: 999, beyondLedger: false },  // after the end point
  ]
  const a = buildChangeAttribution(HISTORY, rows, { from: '2026-02-28', to: '2026-05-31' }, recs)
  assert.equal(a.reconciliation, 0)
})

test('headline shares always sum to 100, including when a term is negative', () => {
  const rows = [{ date: '2026-03-10', amount: 5100, category: 'Income' }]
  const a = buildChangeAttribution(HISTORY, rows, { from: '2026-02-28', to: '2026-05-31' })
  assert.equal(a.savedShare + a.marketShare, 100)

  // A losing market against real saving: the split must still read, not divide by a near-zero sum.
  const down = [HISTORY[0], entry('2026-05-31', 5600, 23000, 8600, 9000)]
  const b = buildChangeAttribution(down, rows, { from: '2026-02-28', to: '2026-05-31' })
  assert.ok(b.market < 0)
  assert.equal(b.savedShare + b.marketShare, 100)
})

test('market return is only claimed when both endpoints were priced', () => {
  const stale = [entry('2026-02-28', 5000, 20000, 10000, 10000, 'cost'), HISTORY[3]]
  assert.equal(buildChangeAttribution(stale, [], { from: '2026-02-28', to: '2026-05-31' }).basis, 'partial')
  assert.equal(buildChangeAttribution(HISTORY, [], { from: '2026-02-28', to: '2026-05-31' }).basis, 'market')
})

test('an empty or single-point history decomposes to nothing rather than throwing', () => {
  assert.equal(buildChangeAttribution([], [], { from: '2026-01-01', to: '2026-06-01' }).change, 0)
  assert.equal(buildChangeAttribution(HISTORY, [], null).change, 0)
  assert.equal(buildChangeAttribution([HISTORY[0]], [], { from: '2026-02-28', to: '2026-02-28' }).change, 0)
})

test('KPIs read today from live data and the comparison from history', () => {
  // Today's figures must match the rest of the app the instant a balance is edited, so they come
  // from the live queries — not from the newest history point, which only catches up on snapshot.
  const kpis = buildLiquidKpis({
    history: HISTORY, cash: 5600, savings: 23000, portfolio: 12400,
    days: 30, asOf: '2026-05-31',
  })
  assert.equal(kpis.liquid, 41000)
  assert.equal(kpis.since, '2026-04-30')
  assert.equal(kpis.deltas.liquid.abs, 41000 - 38900)
  assert.equal(kpis.deltas.savings.abs, 1000)
})

test('KPI deltas fall back to the earliest point when history is young', () => {
  const young = [entry('2026-05-20', 5000, 20000, 10000, 9000)]
  const kpis = buildLiquidKpis({ history: young, cash: 5600, savings: 23000, portfolio: 12400, asOf: '2026-05-31' })
  assert.equal(kpis.since, '2026-05-20')
  assert.equal(kpis.deltas.liquid.abs, 6000)

  // With nothing to compare against, deltas are absent rather than zero — "no change" and "no
  // data" must not render the same.
  assert.equal(buildLiquidKpis({ history: [], cash: 1, savings: 1, portfolio: 1 }).deltas, null)
})

test('the trend keeps one point per month plus the newest', () => {
  const busy = [...HISTORY, entry('2026-05-15', 5500, 22500, 12000, 10500)]
  const series = buildTrendSeries(busy, 'All', '2026-05-31')
  assert.deepEqual(series.map(p => p.date), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  // The newest value on screen has to equal the KPI strip, or the chart contradicts the header.
  assert.equal(series[series.length - 1].liquid, 41000)
  assert.deepEqual(Object.keys(series[0]).filter(k => LIQUID_BUCKETS.includes(k)), LIQUID_BUCKETS)
})

test('the trend window is anchored to today, not to the ledger', () => {
  // Balances are current whether or not a statement has landed, so a 6M window counts back from
  // today. (Flows use period.js, which anchors to the latest transaction instead.)
  assert.equal(buildTrendSeries(HISTORY, '6M', '2026-05-31').length, 4)
  // Four months later the same 6M window (Apr–Sep) has only April and May left in it.
  assert.deepEqual(
    buildTrendSeries(HISTORY, '6M', '2026-09-30').map(p => p.date),
    ['2026-04-30', '2026-05-31'],
  )
  assert.equal(buildTrendSeries(HISTORY, 'All', '2026-09-30').length, 4)
})

test('composition rolls every investment account type up to the portfolio band', () => {
  // The trend has three bands but the donut has a slice per account type, so each slice has to
  // name the band it filters.
  const rows = buildComposition({
    cash: 5000, savings: 20000,
    holdings: [
      { ticker: 'AAA', shares: 10, purchasePrice: 100, accountType: 'TFSA' },
      { ticker: 'BBB', shares: 10, purchasePrice: 100, accountType: 'RRSP' },
    ],
    prices: { AAA: 200, BBB: 100 },
  })
  assert.deepEqual(rows.map(r => r.name), ['Cash', 'Savings', 'TFSA', 'RRSP'])
  assert.deepEqual(rows.map(r => r.bucket), ['cash', 'savings', 'portfolio', 'portfolio'])
  assert.equal(rows.find(r => r.name === 'TFSA').value, 2000)
  assert.equal(rows.reduce((s, r) => s + r.pct, 0), 100)

  // Empty buckets are dropped, not drawn as zero-width slices.
  assert.deepEqual(buildComposition({ cash: 0, savings: 100 }).map(r => r.name), ['Savings'])
})

test('unpriced holdings fall back to cost basis rather than vanishing', () => {
  const holdings = [{ ticker: 'AAA', shares: 10, purchasePrice: 100, accountType: 'TFSA' }]
  assert.equal(portfolioValueOf(holdings, {}), 1000)
  assert.equal(portfolioValueOf(holdings, { AAA: 150 }), 1500)
  assert.deepEqual(holdingsByAccountType(holdings, { AAA: 150 }), { TFSA: 1500 })
})

const SPEND_ROWS = [
  { date: '2026-01-15', amount: -1000, category: 'Expense' },
  { date: '2026-02-15', amount: -2000, category: 'Expense' },
  { date: '2026-03-02', amount: -100, category: 'Expense' },  // the partial month
  { date: '2026-03-02', amount: 5000, category: 'Income' },
]

test('the month a statement lands in is excluded from averages', () => {
  // Including a half-imported month reads as a collapse in spending rather than as partial data.
  assert.deepEqual(completeMonths(SPEND_ROWS), ['2026-02', '2026-01'])
  assert.equal(averageMonthlySpend(SPEND_ROWS), 1500)
  assert.equal(monthsOfSpend(SPEND_ROWS, 3000), 2)
  // Income is not spending.
  assert.equal(averageMonthlySpend([{ date: '2026-01-15', amount: 5000, category: 'Income' }, SPEND_ROWS[2]]), null)
  assert.equal(monthsOfSpend([], 3000), null)
})

const SAVINGS_ID = 'sav-1'
const GOAL = {
  name: 'House', targetAmount: 60000, currentAmount: 30000, targetDate: '2027-01-01', monthlySavings: 0,
  links: [
    { sourceType: 'savings', sourceId: SAVINGS_ID, percent: 100 },
    { sourceType: 'holdingsAccountType', sourceId: 'TFSA', percent: 50 },
    { sourceType: 'cash', sourceId: 'cash', percent: 20 },
  ],
}
const ALLOC_ROWS = [
  { date: '2026-01-10', amount: -1000, category: 'Savings', linkedSavingsAccountId: SAVINGS_ID },
  { date: '2026-02-10', amount: -1000, category: 'Savings', linkedSavingsAccountId: SAVINGS_ID },
  { date: '2026-02-11', amount: -800, category: 'Investments', linkedHoldingAccountType: 'TFSA' },
  { date: '2026-02-12', amount: -500, category: 'Savings', linkedSavingsAccountId: 'someone-else' },
  { date: '2026-03-01', amount: -9999, category: 'Savings', linkedSavingsAccountId: SAVINGS_ID },
]

test('goal pace is attributed from the ledger, weighted by each link', () => {
  // Allocation rows carry their destination and goals name those destinations, so contributions
  // can be attributed properly instead of inferred from the overall savings rate.
  const pace = goalPace(GOAL, ALLOC_ROWS)
  // Two complete months (Jan, Feb): 2000 into the linked savings account, 50% of 800 into TFSA.
  assert.equal(pace.perMonth, (2000 + 400) / 2)
  assert.equal(pace.source, 'derived')
  assert.equal(pace.months, 2)
})

test('a cash earmark adds nothing to pace', () => {
  // Cash is not contributed to; counting the link would double-count money already in the goal.
  const cashOnly = { ...GOAL, links: [{ sourceType: 'cash', sourceId: 'cash', percent: 20 }], monthlySavings: 250 }
  assert.deepEqual(goalPace(cashOnly, ALLOC_ROWS), { perMonth: 250, source: 'plan', months: 0 })
})

test('pace falls back to the stated plan, then to nothing', () => {
  // A brand-new goal has a plan but no history; showing the plan beats showing no pace at all.
  const fresh = { ...GOAL, links: [], monthlySavings: 500 }
  assert.equal(goalPace(fresh, ALLOC_ROWS).source, 'plan')
  assert.equal(goalPace({ ...GOAL, links: [], monthlySavings: 0 }, ALLOC_ROWS).source, 'none')
})

test('goal progress projects an ETA and measures the slip against the target', () => {
  const p = goalProgress({ ...GOAL, monthlySavings: 1000, links: [] }, [])
  assert.equal(p.pct, 50)
  assert.equal(p.remaining, 30000)
  assert.equal(p.monthsToGo, 30)
  assert.equal(p.reached, false)
  assert.ok(p.slipMonths > 0, 'a goal landing after its target date must report a positive slip')

  // A goal already met needs no forecast.
  const done = goalProgress({ targetAmount: 100, currentAmount: 150, targetDate: '2027-01-01' }, [])
  assert.equal(done.reached, true)
  assert.equal(done.pct, 100)
  assert.equal(done.eta, null)
})

// --- The counts the header and the waterfall meta quote -----------------------------------------

test('an account is a place money sits, not a holding', () => {
  // Sixteen tickers in one TFSA is one account. Counting rows would tell the reader they hold a
  // portfolio they do not have.
  const holdings = [
    { ticker: 'AAA', accountType: 'TFSA' },
    { ticker: 'BBB', accountType: 'TFSA' },
    { ticker: 'CCC', accountType: 'RRSP' },
    { ticker: 'DDD' },
  ]
  assert.equal(
    accountCount({ cash: 3500, savingsAccounts: [{ id: 'a' }, { id: 'b' }], holdings }),
    6, 'chequing + 2 savings + TFSA + RRSP + the untyped default',
  )
  // A zero balance is not an account you have.
  assert.equal(accountCount({ cash: 0, savingsAccounts: [], holdings: [] }), 0)
})

test('the waterfall names the rows it could not include, not the ones it did', () => {
  // History has no point on Jul 13, so the card closed on Jul 9 instead. The two rows in the gap
  // are real and will land in the next reading — Finances will legitimately report a larger total
  // for what looks like the same chip, and the card has to say so rather than be caught at it.
  const rows = [
    { date: '2026-01-15' }, // before the window
    { date: '2026-03-01' }, // inside it
    { date: '2026-07-09' }, // the closing balance's own date
    { date: '2026-07-11' }, // in the gap
    { date: '2026-07-13' }, // in the gap
    { date: '2026-07-20' }, // past the chip too
  ]
  assert.equal(trailingRowCount(rows, { from: '2026-01-31', to: '2026-07-09' }, { to: '2026-07-13' }), 2)
  // A card that closed exactly where the chip ends has nothing to disclose.
  assert.equal(trailingRowCount(rows, { from: '2026-01-31', to: '2026-07-13' }, { to: '2026-07-13' }), 0)
})

test('an empty attribution counts nothing rather than counting everything', () => {
  const rows = [{ date: '2026-03-01' }, { date: '2026-04-01' }]
  assert.equal(trailingRowCount(rows, { from: null, to: null }, { to: '2026-07-13' }), 0)
  assert.equal(trailingRowCount(rows, null, null), 0)
})

// --- Knowing when a stored generation stopped being true ----------------------------------------

const STORED = {
  headline: 'A summary.',
  period: '6M|2026-02-01|2026-07-13',
  kpis: { liquid: 69181.10 },
  attribution: { change: 13096.62, unexplained: -5361.19, moneyOut: 21500 },
}

test('a record still describing the screen reports no staleness', () => {
  assert.equal(staleInsightReason({
    record: STORED,
    scopeKey: '6M|2026-02-01|2026-07-13',
    kpis: { liquid: 69181.10 },
    attribution: { change: 13096.62, unexplained: -5361.19, moneyOut: 21500 },
  }), null)
})

test('sub-dollar movement is live prices ticking, not a stale analysis', () => {
  // Portfolio is repriced constantly. Badging the panel every time a quote moves a cent would
  // train the reader to ignore the badge, which costs more than the badge is worth.
  assert.equal(staleInsightReason({
    record: STORED,
    scopeKey: STORED.period,
    kpis: { liquid: 69181.52 },
    attribution: STORED.attribution,
  }), null)
})

test('a changed period reports scope, and changed data reports data', () => {
  assert.equal(staleInsightReason({
    record: STORED, scopeKey: '1Y|2025-11-14|2026-07-13',
    kpis: { liquid: 69181.10 }, attribution: STORED.attribution,
  }), 'scope')

  // The case that went unreported: same period, but a corrected ledger moved the numbers under it.
  assert.equal(staleInsightReason({
    record: STORED, scopeKey: STORED.period,
    kpis: { liquid: 69181.10 },
    attribution: { ...STORED.attribution, unexplained: 0 },
  }), 'data')

  // A balance edit that leaves the decomposition alone still counts.
  assert.equal(staleInsightReason({
    record: STORED, scopeKey: STORED.period,
    kpis: { liquid: 71000 }, attribution: STORED.attribution,
  }), 'data')

  // Extra spending imported inside the window, with the totals happening to land elsewhere.
  assert.equal(staleInsightReason({
    record: STORED, scopeKey: STORED.period,
    kpis: { liquid: 69181.10 },
    attribution: { ...STORED.attribution, moneyOut: 21845 },
  }), 'data')
})

test('scope wins over data, because re-scoping is the thing the reader just did', () => {
  assert.equal(staleInsightReason({
    record: STORED, scopeKey: 'other',
    kpis: { liquid: 99999 }, attribution: { change: 0, unexplained: 0, moneyOut: 0 },
  }), 'scope')
})

test('no record means nothing to be stale about', () => {
  assert.equal(staleInsightReason({ record: null, scopeKey: 'x' }), null)
  assert.equal(staleInsightReason({ record: { period: 'x' }, scopeKey: 'y' }), null, 'a half-written record is not a result')
})

// --- The import-review check --------------------------------------------------------------------

test('an import is measured from the previous statement, not from all time', () => {
  // The whole value of checking at import time: the answer has to be about THIS statement, so it
  // runs from the last moment the bank and the ledger agreed.
  const sources = {
    opening: { date: '2026-01-01', amount: 1000 },
    statementBalances: [{ date: '2026-02-28', balance: 1500 }],
    bankRows: [{ date: '2026-02-10', amount: 500 }],
    incomingRows: [{ date: '2026-03-10', amount: -200 }, { date: '2026-03-20', amount: -100 }],
  }
  const result = expectedBalanceAt(sources, '2026-03-31')
  assert.equal(result.from, '2026-02-28', 'measured from the previous close')
  assert.equal(result.expected, 1200, 'the February anchor, not the January opening')
})

test('rows outside the statement window do not count toward it', () => {
  const result = expectedBalanceAt({
    opening: { date: '2026-01-01', amount: 1000 },
    statementBalances: [{ date: '2026-02-28', balance: 1500 }],
    bankRows: [],
    incomingRows: [
      { date: '2026-02-20', amount: -900 },  // belongs to the previous statement
      { date: '2026-03-10', amount: -100 },
      { date: '2026-04-05', amount: -700 },  // belongs to the next one
    ],
  }, '2026-03-31')
  assert.equal(result.expected, 1400)
})

test('with nothing to measure from, the check stays quiet rather than inventing a gap', () => {
  assert.equal(expectedBalanceAt({ opening: null, statementBalances: [] }, '2026-03-31'), null)
  assert.equal(expectedBalanceAt({ opening: { date: '2026-01-01', amount: 1000 } }, null), null)
})
