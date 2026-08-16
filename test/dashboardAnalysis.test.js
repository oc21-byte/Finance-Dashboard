import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboardAnalysis } from '../server/dashboardAnalysis.js'
import { createDashboardInsightGeneration } from '../server/dashboardInsightGeneration.js'

// The fixture is built so the change decomposition closes exactly, because that identity is what
// every observation about "what moved it" rests on:
//
//   end − start = (moneyIn − moneyOut) + market + reconciliation + residual
//   45,000 − 35,000 = (30,000 − 21,500) + 1,500 + 0 + 0
//
// Savings transfers are deliberately present but excluded from moneyOut: that money never left the
// liquid net worth, it just moved buckets, and counting it would show a $6,000 hole that isn't one.

const ASOF = '2026-06-30'

function bankMonth(month, { income = 6000, expenses = 4300, savings = 1200 } = {}) {
  return [
    { id: `${month}-in`, date: `${month}-01`, description: 'ACH DEPOSIT, EMPLOYER PAYROLL', amount: income, category: 'Income', type: 'income', source: 'TD Bank' },
    { id: `${month}-out`, date: `${month}-15`, description: 'RENT OFFICE', amount: -expenses, category: 'Expense', type: 'expense', source: 'TD Bank' },
    { id: `${month}-sav`, date: `${month}-05`, description: 'ONLINE XFER TO SAVINGS', amount: -savings, category: 'Savings', type: 'expense', source: 'TD Bank', linkedSavingsAccountId: 'hysa' },
  ]
}

const LEDGER = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].flatMap(month => bankMonth(month))

const HISTORY = [
  { date: '2026-01-31', netWorth: 35000, breakdown: { cash: 5000, savings: 20000, portfolio: 10000 }, portfolioCost: 10000, basis: 'market' },
  { date: '2026-06-30', netWorth: 45000, breakdown: { cash: 7500, savings: 26000, portfolio: 11500 }, portfolioCost: 10000, basis: 'market' },
]

const SCOPE = { from: '2026-01-31', to: '2026-06-30', label: 'Jan 31, 2026 – Jun 30, 2026' }

// A Canadian book, stated outright rather than inherited from whatever the app's default home
// currency happens to be. The holding is TSX-listed and quoted in CAD, so every figure below
// depends on the analysis valuing holdings in the currency `settings` names — and the price map is
// keyed the way `fetchPricesWithFx` actually keys it, `TICKER:LISTING`.
const HOLDINGS = [{ id: 'h1', ticker: 'AAA', shares: 100, purchasePrice: 100, accountType: 'TFSA', listing: 'CA' }]
const PRICES = { 'AAA:CA': 115 }
const SETTINGS = { displayCurrency: 'CAD' }
const SAVINGS_ACCOUNTS = [{ id: 'hysa', name: 'Capital One HYSA', balance: 26000 }]

const GOALS = [
  { id: 'g1', name: 'Emergency Fund', targetAmount: 12000, currentAmount: 6000, targetDate: '2026-10-01', monthlySavings: 500 },
  { id: 'g2', name: 'New Laptop', targetAmount: 2000, currentAmount: 500, targetDate: '2027-01-01' },
]

function analyze(overrides = {}) {
  return buildDashboardAnalysis({
    netWorthHistory: HISTORY,
    bankTransactions: LEDGER,
    goals: GOALS,
    savingsAccounts: SAVINGS_ACCOUNTS,
    holdings: HOLDINGS,
    prices: PRICES,
    settings: SETTINGS,
    cash: 7500,
    checks: [],
    insightScope: SCOPE,
    asOf: ASOF,
    ...overrides,
  })
}

test('the change decomposition closes exactly, and allocation is not treated as spending', () => {
  const { attribution } = analyze()

  assert.equal(attribution.start, 35000)
  assert.equal(attribution.end, 45000)
  assert.equal(attribution.change, 10000)
  assert.equal(attribution.moneyIn, 30000)
  assert.equal(attribution.moneyOut, 21500, 'the $6,000 of savings transfers never left liquid net worth')
  assert.equal(attribution.saved, 8500)
  assert.equal(attribution.market, 1500, 'unrealised gain only — cost basis did not move')
  assert.equal(attribution.other, 0)

  assert.equal(
    attribution.start + attribution.saved + attribution.market + attribution.reconciliation + attribution.other,
    attribution.end,
  )
})

test('every headline number is the one the cards render, not a second computation of it', () => {
  // The whole point of the triad. `buildDashboardAnalysis` imports the same functions
  // `Dashboard.jsx` does, so agreement is structural — this asserts the wiring, not the arithmetic.
  const analysis = analyze()

  assert.equal(analysis.kpis.liquid, 45000)
  assert.equal(analysis.kpis.cash, 7500)
  assert.equal(analysis.kpis.savings, 26000)
  assert.equal(analysis.kpis.portfolio, 11500, 'valued at live prices, never at cost')
  assert.equal(analysis.composition.total, analysis.kpis.liquid, 'the donut centre equals the KPI strip')
  assert.equal(
    analysis.composition.rows.reduce((total, row) => total + row.value, 0),
    analysis.composition.total,
  )
  assert.deepEqual(analysis.composition.rows.map(row => row.name), ['Savings', 'TFSA', 'Cash'])
})

test('a foreign holding is valued in the home currency the settings name, as the cards value it', () => {
  // The other half of "the same computation": `Dashboard.jsx` hands `portfolioValueOf` and
  // `buildComposition` a display currency and an FX rate, and for a while this module handed them
  // neither. A US holding in a CAD book was then priced against a USD default with no rate to
  // convert by, so it fell back to cost — and the insight rail quoted a portfolio the KPI strip
  // above it contradicted. The rate rides on the price map, which is how `fetchPricesWithFx`
  // delivers it to `dashboardAnalysisInputs`.
  const analysis = analyze({
    holdings: [{ id: 'h1', ticker: 'BBB', shares: 100, purchasePrice: 100, accountType: 'Roth IRA', listing: 'US' }],
    prices: { 'BBB:US': 115, __USDCAD: 1.25 },
    settings: { displayCurrency: 'CAD' },
  })

  assert.equal(analysis.kpis.portfolio, 14375, '$11,500 USD at 1.25, not $10,000 of cost')
  assert.equal(analysis.composition.rows.find(row => row.name === 'Roth IRA').value, 14375)
  assert.equal(
    analysis.composition.rows.reduce((total, row) => total + row.value, 0),
    analysis.composition.total,
  )
})

test('runway is measured over complete months only', () => {
  const { runway } = analyze()
  // June holds the newest transaction, so it is a partial import and is excluded. Feb–May remain.
  assert.equal(runway.monthsCounted, 4)
  assert.equal(runway.averageMonthlySpend, 4300, 'savings transfers are not spending')
  assert.equal(runway.months, 1.7)
  assert.equal(runway.cash, 7500)
})

test('the runway benchmark is stated as a fact rather than left for the model to supply', () => {
  // A generation once filled this gap itself and wrote that 1.1 months "aligns with a conventional
  // emergency fund target" — unsupported, and backwards. Any threshold the catalogue knows about
  // has to reach the model as evidence, with the comparison already made in JS.
  const thin = analyze().observations.find(item => item.key === 'cash_runway')
  assert.equal(thin.facts.benchmarkMonths, 3)
  assert.equal(thin.facts.meetsBenchmark, false)
  assert.match(thin.evidence, /below the 3-month buffer/)

  const flush = analyze({ cash: 40000 }).observations.find(item => item.key === 'cash_runway')
  assert.equal(flush.facts.meetsBenchmark, true)
  assert.match(flush.evidence, /at or above the 3-month buffer/)
  assert.equal(flush.status, 'good')
})

test('goals carry a derived-or-planned pace and the slip against their own target date', () => {
  const { goals } = analyze()
  const [emergency, laptop] = goals

  assert.equal(emergency.name, 'Emergency Fund', 'ordered by target date, soonest first')
  assert.equal(emergency.pct, 50)
  assert.equal(emergency.remaining, 6000)
  assert.equal(emergency.pace.source, 'plan', 'no links, so the stated monthly plan is the pace')
  assert.equal(emergency.monthsToGo, 12)
  assert.equal(emergency.eta, '2027-06-30', 'counted from asOf, never from an ambient clock')
  assert.equal(emergency.slipMonths, 8)

  assert.equal(laptop.pace.perMonth, null, 'no plan and no attributable transfers is not a zero pace')
  assert.equal(laptop.eta, null)
  assert.equal(laptop.slipMonths, null)
})

test('a linked goal takes its pace from the ledger rather than from the stated plan', () => {
  const linked = [{
    id: 'g3', name: 'House Deposit', targetAmount: 30000, currentAmount: 6000,
    targetDate: '2027-06-01', monthlySavings: 100,
    links: [{ sourceType: 'savings', sourceId: 'hysa', percent: 100 }],
  }]
  const { goals } = analyze({ goals: linked })

  assert.equal(goals[0].pace.source, 'derived')
  assert.equal(goals[0].pace.perMonth, 1200, 'the transfers actually visible, not the $100 plan')
  assert.equal(goals[0].pace.months, 4)
})

test('observations are deterministic, capped at three, and ranked by the fixed catalogue', () => {
  const analysis = analyze()
  const keys = analysis.observations.map(item => item.key)

  assert.deepEqual(keys, ['goal_off_pace', 'saved_vs_markets', 'cash_runway'])
  assert.equal(new Set(keys).size, keys.length, 'no key appears twice')
  for (const item of analysis.observations) {
    assert.ok(item.title && item.evidence, `${item.key} carries a deterministic title and evidence`)
    assert.ok(['good', 'steady', 'watch'].includes(item.status))
  }

  // Reversing the input cannot change the result — nothing depends on row order.
  const reversed = analyze({ bankTransactions: [...LEDGER].reverse(), netWorthHistory: [...HISTORY].reverse() })
  assert.deepEqual(reversed.observations, analysis.observations)
  assert.deepEqual(reversed.attribution, analysis.attribution)
})

test('unexplained cash outranks every interpretation, because it says the balance may be wrong', () => {
  const analysis = analyze({
    checks: [
        { date: '2026-04-15', balance: 4200, expected: 5700, discrepancy: -1500, beyondLedger: false },
        { date: '2026-06-28', balance: 7500, expected: 7800, discrepancy: -300, beyondLedger: true },
      ],
  })

  assert.equal(analysis.attribution.unexplained, -1500)
  assert.equal(analysis.attribution.lag, -300, 'past the last statement, so expected rather than a mystery')
  assert.equal(analysis.observations[0].key, 'unexplained_cash')
  assert.equal(analysis.observations[0].facts.entries, 1, 'the lag entry is not counted as a discrepancy')
  assert.ok(
    analysis.observations[0].evidence.includes('statement lag'),
    'lag is stated as context, never folded into the number being flagged',
  )
})

test('statement lag alone is never reported as unaccounted cash', () => {
  const analysis = analyze({
    checks: [
        { date: '2026-06-28', balance: 7500, expected: 9900, discrepancy: -2400, beyondLedger: true },
      ],
  })
  assert.equal(analysis.attribution.unexplained, 0)
  assert.equal(analysis.observations.some(item => item.key === 'unexplained_cash'), false)
})

test('concentration is only called out when one place really does hold most of it', () => {
  // Goals are removed from both halves so the three slots are decided by the concentration rule
  // itself rather than by whether a goal happened to outrank it.
  const spread = analyze({ goals: [] })
  assert.equal(
    spread.observations.some(item => item.key === 'concentration'), false,
    '58% is the largest share here, and a largest share is not a finding',
  )

  const lopsided = analyze({
    goals: [],
    savingsAccounts: [{ id: 'hysa', name: 'Capital One HYSA', balance: 120000 }],
  })
  const found = lopsided.observations.find(item => item.key === 'concentration')
  assert.ok(found)
  assert.equal(found.facts.bucket, 'savings')
  assert.ok(found.facts.share >= 0.6)
})

test('an empty install produces no observations and no invented facts', () => {
  const analysis = buildDashboardAnalysis({ asOf: ASOF })

  assert.deepEqual(analysis.observations, [])
  assert.equal(analysis.kpis.liquid, 0)
  assert.equal(analysis.kpis.deltas, null, 'null rather than a 0% claim')
  assert.equal(analysis.composition.total, 0)
  assert.equal(analysis.runway.months, null)
  assert.equal(analysis.attribution.from, null)
  assert.deepEqual(analysis.goals, [])
})

// --- Generation -------------------------------------------------------------------------------

const COPY = analysis => JSON.stringify({
  headline: 'Your liquid net worth is $45,000.00.',
  observations: analysis.observations.map(item => ({ key: item.key, body: 'A short sentence about it.' })),
})

test('the model supplies wording and nothing else', () => {
  const analysis = analyze()
  const generation = createDashboardInsightGeneration({ analysis, period: '6M|2026-01-31|2026-06-30' })
  const record = generation.complete(COPY(analysis), '2026-06-30T12:00:00.000Z')

  assert.deepEqual(
    record.observations.map(item => item.key),
    analysis.observations.map(item => item.key),
    'the deterministic ranking, not the order the model replied in',
  )
  for (const [index, item] of record.observations.entries()) {
    assert.equal(item.title, analysis.observations[index].title)
    assert.equal(item.evidence, analysis.observations[index].evidence)
    assert.equal(item.status, analysis.observations[index].status)
  }
  assert.equal(record.kpis.liquid, 45000)
  assert.equal(record.asOf, ASOF)
  assert.equal(record.period, '6M|2026-01-31|2026-06-30')
  assert.deepEqual(record.messages, [])
})

test('a response that invents, renames, drops or duplicates a finding is rejected whole', () => {
  const analysis = analyze()
  const generation = createDashboardInsightGeneration({ analysis, period: 'p' })
  const keys = analysis.observations.map(item => item.key)
  const attempt = observations => () => generation.complete(
    JSON.stringify({ headline: 'A headline.', observations }), '2026-06-30T12:00:00.000Z')

  assert.throws(attempt(keys.map(key => ({ key, body: 'ok' })).concat({ key: 'invented', body: 'ok' })), /exactly 3 observations/)
  assert.throws(attempt(keys.slice(1).map(key => ({ key, body: 'ok' }))), /exactly 3 observations/)
  assert.throws(attempt([{ key: 'not_in_catalogue', body: 'ok' }, ...keys.slice(1).map(key => ({ key, body: 'ok' }))]), /Unexpected observation key/)
  assert.throws(attempt([{ key: keys[0], body: 'ok' }, { key: keys[0], body: 'ok' }, { key: keys[1], body: 'ok' }]), /Duplicate observation key/)
})

test('markup, essays and missing timestamps never reach the store', () => {
  const analysis = analyze()
  const generation = createDashboardInsightGeneration({ analysis, period: 'p' })
  const bodies = analysis.observations.map(item => ({ key: item.key, body: 'ok' }))

  assert.throws(
    () => generation.complete(JSON.stringify({ headline: '<b>Nice</b> work.', observations: bodies }), '2026-06-30T12:00:00.000Z'),
    /plain text/,
  )
  assert.throws(
    () => generation.complete(JSON.stringify({ headline: 'One. Two. Three.', observations: bodies }), '2026-06-30T12:00:00.000Z'),
    /no more than 2 sentences/,
  )
  assert.throws(() => generation.complete(COPY(analysis), 'not a date'), /valid ISO timestamp/)
})

test('a fenced response is accepted, and dollar tokens are normalized before storage', () => {
  const analysis = analyze()
  const generation = createDashboardInsightGeneration({ analysis, period: 'p' })
  const fenced = '```json\n' + JSON.stringify({
    headline: 'Liquid net worth reached $45000.',
    observations: analysis.observations.map(item => ({ key: item.key, body: 'Steady.' })),
  }) + '\n```'

  const record = generation.complete(fenced, '2026-06-30T12:00:00.000Z')
  assert.equal(record.headline, 'Liquid net worth reached $45,000.00.')
})
