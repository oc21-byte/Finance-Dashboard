import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinanceAnalysis, matchesFinanceScope } from '../server/financeAnalysis.js'
import { buildFinancialPace } from '../server/spendAnalysis.js'

// Fixtures must span COMPLETE calendar months. `fullMonthsWithData` drops a partial leading or
// trailing month, so a fixture running Jan 5 – Mar 20 yields one usable month and every pace
// assertion collapses to not_enough_data.
function bankMonth(month, { income = 6000, expenses = 3500, savings = 0, investments = 0, source = 'TD Bank' } = {}) {
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const rows = [
    { id: `${month}-in`, date: `${month}-01`, description: 'ACH DEPOSIT, EMPLOYER PAYROLL', amount: income, category: 'Income', type: 'income', source },
    { id: `${month}-out`, date: `${month}-${lastDay}`, description: 'RENT OFFICE', amount: -expenses, category: 'Expense', type: 'expense', source },
  ]
  // Savings and investments are CATEGORIES on expense rows. `test/spendAnalysis.test.js` uses a
  // `type:'savings'`, which no import path ever writes — do not copy that shape here.
  if (savings) rows.push({ id: `${month}-sav`, date: `${month}-05`, description: 'ONLINE XFER TO SAVINGS', amount: -savings, category: 'Savings', type: 'expense', source, linkedSavingsAccountId: 'hysa' })
  if (investments) rows.push({ id: `${month}-inv`, date: `${month}-06`, description: 'ROBINHOOD DEBITS', amount: -investments, category: 'Investments', type: 'expense', source })
  return rows
}

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

function ledger(overridesByMonth = {}) {
  return MONTHS.flatMap(month => bankMonth(month, { savings: 600, ...overridesByMonth[month] }))
}

const SCOPE = {
  from: '2026-01-01',
  to: '2026-06-30',
  filters: {},
  label: 'Jan 1, 2026 – Jun 30, 2026',
}

const SAVINGS_ACCOUNTS = [{ id: 'hysa', name: 'Capital One HYSA' }]

function analyze(bankTransactions, options = {}) {
  return buildFinanceAnalysis({
    bankTransactions,
    savingsAccounts: SAVINGS_ACCOUNTS,
    insightScope: SCOPE,
    settings: { budgetSavingsRate: 15 },
    ...options,
  })
}

test('cash flow reconciles with the ledger and never subtracts allocation from net cash', () => {
  const analysis = analyze(ledger())
  const { cashflow } = analysis

  assert.equal(cashflow.income, 36000)
  assert.equal(cashflow.expenses, 21000)
  assert.equal(cashflow.saved, 3600)
  assert.equal(cashflow.invested, 0)
  assert.equal(cashflow.netCash, 15000, 'net cash is income minus expenses only')
  assert.equal(cashflow.unallocated, 11400, 'net cash less what was deliberately set aside')
  assert.equal(cashflow.monthsWithActivity, 6)

  // The bar lists must total the same figures the KPI strip shows.
  const sum = rows => Math.round(rows.reduce((total, row) => total + row.amount, 0) * 100) / 100
  assert.equal(sum(analysis.inflows), cashflow.income)
  assert.equal(sum(analysis.outflows), cashflow.expenses)
})

test('the Financial Pace is the same computation the Spend Analyzer reports', () => {
  const bank = ledger()
  const settings = { budgetSavingsRate: 15, confirmedMonthlyIncome: 6200 }
  const analysis = analyze(bank, { settings })
  const direct = buildFinancialPace(bank, settings)

  assert.deepEqual(analysis.pace, direct, 'one implementation, not two that agree today')
  assert.equal(analysis.scopes.financial.basis, 'latest_complete_bank_months')
})

test('scope filters narrow on accounts, flows and payees', () => {
  const bank = [
    ...bankMonth('2026-01', { source: 'TD Bank' }),
    ...bankMonth('2026-02', { source: 'Chime' }),
  ]
  const scoped = filters => bank.filter(tx => matchesFinanceScope(tx, { ...SCOPE, filters }))

  assert.equal(scoped({ accounts: ['Chime'] }).length, 2)
  assert.equal(scoped({ flows: ['income'] }).length, 2)
  // Kinds AND together.
  assert.equal(scoped({ accounts: ['Chime'], flows: ['income'] }).length, 1)
  assert.equal(scoped({ payees: ['Rent Office'] }).length, 2)
  assert.equal(scoped({}).length, bank.length)
  // A row outside the range is excluded whatever the filters say.
  assert.equal(bank.filter(tx => matchesFinanceScope(tx, { from: '2026-02-01', to: '2026-02-28', filters: {} })).length, 2)
})

test('destinations resolve links and keep the unassigned residual', () => {
  const bank = ledger({ '2026-06': { savings: 600, investments: 900 } })
  const { destinations } = analyze(bank)

  assert.equal(destinations.saved, 3600)
  assert.equal(destinations.invested, 900)
  assert.equal(destinations.destinations.reduce((total, row) => total + row.amount, 0), destinations.total)
  assert.equal(destinations.destinations[0].name, 'Capital One HYSA')
  assert.equal(destinations.unassigned, 900, 'the unlinked investment transfer')
})

test('observations are deterministic, capped at three, and ranked by the fixed catalogue', () => {
  const analysis = analyze(ledger())
  const keys = analysis.observations.map(item => item.key)

  assert.ok(analysis.observations.length <= 3)
  assert.equal(new Set(keys).size, keys.length, 'no key appears twice')
  for (const item of analysis.observations) {
    assert.ok(item.title && item.evidence, `${item.key} carries a deterministic title and evidence`)
    assert.ok(['good', 'steady', 'watch'].includes(item.status))
  }

  // Reversing the input cannot change the result — nothing depends on row order.
  const reversed = analyze([...ledger()].reverse())
  assert.deepEqual(reversed.observations, analysis.observations)
  assert.deepEqual(reversed.cashflow, analysis.cashflow)
})

test('duplicate exposure outranks interpretation, because it says the numbers may be wrong', () => {
  // A small repeat, so the duplicate itself does not also distort the month into an outlier — this
  // isolates the ranking question from the arithmetic one.
  const fee = { date: '2026-02-12', description: 'ANNUAL FEE', amount: -120, category: 'Expense', type: 'expense', source: 'TD Bank' }
  const analysis = analyze([...ledger(), { ...fee, id: 'fee-a' }, { ...fee, id: 'fee-b' }])

  assert.equal(analysis.duplicates.groupCount, 1)
  assert.equal(analysis.duplicates.dollarExposure, 120, 'one extra copy, not both rows')
  assert.equal(analysis.observations[0].key, 'duplicate_exposure')
})

test('duplicates are counted across the whole ledger, never just the scope', () => {
  // The same charge from two exports of one account, a day apart and straddling the scope's end.
  // A scoped check sees one row inside the period and reports nothing — which is exactly the pair
  // most worth surfacing.
  const bank = [
    ...ledger(),
    { id: 'straddle-a', date: '2026-06-30', description: 'ANNUAL FEE', amount: -240, category: 'Expense', type: 'expense', source: 'TD Bank PDF' },
    { id: 'straddle-b', date: '2026-07-01', description: 'ANNUAL FEE', amount: -240, category: 'Expense', type: 'expense', source: 'TD Bank CSV' },
  ]
  const analysis = analyze(bank)
  assert.equal(analysis.duplicates.groupCount, 1)
  assert.equal(analysis.duplicates.dollarExposure, 240)
  // …while the scope itself still stops at June.
  assert.equal(analysis.cashflow.months.at(-1), '2026-06')
  assert.equal(analysis.cashflow.expenses, 21240, 'only the in-scope copy reaches the totals')
})

test('a thin month is only called out when it actually breaks the pattern', () => {
  const steady = analyze(ledger())
  assert.equal(
    steady.observations.some(item => item.key === 'outlier_month'), false,
    'six identical months have a low point, but not a story',
  )

  const withSpike = analyze(ledger({ '2026-04': { savings: 600, expenses: 9000 } }))
  const outlier = withSpike.observations.find(item => item.key === 'outlier_month')
  assert.ok(outlier, 'a month well below the median is worth naming')
  assert.equal(outlier.facts.month, '2026-04')
})

test('an empty ledger produces no observations and no invented facts', () => {
  const analysis = analyze([])
  assert.deepEqual(analysis.observations, [])
  assert.equal(analysis.cashflow.income, 0)
  assert.equal(analysis.cashflow.spendShareOfIncome, null, 'null rather than a 0% claim')
  assert.equal(analysis.cashflow.thinnestMonth, null)
  assert.equal(analysis.pace.status, 'not_enough_data')
})

test('the savings gap is measured per month against the pace window, not against the period total', () => {
  // A 15% target on $6,000 of income is $900 a month; $600 goes across, leaving a $300 gap.
  const analysis = analyze(ledger())
  const gap = analysis.observations.find(item => item.key === 'savings_gap')
  assert.ok(gap)
  assert.equal(gap.facts.target, 900)
  assert.equal(gap.facts.contributions, 600)
  assert.equal(gap.facts.gap, 300, 'a monthly figure, never the six-month contribution')
})
