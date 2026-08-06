import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBudgetPlan, resolveSavingsTarget, budgetFingerprint, staleBudgetInsightReason,
  DEFAULT_SAVINGS_RATE,
} from '../src/utils/budgetModel.js'

// The Budget plan's whole claim is that income splits cleanly into spending caps, savings, and
// what is left. Every test below exists to stop that claim quietly going false — an allocation
// row counted as spending, a goal funded twice, or a savings target that ignores its own clamp.

const fin = over => ({
  monthsCovered: 6,
  windowLabel: 'Feb–Jul 2026',
  income: 6919,
  savingsContrib: 860,
  investContrib: 600,
  cardBreakdown: [
    { category: 'Dining & Takeout', monthly: 612 },
    { category: 'Groceries', monthly: 558 },
    { category: 'Shopping', monthly: 340 },
    { category: 'Income', monthly: 4000 },
  ],
  bankBreakdown: [
    { category: 'Savings', monthly: 860 },
    { category: 'Investments', monthly: 600 },
  ],
  ...over,
})

const goal = (name, over = {}) => ({
  id: name, name, currentAmount: 100, targetAmount: 10000, monthlySavings: 0, ...over,
})

const plan = ({ settings = {}, goals = [], finance = fin(), ...rest } = {}) =>
  buildBudgetPlan({ settings, goals, fin: finance, ...rest })

// ---------------------------------------------------------------- income

test('income prefers a confirmed figure and falls back to the bank average', () => {
  assert.equal(plan().income.display, 6919)
  assert.equal(plan().income.isConfirmed, false)

  const confirmed = plan({ settings: { confirmedMonthlyIncome: 7500 } })
  assert.equal(confirmed.income.display, 7500)
  assert.equal(confirmed.income.isConfirmed, true)
})

test('a confirmed income of zero is honoured, an empty string is not', () => {
  assert.equal(plan({ settings: { confirmedMonthlyIncome: 0 } }).income.display, 0)
  assert.equal(plan({ settings: { confirmedMonthlyIncome: '' } }).income.display, 6919)
})

// ---------------------------------------------------- the savings target ladder

test('the savings target ladder runs explicit, then rate, then default rate', () => {
  assert.equal(resolveSavingsTarget({ budgetSavingsTarget: 900 }, 6000).effective, 900)
  assert.equal(resolveSavingsTarget({ budgetSavingsRate: 20 }, 6000).effective, 1200)
  assert.equal(resolveSavingsTarget({}, 6000).effective, 6000 * DEFAULT_SAVINGS_RATE / 100)
})

test('an explicit target of zero is a real target, not an unset one', () => {
  const resolved = resolveSavingsTarget({ budgetSavingsTarget: 0, budgetSavingsRate: 15 }, 6000)
  assert.equal(resolved.effective, 0)
  assert.equal(resolved.isAuto, false)
})

test('null clears the override back to the rate default', () => {
  const resolved = resolveSavingsTarget({ budgetSavingsTarget: null, budgetSavingsRate: 15 }, 6000)
  assert.equal(resolved.effective, 900)
  assert.equal(resolved.isAuto, true)
})

// The divergence this module was extracted to end: the server clamped the rate and the client
// did not, so a stored rate of 500 produced a target five times income on the Budget tab alone.
test('the savings rate is clamped to 0-100, matching the server', () => {
  assert.equal(resolveSavingsTarget({ budgetSavingsRate: 500 }, 6000).effective, 6000)
  assert.equal(resolveSavingsTarget({ budgetSavingsRate: -30 }, 6000).effective, 0)
})

test('a staged AI target overrides the stored one without persisting it', () => {
  const staged = plan({
    settings: { budgetSavingsTarget: 900, categoryBudgets: {} },
    pendingSavingsTarget: 1400,
  })
  assert.equal(staged.savingsTarget.effective, 1400)
  assert.equal(staged.savingsTarget.isPending, true)
  assert.equal(staged.hasPending, true)
})

// ------------------------------------------------- allocation vs spending

test('savings-category caps count as savings planned, never as spending caps', () => {
  const result = plan({
    settings: {
      confirmedMonthlyIncome: 6000,
      budgetSavingsTarget: 0,
      categoryBudgets: { 'Dining & Takeout': 450, Investments: 1000, Savings: 200 },
    },
  })
  assert.equal(result.totalSpendingCaps, 450)
  assert.equal(result.totalSavingsCaps, 1200)
  assert.equal(result.totalSavingsPlanned, 1200)
  // Income minus BOTH subtractions, counted once each.
  assert.equal(result.budgetedLeft, 6000 - 450 - 1200)
})

test('a cap named after an active goal is not double-counted against the goal row', () => {
  const result = plan({
    settings: {
      confirmedMonthlyIncome: 6000,
      budgetSavingsTarget: 0,
      categoryBudgets: { 'Japan trip': 300, Groceries: 500 },
    },
    goals: [goal('Japan trip', { monthlySavings: 300 })],
  })
  assert.equal(result.totalSpendingCaps, 500)
  assert.equal(result.totalGoalSavings, 300)
  assert.equal(result.totalSavingsPlanned, 300)
})

test('a goal with no manual amount is funded from the bank average, and marked auto', () => {
  const result = plan({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsTarget: 0 },
    finance: fin({ bankBreakdown: [{ category: 'Emergency fund', monthly: 210 }] }),
    goals: [goal('Emergency fund'), goal('Down payment', { monthlySavings: 500 })],
  })
  const [emergency, downPayment] = result.goalRows
  assert.equal(emergency.isAuto, true)
  assert.equal(emergency.amount, 210)
  assert.equal(downPayment.isAuto, false)
  assert.equal(downPayment.amount, 500)
  assert.equal(result.totalGoalSavings, 710)
})

test('a funded goal drops out of the plan entirely', () => {
  const result = plan({
    goals: [goal('Done', { currentAmount: 10000, monthlySavings: 400 })],
  })
  assert.equal(result.activeGoals.length, 0)
  assert.equal(result.totalGoalSavings, 0)
})

// ------------------------------------------------------------ cap rows

test('spending rows classify over, near, and comfortable against their cap', () => {
  const result = plan({
    settings: {
      categoryBudgets: { 'Dining & Takeout': 450, Groceries: 600, Shopping: 1000 },
    },
  })
  const by = name => result.spendingCategories.find(c => c.name === name)
  assert.deepEqual(
    { pct: by('Dining & Takeout').pct, over: by('Dining & Takeout').over },
    { pct: 136, over: true },
  )
  assert.equal(by('Groceries').near, true)   // 558/600 = 93%
  assert.equal(by('Groceries').over, false)
  assert.equal(by('Shopping').near, false)   // 340/1000 = 34%
})

test('a category with no cap reports no percentage rather than zero', () => {
  const row = plan().spendingCategories.find(c => c.name === 'Shopping')
  assert.equal(row.cap, null)
  assert.equal(row.pct, null)
  assert.equal(row.over, false)
})

test('Income and Transfer never become budgetable rows', () => {
  const names = plan({ settings: { categoryBudgets: { Transfer: 100 } } })
    .spendingCategories.map(c => c.name)
  assert.ok(!names.includes('Income'))
  assert.ok(!names.includes('Transfer'))
})

test('savings rows read their average from the bank side, not the card side', () => {
  const result = plan({
    finance: fin({
      cardBreakdown: [{ category: 'Savings', monthly: 0 }],
      bankBreakdown: [{ category: 'Savings', monthly: 860 }],
    }),
    settings: { categoryBudgets: { Savings: 700 } },
  })
  const row = result.savingsCategories.find(c => c.name === 'Savings')
  assert.equal(row.avg, 860)
  assert.equal(row.cap, 700)
  assert.ok(!result.spendingCategories.some(c => c.name === 'Savings'))
})

test('an observed savings contribution shows up even with no cap set', () => {
  const names = plan().savingsCategories.map(c => c.name)
  assert.deepEqual(names, ['Savings', 'Investments'])
})

// -------------------------------------------------------- the flow bar

test('the flow bar segments sum to 100 and never exceed the track', () => {
  const result = plan({
    settings: {
      confirmedMonthlyIncome: 6000,
      budgetSavingsTarget: 1000,
      categoryBudgets: { Groceries: 2000 },
    },
  })
  const { spendPct, savePct, freePct } = result.allocation
  assert.ok(Math.abs(spendPct + savePct + freePct - 100) < 1e-9)
  assert.equal(result.allocation.overBudget, false)
})

test('an over-committed plan clamps its segments and reports itself as over budget', () => {
  const result = plan({
    settings: {
      confirmedMonthlyIncome: 4000,
      budgetSavingsTarget: 2000,
      categoryBudgets: { Groceries: 3500 },
    },
  })
  const { spendPct, savePct, freePct, overBudget } = result.allocation
  assert.equal(overBudget, true)
  assert.ok(spendPct <= 100 && savePct <= 100 && freePct >= 0)
  assert.ok(Math.abs(spendPct + savePct + freePct - 100) < 1e-9)
  assert.ok(result.budgetedLeft < 0)
})

test('zero income produces zero-width segments rather than NaN', () => {
  const result = plan({ finance: fin({ income: 0 }), settings: { confirmedMonthlyIncome: 0 } })
  for (const value of Object.values(result.allocation)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value))
  }
  assert.equal(result.savingsRate.plannedPct, 0)
})

// ------------------------------------------------------ the planned rate

// Spend's Financial Pace owns the ACHIEVED rate. This one is what the plan intends, and the
// shortfall is computed here so a generation is never left to work out whether it clears target.
test('the planned savings rate compares against the target with the comparison already made', () => {
  const result = plan({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 20, budgetSavingsTarget: 900 },
  })
  assert.equal(result.savingsRate.targetPct, 20)
  assert.equal(result.savingsRate.plannedPct, 15)
  assert.equal(result.savingsRate.onTrack, false)
  assert.equal(result.savingsRate.shortfall, 1200 - 900)
})

test('a plan that clears its target reports a negative shortfall, not a clamped zero', () => {
  const result = plan({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 10, budgetSavingsTarget: 1500 },
  })
  assert.equal(result.savingsRate.onTrack, true)
  assert.equal(result.savingsRate.shortfall, 600 - 1500)
})

test('the rate status reserves over_pace for a plan that does not fit its income', () => {
  const overCommitted = plan({
    settings: { confirmedMonthlyIncome: 4000, budgetSavingsTarget: 2000, categoryBudgets: { Groceries: 3500 } },
  })
  assert.equal(overCommitted.savingsRate.status, 'over_pace')

  // Below target but still inside income is a shortfall, not an overdraft.
  const short = plan({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 30, budgetSavingsTarget: 600 },
  })
  assert.equal(short.budgetedLeft > 0, true)
  assert.equal(short.savingsRate.status, 'little_room')

  const healthy = plan({
    settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 10, budgetSavingsTarget: 1000 },
  })
  assert.equal(healthy.savingsRate.status, 'on_track')

  assert.equal(plan({ finance: fin({ income: 0 }) }).savingsRate.status, 'not_enough_data')
})

// -------------------------------------------------------- cap pressure

test('cap pressure counts only capped rows and only over-cap excess', () => {
  const result = plan({
    settings: {
      categoryBudgets: { 'Dining & Takeout': 450, Groceries: 600, Shopping: 1000 },
    },
  })
  // Dining 612/450 over by 162, Groceries 558/600 near, Shopping 340/1000 comfortable.
  assert.equal(result.capPressure.capped, 3)
  assert.equal(result.capPressure.overCount, 1)
  assert.equal(result.capPressure.nearCount, 1)
  assert.equal(result.capPressure.overBy, 162)
  assert.equal(result.capPressure.worst.name, 'Dining & Takeout')
})

// An under-spent category cancelling out an over-spent one would report a plan as healthy while
// the user is $200 over on the one category they care about.
test('an under-spent category never nets off an over-spent one', () => {
  const result = plan({
    settings: { categoryBudgets: { 'Dining & Takeout': 500, Shopping: 5000 } },
  })
  assert.equal(result.capPressure.overCount, 1)
  assert.equal(result.capPressure.overBy, 112)   // 612 − 500, with Shopping's −4660 ignored
})

test('a category with no cap is neither over nor pressuring', () => {
  const result = plan({ settings: { categoryBudgets: {} } })
  assert.equal(result.capPressure.capped, 0)
  assert.equal(result.capPressure.overCount, 0)
  assert.equal(result.capPressure.overBy, 0)
  assert.equal(result.capPressure.worst, null)
  assert.ok(result.capPressure.uncapped > 0)
})

test('the widest gap wins, not the highest percentage', () => {
  const result = plan({
    settings: {
      // Groceries is 558/500 = +58. Shopping is 340/100 = +240 and a far worse ratio.
      categoryBudgets: { Groceries: 500, Shopping: 100 },
    },
  })
  assert.equal(result.capPressure.worst.name, 'Shopping')
})

// ------------------------------------------------------ staleness

test('the fingerprint moves when any figure the rail quotes moves', () => {
  const base = plan({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Groceries: 500 } } })
  const edited = plan({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Groceries: 600 } } })
  assert.notEqual(budgetFingerprint(base), budgetFingerprint(edited))
  assert.equal(budgetFingerprint(base), budgetFingerprint(
    plan({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Groceries: 500 } } }),
  ))
})

test('a stored generation goes stale on a scope change or a plan edit', () => {
  const current = plan({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Groceries: 500 } } })
  const fresh = { period: 'Budget|2026-02-01|2026-07-31', fingerprint: budgetFingerprint(current) }

  assert.equal(staleBudgetInsightReason({ record: null, scopeKey: 'x', plan: current }), null)
  assert.equal(
    staleBudgetInsightReason({ record: fresh, scopeKey: 'Budget|2026-02-01|2026-07-31', plan: current }),
    null,
  )
  assert.equal(
    staleBudgetInsightReason({ record: fresh, scopeKey: 'Budget|2026-03-01|2026-08-31', plan: current }),
    'scope',
  )

  const edited = plan({ settings: { confirmedMonthlyIncome: 6000, categoryBudgets: { Groceries: 900 } } })
  assert.equal(
    staleBudgetInsightReason({ record: fresh, scopeKey: 'Budget|2026-02-01|2026-07-31', plan: edited }),
    'plan',
  )
})

// ------------------------------------------------------ empty state

test('no financial data yields a zeroed plan rather than throwing', () => {
  const result = buildBudgetPlan({})
  assert.equal(result.income.display, 0)
  assert.equal(result.totalSpendingCaps, 0)
  assert.equal(result.totalSavingsPlanned, 0)
  assert.equal(result.hasSpendingData, false)
  assert.deepEqual(result.spendingCategories, [])
})
