import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSpendAnalysis } from '../server/spendAnalysis.js'
import { PAYMENT_RE } from '../src/utils/csvHelpers.js'

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

function card(date, description, amount, category = 'Grocery', source = 'Primary Card', extra = {}) {
  return { date, description, amount, category, source, ...extra }
}

function steadyCardHistory() {
  const rows = []
  for (const [monthIndex, month] of MONTHS.entries()) {
    for (let purchase = 0; purchase < 12; purchase++) {
      const day = String(purchase + 1).padStart(2, '0')
      const merchant = ['Neighbourhood Market', 'Corner Grocer', 'Local Pharmacy'][purchase % 3]
      const category = purchase < 8 ? 'Grocery' : purchase < 10 ? 'Health' : 'Transport'
      rows.push(card(`${month}-${day}`, merchant, -(18 + (purchase % 4)), category))
    }
    if (monthIndex === MONTHS.length - 1) {
      rows.push(card(`${month}-20`, 'Merchant refund', 125, 'Shopping', 'Primary Card', { creditKind: 'refund' }))
    }
  }
  return rows
}

function bankHistory({ income = 6000, expenses = 4500 } = {}) {
  const rows = []
  for (const [index, month] of MONTHS.entries()) {
    rows.push({
      date: `${month}-${index === 0 ? '01' : '02'}`,
      description: 'Payroll',
      amount: income,
      category: 'Income',
      type: 'income',
    })
    rows.push({
      date: `${month}-${index === MONTHS.length - 1 ? '30' : '20'}`,
      description: 'Monthly expenses',
      amount: -expenses,
      category: 'Expense',
      type: 'expense',
    })
    rows.push({
      date: `${month}-15`,
      description: 'Savings transfer',
      amount: -500,
      category: 'Savings',
      type: 'savings',
    })
  }
  return rows
}

test('creates a stable, high-confidence profile from six unfiltered months', () => {
  const cardTransactions = steadyCardHistory()
  const forward = buildSpendAnalysis({ cardTransactions })
  const reversed = buildSpendAnalysis({ cardTransactions: [...cardTransactions].reverse() })

  assert.equal(forward.profile.name, 'The Steady Regular')
  assert.deepEqual(forward.profile.traits.map(item => item.key), ['loyal', 'focused', 'steady', 'everyday'])
  assert.equal(forward.profile.confidence.level, 'high')
  assert.equal(forward.profileFacts.txCount, 72)
  assert.equal(forward.profileFacts.credits.total, 125)
  assert.equal(forward.profileFacts.totalSpend, reversed.profileFacts.totalSpend)
  assert.deepEqual(forward.profile, reversed.profile)
  assert.deepEqual(forward.scopes.profile.months, MONTHS)
})

test('active filters change scoped facts without redefining Spend Style', () => {
  const cardTransactions = [
    ...steadyCardHistory(),
    card('2026-06-25', 'Outdoor Store', -300, 'Shopping'),
  ]
  const all = buildSpendAnalysis({ cardTransactions })
  const filtered = buildSpendAnalysis({
    cardTransactions,
    insightScope: {
      from: '2026-06-01',
      to: '2026-06-30',
      filters: { categories: ['Shopping'] },
      label: 'June 2026, Shopping',
    },
  })

  assert.deepEqual(filtered.profile, all.profile)
  assert.equal(filtered.scopedFacts.txCount, 1)
  assert.equal(filtered.scopedFacts.totalSpend, 300)
  assert.deepEqual(filtered.scopedFacts.categories.map(category => category.name), ['Shopping'])
  assert.deepEqual(filtered.scopes.insight.filters, { categories: ['Shopping'] })
})

test('detects recurring spend and large outliers without treating credits as spend', () => {
  const recurring = MONTHS.map(month => card(`${month}-05`, 'STREAMING SERVICE 123456', -20, 'Subscription'))
  const ordinary = MONTHS.flatMap((month, index) => [
    card(`${month}-10`, `Cafe ${String.fromCharCode(65 + index)}`, -12, 'Food & Dining'),
    card(`${month}-12`, `Market ${String.fromCharCode(65 + index)}`, -25, 'Grocery'),
  ])
  const rows = [
    ...recurring,
    ...ordinary,
    card('2026-06-18', 'Large purchase', -700, 'Shopping'),
    card('2026-06-22', 'Large purchase refund', 700, 'Shopping', 'Primary Card', { creditKind: 'refund' }),
  ]

  const result = buildSpendAnalysis({ cardTransactions: rows })

  assert.equal(result.profile.recurring.count, 1)
  assert.equal(result.profile.recurring.monthlyTotal, 20)
  assert.equal(result.profileFacts.totalSpend, 1042)
  assert.equal(result.profileFacts.credits.total, 700)
  assert.equal(result.profileFacts.outliers[0].description, 'Large purchase')
})

test('Financial Pace prefers confirmed income and uses complete bank months', () => {
  const result = buildSpendAnalysis({
    bankTransactions: bankHistory({ income: 6000, expenses: 4500 }),
    settings: { confirmedMonthlyIncome: 6500, budgetSavingsRate: 15 },
  })

  assert.equal(result.financialPace.status, 'on_track')
  assert.equal(result.financialPace.income, 6500)
  assert.equal(result.financialPace.observedIncome, 6000)
  assert.equal(result.financialPace.incomeSource, 'confirmed_monthly_income')
  assert.equal(result.financialPace.expenses, 4500)
  assert.equal(result.financialPace.headroom, 2000)
  assert.equal(result.financialPace.savingsTarget, 975)
  assert.equal(result.financialPace.monthsCovered, 6)
  assert.deepEqual(result.scopes.financial.months, MONTHS)
})

test('Financial Pace distinguishes Little Room from Over Pace', () => {
  const littleRoom = buildSpendAnalysis({
    bankTransactions: bankHistory({ income: 5000, expenses: 4500 }),
    settings: { budgetSavingsRate: 15 },
  })
  const overPace = buildSpendAnalysis({
    bankTransactions: bankHistory({ income: 4000, expenses: 4500 }),
    settings: { budgetSavingsRate: 15 },
  })

  assert.equal(littleRoom.financialPace.status, 'little_room')
  assert.equal(littleRoom.financialPace.headroom, 500)
  assert.equal(littleRoom.financialPace.savingsTarget, 750)
  assert.equal(overPace.financialPace.status, 'over_pace')
  assert.equal(overPace.financialPace.headroom, -500)
})

test('card purchases and credits cannot change Financial Pace', () => {
  const bankTransactions = bankHistory({ income: 6000, expenses: 4500 })
  const withoutCards = buildSpendAnalysis({ bankTransactions, settings: { budgetSavingsRate: 15 } })
  const withCards = buildSpendAnalysis({
    bankTransactions,
    cardTransactions: [
      card('2026-06-10', 'Large card purchase', -50000, 'Shopping'),
      card('2026-06-12', 'Card refund', 10000, 'Shopping', 'Primary Card', { creditKind: 'refund' }),
    ],
    settings: { budgetSavingsRate: 15 },
  })

  assert.deepEqual(withCards.financialPace, withoutCards.financialPace)
})

test('Financial Pace follows bank amount signs for income, expenses and contributions', () => {
  const rows = [
    ...bankHistory({ income: 6000, expenses: 4500 }),
    { date: '2026-03-10', amount: -900, category: 'Income', type: 'income' },
    { date: '2026-03-11', amount: 800, category: 'Expense', type: 'expense' },
    { date: '2026-03-12', amount: 700, category: 'Savings', type: 'savings' },
  ]
  const baseline = buildSpendAnalysis({ bankTransactions: bankHistory({ income: 6000, expenses: 4500 }) })
  const result = buildSpendAnalysis({ bankTransactions: rows })

  assert.equal(result.financialPace.income, baseline.financialPace.income)
  assert.equal(result.financialPace.expenses, baseline.financialPace.expenses)
  assert.equal(result.financialPace.savingsContributions, baseline.financialPace.savingsContributions)
})

test('returns Not Enough Data without a complete bank month or usable income', () => {
  const incomplete = buildSpendAnalysis({
    bankTransactions: [
      { date: '2026-06-10', amount: 3000, category: 'Income', type: 'income' },
      { date: '2026-06-20', amount: -1000, category: 'Expense', type: 'expense' },
    ],
  })
  const noIncome = buildSpendAnalysis({
    bankTransactions: [
      { date: '2026-06-01', amount: -1000, category: 'Expense', type: 'expense' },
      { date: '2026-06-30', amount: -500, category: 'Expense', type: 'expense' },
    ],
  })

  assert.equal(incomplete.financialPace.status, 'not_enough_data')
  assert.equal(incomplete.financialPace.monthsCovered, 0)
  assert.equal(noIncome.financialPace.status, 'not_enough_data')
  assert.equal(noIncome.financialPace.monthsCovered, 1)
})

test('uses an explicit savings target when configured', () => {
  const result = buildSpendAnalysis({
    bankTransactions: bankHistory({ income: 5000, expenses: 4300 }),
    settings: { budgetSavingsTarget: 600, budgetSavingsRate: 50 },
  })

  assert.equal(result.financialPace.status, 'on_track')
  assert.equal(result.financialPace.savingsTarget, 600)
  assert.equal(result.financialPace.savingsTargetSource, 'explicit_monthly_target')
  assert.equal(result.financialPace.savingsRate, null)
})

test('uses stable tie-breakers when equal-value rows arrive in a different order', () => {
  const rows = [
    card('2026-06-01', 'Zulu Store 12345', -25, 'Shopping'),
    card('2026-06-02', 'Alpha Store', -25, 'Grocery'),
    card('2026-06-03', 'Zulu Store 67890', -25, 'Shopping'),
    card('2026-06-04', 'Alpha Store', -25, 'Grocery'),
    card('2026-06-05', 'Refund B', 10, 'Other', 'Primary Card', { creditKind: 'refund' }),
    card('2026-06-06', 'Reward A', 10, 'Other', 'Primary Card', { creditKind: 'cashback' }),
  ]

  const forward = buildSpendAnalysis({ cardTransactions: rows })
  const reversed = buildSpendAnalysis({ cardTransactions: [...rows].reverse() })

  assert.deepEqual(forward.profile, reversed.profile)
  assert.deepEqual(forward.profileFacts, reversed.profileFacts)
  assert.deepEqual(forward.scopedFacts, reversed.scopedFacts)
  assert.deepEqual(forward.profileFacts.categories.map(item => item.name), ['Grocery', 'Shopping'])
  assert.deepEqual(forward.profileFacts.credits.byKind.map(item => item.kind), ['cashback', 'refund'])
})

test('credit-card payment descriptions remain excluded by the import contract', () => {
  for (const description of ['Payment - Thank You', 'AUTOPAY RECEIVED', 'Online Payment', 'ACH PAYMENT POSTED']) {
    assert.equal(PAYMENT_RE.test(description), true, description)
  }
  assert.equal(PAYMENT_RE.test('Merchant refund'), false)
  assert.equal(PAYMENT_RE.test('Cashback reward'), false)
})
