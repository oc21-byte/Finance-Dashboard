import test from 'node:test'
import assert from 'node:assert/strict'
import {
  payeeOf, accountOf, applyFinanceFilters, buildFinanceKpis,
  buildInflows, buildOutflows, buildDestinations,
  CARD_PAYMENTS_PAYEE, UNASSIGNED_DESTINATION,
} from '../src/utils/financeAggregations.js'

const row = (description, amount = -100, category = 'Expense', type = 'expense') => ({
  id: description + amount, date: '2026-06-15', description, amount, category, type, source: 'TD Bank',
})

const RANGE = { key: '6M', from: '2026-02-01', to: '2026-07-31', monthCount: 6 }

// Real wordings taken from a TD statement — the masked hex references are what broke naive
// grouping, so they are reproduced verbatim rather than simplified.
test('masked reference blobs collapse to one payee', () => {
  const payroll = [
    'ACH DEPOSIT, ECHL PERSONNEL M PAYROLL ****3600005464X',
    'ACH DEPOSIT, ECHL PERSONNEL M PAYROLL ****0600015333X',
    'ACH DEPOSIT, ECHL PERSONNEL M PAYROLL ****9100018160X',
  ].map(d => payeeOf(row(d)))

  assert.equal(new Set(payroll).size, 1)
  assert.equal(payroll[0], 'Echl Personnel M Payroll')
})

test('trace codes and card masks are stripped from debit-card lines', () => {
  const a = payeeOf(row('DBCRD PUR AP, *****31249136125, AUT 032226 VISA DDA PUR AP VENMO ALLIE TROTTA VISA DIRECT * NY'))
  const b = payeeOf(row('DBCRD PUR AP, *****31249136125, AUT 041526 VISA DDA PUR AP VENMO ALLIE TROTTA VISA DIRECT * NY'))
  assert.equal(a, b, 'the same counterparty on two dates must land in one bucket')
  assert.match(a, /Venmo Allie Trotta/)
  assert.doesNotMatch(a, /\d/, 'no reference digits survive into a label')
})

test('venmo groups on the person, not the location the bank stamped on the row', () => {
  // The same person, three ways TD wrote the location field on real rows.
  const spellings = [
    'DBCRD PUR AP, *****31249136125, AUT 030826 VISA DDA PUR AP VENMO COLE MOBERG NEW YORK * NY',
    'DBCRD PUR AP, *****31249136125, AUT 042026 VISA DDA PUR AP VENMO COLE MOBERG VISA DIRECT * NY',
    'DBCRD PUR AP, *****31249136125, AUT 043026 VISA DDA PUR AP VENMO COLE MOBERG BUFFALO * NY',
  ].map(d => payeeOf(row(d)))

  assert.equal(new Set(spellings).size, 1)
  assert.equal(spellings[0], 'Venmo Cole Moberg')
  // Two different people stay apart.
  assert.notEqual(spellings[0], payeeOf(row('DBCRD PUR AP, AUT 041226 VISA DDA PUR AP VENMO RYAN DALE VISA DIRECT * NY')))
  // Cashouts are inflows and keep their own bucket rather than merging with anyone.
  assert.equal(payeeOf(row('ACH DEPOSIT, VENMO CASHOUT ****332609077', 200, 'Income', 'income')), 'Venmo Cashout')
})

test('bank-side card payments collapse into one bucket', () => {
  const wordings = [
    'ELECTRONIC PMT-WEB, CAPITAL ONE MOBILE PMT CA*B*F**25BD937',
    'ELECTRONIC PMT-WEB, CAPITAL ONE MOBILE PMT CA0BCCA6E12AB15',
    'ELECTRONIC PMT-WEB, DISCOVER E-PAYMENT 6957',
    'eTransfer Debit, Online Xfer Transfer to CC 4839500102708722',
    'CHASE CREDIT CARD PAYMENT',
    'PAYMENT - THANK YOU',
  ]
  for (const w of wordings) {
    assert.equal(payeeOf(row(w)), CARD_PAYMENTS_PAYEE, `missed: ${w}`)
  }
})

test('an issuer name alone is not a card payment', () => {
  // Shopping at a merchant that happens to share a bank's name must not be swept into the bucket,
  // and neither must an ordinary bill that merely contains the word "payment".
  assert.notEqual(payeeOf(row('CHASE SAPPHIRE LOUNGE FOOD')), CARD_PAYMENTS_PAYEE)
  assert.notEqual(payeeOf(row('ELECTRONIC PMT-WEB, ROBINHOOD DEBITS ****97522')), CARD_PAYMENTS_PAYEE)
  assert.notEqual(payeeOf(row('CITY WATER BILL PAYMENT')), CARD_PAYMENTS_PAYEE)
})

test('a description that is all transaction tag keeps its own text', () => {
  assert.equal(payeeOf(row('DEPOSIT')), 'Deposit')
  assert.equal(payeeOf(row('MOBILE DEPOSIT')), 'Mobile Deposit')
  assert.equal(payeeOf(row('CHECK #170')), 'Check')
  assert.equal(payeeOf(row('')), 'Unknown')
  assert.equal(payeeOf({}), 'Unknown')
})

test('the truncated statement footer some banks append is discarded', () => {
  const withFooter = payeeOf(row('eTransfer Debit, Online Xfer Transfer to Brokerage 48395 statement is: Ending 4,584.03 Balance 2. List below the amount of deposits'))
  const clean = payeeOf(row('eTransfer Debit, Online Xfer Transfer to Brokerage 48395'))
  assert.equal(withFooter, clean)
})

test('inflows and outflows split on flow, and allocation appears in neither', () => {
  const rows = [
    row('PAYROLL', 5000, 'Income', 'income'),
    row('RENT', -2000, 'Expense', 'expense'),
    row('TRANSFER TO SAVINGS', -700, 'Savings', 'expense'),
    row('VANGUARD BUY', -600, 'Investments', 'expense'),
  ]
  assert.deepEqual(buildInflows(rows).map(r => r.name), ['Payroll'])
  assert.deepEqual(buildOutflows(rows).map(r => r.name), ['Rent'])

  const kpis = buildFinanceKpis(rows, RANGE)
  assert.equal(kpis.expenses, 2000)
  assert.equal(kpis.saved, 700)
  assert.equal(kpis.invested, 600)
  // The reconciliation the two cards depend on.
  assert.equal(kpis.expenses + kpis.saved + kpis.invested, 3300)
  assert.equal(kpis.netCash, 3000, 'allocation is never subtracted from net cash')
})

test('bar-list totals equal the KPI they sit under', () => {
  const rows = [
    row('PAYROLL A', 3000, 'Income', 'income'),
    row('PAYROLL B', 2000, 'Income', 'income'),
    row('RENT', -1200), row('GROCER', -300), row('GROCER', -250),
  ]
  const kpis = buildFinanceKpis(rows, RANGE)
  const sum = list => Math.round(list.reduce((s, r) => s + r.amount, 0) * 100) / 100
  assert.equal(sum(buildInflows(rows)), kpis.income)
  assert.equal(sum(buildOutflows(rows)), kpis.expenses)
  // Repeat visits to one payee merge and count.
  assert.equal(buildOutflows(rows).find(r => r.name === 'Grocer').visits, 2)
})

test('filters combine across kinds and within one kind', () => {
  const rows = [
    { ...row('RENT', -1200), source: 'TD Bank' },
    { ...row('GROCER', -300), source: 'TD Bank' },
    { ...row('PAYROLL', 5000, 'Income', 'income'), source: 'Chime' },
  ]
  assert.equal(applyFinanceFilters(rows, { accounts: ['TD Bank'] }).length, 2)
  assert.equal(applyFinanceFilters(rows, { flows: ['income'] }).length, 1)
  // Kinds AND together: a TD row that is also income does not exist here.
  assert.equal(applyFinanceFilters(rows, { accounts: ['TD Bank'], flows: ['income'] }).length, 0)
  // Values within a kind OR together.
  assert.equal(applyFinanceFilters(rows, { payees: ['Rent', 'Grocer'] }).length, 2)
  assert.equal(applyFinanceFilters(rows, {}), rows, 'no filters returns the input untouched')
  assert.equal(accountOf({}), 'Unknown')
})

test('destinations reconcile with the Saved and Invested KPIs, unassigned included', () => {
  const accounts = [{ id: 'hysa', name: 'Capital One HYSA' }]
  const rows = [
    { ...row('XFER', -3000, 'Savings', 'expense'), id: 's1', linkedSavingsAccountId: 'hysa' },
    { ...row('XFER', -1500, 'Savings', 'expense'), id: 's2', linkedSavingsAccountId: 'hysa' },
    { ...row('XFER', -500, 'Savings', 'expense'), id: 's3' },
    { ...row('ROBINHOOD', -800, 'Investments', 'expense'), id: 'i1', linkedHoldingAccountType: 'Non-Registered' },
    { ...row('ROBINHOOD', -200, 'Investments', 'expense'), id: 'i2' },
    row('RENT', -1200),
    row('PAY', 10000, 'Income', 'income'),
  ]

  const view = buildDestinations(rows, accounts, 2)
  const kpis = buildFinanceKpis(rows, RANGE)

  assert.equal(view.saved, kpis.saved)
  assert.equal(view.invested, kpis.invested)
  assert.equal(view.total, 6000)
  assert.equal(view.destinations.reduce((s, d) => s + d.amount, 0), view.total)
  assert.equal(view.perMonth, 3000)

  const hysa = view.destinations.find(d => d.name === 'Capital One HYSA')
  assert.equal(hysa.amount, 4500)
  assert.equal(hysa.transfers, 2)
  assert.equal(hysa.perMonth, 2250)

  // Two residuals — one per kind — and both sort behind every real destination.
  const residualIndexes = view.destinations
    .map((d, i) => (d.name === UNASSIGNED_DESTINATION ? i : -1))
    .filter(i => i >= 0)
  assert.deepEqual(residualIndexes, [view.destinations.length - 2, view.destinations.length - 1])
  assert.equal(view.unassigned, 700)

  // Segment shares are of total allocation, not of income.
  assert.equal(view.segments.find(s => s.key === 'Savings').share, 5000 / 6000)
  assert.equal(view.segments.reduce((s, x) => s + x.share, 0), 1)
})

test('a link to a deleted account falls back to unassigned rather than naming it', () => {
  const rows = [{ ...row('XFER', -900, 'Savings', 'expense'), linkedSavingsAccountId: 'gone' }]
  const view = buildDestinations(rows, [], 1)
  assert.equal(view.destinations.length, 1)
  assert.equal(view.destinations[0].name, UNASSIGNED_DESTINATION)
  assert.equal(view.unassigned, 900)
})

test('savings share is null rather than zero when there is no income', () => {
  const noIncome = buildFinanceKpis([row('RENT', -1200)], RANGE)
  assert.equal(noIncome.savedShareOfIncome, null)

  const withIncome = buildFinanceKpis(
    [row('PAY', 4000, 'Income', 'income'), row('SAVE', -1000, 'Savings', 'expense')],
    RANGE,
  )
  assert.equal(withIncome.savedShareOfIncome, 0.25)
})

test('card credits reach counted income only when enabled', () => {
  const rows = [row('PAY', 4000, 'Income', 'income'), row('RENT', -1000)]
  const credits = [{ id: 'c', date: '2026-06-02', amount: 150 }]

  const off = buildFinanceKpis(rows, RANGE, credits, false)
  const on = buildFinanceKpis(rows, RANGE, credits, true)

  assert.equal(off.income, on.income, 'raw bank income never moves')
  assert.equal(off.countedIncome, 4000)
  assert.equal(on.countedIncome, 4150)
  assert.equal(on.netCash - off.netCash, 150)
})
