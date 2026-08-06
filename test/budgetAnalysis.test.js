import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBudgetAnalysis } from '../server/budgetAnalysis.js'

// The Budget catalogue's job is to select and rank findings about THE PLAN, and to hand the model
// every comparison already made. These tests exist to stop three failures: a finding that belongs
// to another tab's subject appearing here, a benchmark reaching the model unmade, and a ranking
// that buries the one observation that invalidates the rest.

const fin = over => ({
  monthsCovered: 6,
  windowLabel: 'Feb–Jul 2026',
  windowFrom: '2026-02-01',
  windowTo: '2026-07-31',
  income: 6000,
  savingsContrib: 400,
  investContrib: 200,
  cardBreakdown: [
    { category: 'Dining', monthly: 600 },
    { category: 'Groceries', monthly: 500 },
    { category: 'Shopping', monthly: 300 },
  ],
  bankBreakdown: [{ category: 'Savings', monthly: 400 }],
  ...over,
})

const analyse = ({ settings = {}, goals = [], finance = fin() } = {}) =>
  buildBudgetAnalysis({ settings, goals, fin: finance })

const keys = analysis => analysis.observations.map(item => item.key)
const find = (analysis, key) => analysis.observations.find(item => item.key === key)

// ----------------------------------------------------------- subject boundary

// The three existing catalogues are disjoint by subject. This one is the plan: if it ever emits a
// merchant, a payee, a transaction or a balance, a user reading two tabs meets one finding twice.
test('the catalogue never reports a transaction, merchant, payee or balance', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 400, Groceries: 600 } },
    goals: [{ id: 'g', name: 'Trip', currentAmount: 0, targetAmount: 5000, monthlySavings: 0 }],
  })
  const text = JSON.stringify(analysis.observations).toLowerCase()
  for (const forbidden of ['merchant', 'payee', 'transaction', 'net worth', 'balance']) {
    assert.ok(!text.includes(forbidden), `observations mention "${forbidden}"`)
  }
})

// Spend's Financial Pace owns the achieved rate. Every savings string here must say "planned"
// or "sets aside", never imply the money was actually saved.
test('every savings observation is framed as planned, never as achieved', () => {
  const short = analyse({ settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 30 } })
  const clear = analyse({ settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 5, budgetSavingsTarget: 400 } })
  for (const analysis of [short, clear]) {
    const rate = analysis.observations.find(item => item.key.startsWith('planned_rate'))
    assert.ok(rate, 'expected a planned-rate observation')
    assert.match(`${rate.title} ${rate.evidence}`, /plan|sets aside/i)
    assert.ok(!/\byou saved\b|\bactually saved\b|achieved/i.test(`${rate.title} ${rate.evidence}`))
  }
})

// ----------------------------------------------------------- selection & ranking

test('an over-committed plan outranks everything else', () => {
  const analysis = analyse({
    settings: {
      confirmedMonthlyIncome: 4000,
      budgetSavingsTarget: 2000,
      categoryBudgets: { Dining: 3000, Groceries: 600 },
    },
  })
  assert.equal(keys(analysis)[0], 'over_committed')
})

// Uncommitted income inside an over-committed plan is an artefact of the shortfall, not slack.
// Reporting both would have the rail contradict its own top-ranked finding.
test('idle headroom is never reported alongside an over-committed plan', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 4000, budgetSavingsTarget: 2000, categoryBudgets: { Dining: 3000 } },
  })
  assert.ok(keys(analysis).includes('over_committed'))
  assert.ok(!keys(analysis).includes('idle_headroom'))
})

test('caps below actual spending are reported with the widest gap named', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 400, Groceries: 450 } },
  })
  const item = find(analysis, 'caps_below_actual')
  assert.ok(item)
  assert.equal(item.facts.overCount, 2)
  assert.equal(item.facts.overBy, 250)          // (600−400) + (500−450)
  assert.equal(item.facts.worst.name, 'Dining')
})

test('a trivial overshoot is not worth an observation slot', () => {
  const analysis = analyse({
    // Dining is over by $10 — under the materiality floor for a six-month average.
    settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 590, Groceries: 600, Shopping: 400 } },
  })
  assert.ok(!keys(analysis).includes('caps_below_actual'))
})

test('a plan with no caps at all reports that, not stray uncapped categories', () => {
  const analysis = analyse({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: {} } })
  assert.ok(keys(analysis).includes('no_caps_set'))
  assert.ok(!keys(analysis).includes('uncapped_spending'))
})

test('stray uncapped categories are reported once a plan exists', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 700, Groceries: 600 } },
  })
  const item = find(analysis, 'uncapped_spending')
  assert.ok(item)
  assert.equal(item.facts.count, 1)
  assert.equal(item.facts.categories[0].name, 'Shopping')
  assert.ok(!keys(analysis).includes('no_caps_set'))
})

test('an unfunded goal is named', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 700, Groceries: 600, Shopping: 400 } },
    goals: [{ id: 'g', name: 'Japan trip', currentAmount: 0, targetAmount: 5000, monthlySavings: 0 }],
  })
  const item = find(analysis, 'goal_unfunded')
  assert.ok(item)
  assert.deepEqual(item.facts.names, ['Japan trip'])
})

test('a goal funded from bank activity is not called unfunded', () => {
  const analysis = analyse({
    finance: fin({ bankBreakdown: [{ category: 'Japan trip', monthly: 150 }] }),
    goals: [{ id: 'g', name: 'Japan trip', currentAmount: 0, targetAmount: 5000, monthlySavings: 0 }],
  })
  assert.ok(!keys(analysis).includes('goal_unfunded'))
})

test('at most three observations are selected, ranked by score', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 4000, budgetSavingsTarget: 2000, categoryBudgets: { Dining: 100 } },
    goals: [{ id: 'g', name: 'Trip', currentAmount: 0, targetAmount: 5000, monthlySavings: 0 }],
  })
  assert.ok(analysis.observations.length <= 3)
  const scores = analysis.observations.map(item => item.score)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
})

// ----------------------------------------------------------- evidence discipline

// Given a hole, a generation will fill it. Every threshold the catalogue knows about has to reach
// the model with the comparison already made — the RUNWAY_COMFORTABLE lesson.
test('the idle-headroom benchmark travels with the observation, not just the raw share', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsTarget: 200, categoryBudgets: { Dining: 300 } },
  })
  const item = find(analysis, 'idle_headroom')
  assert.ok(item)
  assert.equal(typeof item.facts.benchmark, 'number')
  assert.match(item.evidence, /above the \d+%/)
})

test('the savings shortfall is stated, never left as two numbers to subtract', () => {
  const analysis = analyse({
    // An explicit target BELOW the rate benchmark. With the auto target the plan trivially clears
    // its own rate — the auto target IS rate% of income — so this is the only way to be short.
    settings: {
      confirmedMonthlyIncome: 6000, budgetSavingsRate: 30, budgetSavingsTarget: 300,
      categoryBudgets: { Dining: 700 },
    },
  })
  const item = find(analysis, 'planned_rate_below_target')
  assert.ok(item)
  assert.equal(item.facts.shortfall, item.facts.targetDollars - item.facts.plannedDollars)
  assert.match(item.evidence, /fall \$[\d,]+\.\d\d short/)
})

// With the default rate-derived target, planned savings ARE the target plus whatever goals add,
// so the plan cannot be short of itself. A catalogue that reported a shortfall here would be
// inventing one out of a rounding artefact.
test('an auto target is never reported as short of itself', () => {
  const analysis = analyse({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 30, categoryBudgets: { Dining: 700 } },
  })
  assert.ok(!keys(analysis).includes('planned_rate_below_target'))
  assert.ok(keys(analysis).includes('planned_rate_clears_target'))
})

test('an unconfirmed income qualifies the figures rather than ranking as a problem', () => {
  const analysis = analyse({ settings: { categoryBudgets: { Dining: 700, Groceries: 600, Shopping: 400 } } })
  const item = find(analysis, 'income_unconfirmed')
  assert.ok(item)
  assert.equal(item.status, 'steady')
  assert.ok(item.score < 50)
})

// ----------------------------------------------------------- shape

test('the analysis exposes a fingerprint so a later plan edit reads as stale', () => {
  const before = analyse({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 400 } } })
  const after = analyse({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 500 } } })
  assert.ok(before.fingerprint)
  assert.notEqual(before.fingerprint, after.fingerprint)
})

test('it is pure — the same inputs give the same output', () => {
  const inputs = { settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Dining: 400 } }, goals: [], fin: fin() }
  assert.deepEqual(buildBudgetAnalysis(inputs), buildBudgetAnalysis(inputs))
})

test('no data yields no observations rather than an invented one', () => {
  const analysis = buildBudgetAnalysis({})
  assert.deepEqual(analysis.observations, [])
  assert.equal(analysis.scope.label, 'no complete bank months')
})
