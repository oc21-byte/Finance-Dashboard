import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboardAnalysis } from '../server/dashboardAnalysis.js'
import { createDashboardChatTurn, createDashboardChatBinding } from '../server/dashboardChat.js'

// Same fixture as `test/dashboardAnalysis.test.js`, and deliberately so: a chat reply that quotes a
// different figure than the insights above it is the exact failure the triad exists to prevent, and
// sharing the fixture is what lets both suites assert the same numbers.

const ASOF = '2026-06-30'

function bankMonth(month) {
  return [
    { id: `${month}-in`, date: `${month}-01`, description: 'ACH DEPOSIT, EMPLOYER PAYROLL', amount: 6000, category: 'Income', type: 'income', source: 'TD Bank' },
    { id: `${month}-out`, date: `${month}-15`, description: 'RENT OFFICE', amount: -4300, category: 'Expense', type: 'expense', source: 'TD Bank' },
    { id: `${month}-sav`, date: `${month}-05`, description: 'ONLINE XFER TO SAVINGS', amount: -1200, category: 'Savings', type: 'expense', source: 'TD Bank', linkedSavingsAccountId: 'hysa' },
  ]
}

const LEDGER = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].flatMap(bankMonth)

const HISTORY = [
  { date: '2026-01-31', netWorth: 35000, breakdown: { cash: 5000, savings: 20000, portfolio: 10000 }, portfolioCost: 10000, basis: 'market' },
  { date: '2026-06-30', netWorth: 45000, breakdown: { cash: 7500, savings: 26000, portfolio: 11500 }, portfolioCost: 10000, basis: 'market' },
]

const SCOPE = { from: '2026-01-31', to: '2026-06-30', label: 'Jan 31, 2026 – Jun 30, 2026' }

function analyze(overrides = {}) {
  return buildDashboardAnalysis({
    netWorthHistory: HISTORY,
    bankTransactions: LEDGER,
    goals: [
      { id: 'g1', name: 'Emergency Fund', targetAmount: 12000, currentAmount: 6000, targetDate: '2026-10-01', monthlySavings: 500 },
      { id: 'g2', name: 'New Laptop', targetAmount: 2000, currentAmount: 500, targetDate: '2027-01-01' },
    ],
    savingsAccounts: [{ id: 'hysa', name: 'Capital One HYSA', balance: 26000 }],
    holdings: [{ id: 'h1', ticker: 'AAA', shares: 100, purchasePrice: 100, accountType: 'TFSA' }],
    prices: { AAA: 115 },
    cash: 7500,
    checks: [],
    insightScope: SCOPE,
    asOf: ASOF,
    ...overrides,
  })
}

function ask(question, options = {}) {
  const analysis = options.analysis ?? analyze()
  return createDashboardChatTurn({
    analysis,
    storedInsights: options.storedInsights ?? null,
    messages: options.messages ?? [{ role: 'user', content: question }],
  })
}

const factReply = (question, query) =>
  ask(question).completeIntent(JSON.stringify({ mode: 'fact', query })).reply

test('the guided prompts are answered without a model call at all', () => {
  for (const prompt of ['1', 'What moved my liquid net worth?', "What it's sitting in"]) {
    const turn = ask(prompt)
    assert.ok(turn.directReply, `“${prompt}” is answered from computed facts`)
    assert.equal(turn.intentPrompt, null, 'and never reaches the classifier')
  }
})

test('a guided answer covering two topics states its basis once, not once per topic', () => {
  // Runway and goals are both dated to today, so joining them must not staple two answers together
  // with two "Based on …" lines four sentences apart.
  const reply = ask('3').directReply
  assert.match(reply, /covers about 1\.7 months/)
  assert.match(reply, /Emergency Fund is 50% funded/)
  assert.equal(reply.match(/Based on/g).length, 1)
  assert.match(reply, /Based on your balances as they stand today\.$/)
})

test('the change reply quotes the same decomposition the waterfall draws', () => {
  const reply = ask('1').directReply
  assert.match(reply, /moved \$10,000\.00/)
  assert.match(reply, /\$35,000\.00 to \$45,000\.00/)
  assert.match(reply, /\$8,500\.00 of that came from money in against money out/)
  assert.match(reply, /\$1,500\.00 from investment prices/)
  assert.match(reply, /Based on Jan 31, 2026 – Jun 30, 2026\.$/)
})

test('balances are dated to today and the change to the period, never to one basis for both', () => {
  const balance = factReply('what is my liquid net worth', { metric: 'liquid_net_worth', operation: 'get' })
  assert.match(balance, /Liquid net worth is \$45,000\.00\./)
  assert.match(balance, /excludes property, vehicles, private shares and debts/)
  assert.match(balance, /Based on your balances as they stand today\.$/)

  const change = factReply('how much did it move', { metric: 'change', operation: 'explain' })
  assert.match(change, /Based on Jan 31, 2026 – Jun 30, 2026\.$/)
})

test('money out excludes allocation, and market movement is unrealised gain', () => {
  const out = factReply('how much went out', { metric: 'money_out', operation: 'get' })
  assert.match(out, /\$21,500\.00 went out/)
  assert.match(out, /Transfers to savings and investments are not counted here/)

  const market = factReply('what did the markets do', { metric: 'market', operation: 'get' })
  assert.match(market, /Investment prices moved \$1,500\.00/)
  assert.match(market, /money you paid into an investment account is not counted as return/)
})

test('a partial price basis is disclosed rather than quietly quoted', () => {
  const partial = analyze({
    netWorthHistory: [HISTORY[0], { ...HISTORY[1], basis: 'cost' }],
  })
  const reply = ask('market', { analysis: partial })
    .completeIntent(JSON.stringify({ mode: 'fact', query: { metric: 'market', operation: 'get' } })).reply
  assert.match(reply, /no market price available, so this figure is partial/)
})

test('composition answers in whole rows and can narrow to one bucket', () => {
  const all = factReply('what is it in', { metric: 'composition', operation: 'list' })
  assert.match(all, /\$45,000\.00 is held as Savings at \$26,000\.00 \(58%\)/)
  assert.match(all, /TFSA at \$11,500\.00/)

  // "What share is cash?" names a balance but asks a composition question.
  const cash = factReply('what percent is cash', { metric: 'cash', operation: 'share' })
  assert.match(cash, /Cash at \$7,500\.00 \(17%\)/)
})

test('runway states what it was measured over, and why savings are excluded', () => {
  const reply = factReply('how long would my cash last', { metric: 'runway', operation: 'get' })
  assert.match(reply, /\$7,500\.00 in checking covers about 1\.7 months/)
  assert.match(reply, /\$4,300\.00 a month across 4 complete months/)
  assert.match(reply, /Savings and investments are not counted/)
})

test('a goal is resolved by loose name, and ambiguity is asked about rather than guessed', () => {
  const one = factReply('how is the emergency fund doing', { metric: 'goals', operation: 'get', filters: { goal: 'emergency' } })
  assert.match(one, /Emergency Fund is 50% funded/)
  assert.match(one, /\$500\.00 a month from your plan/)
  assert.match(one, /8 months past its Oct 2026 target/)

  const missing = factReply('how is the car fund', { metric: 'goals', operation: 'get', filters: { goal: 'car' } })
  assert.match(missing, /could not find a goal matching “car”/)
})

test('a goal with no funding rate is described as unfunded, not as instantly complete', () => {
  const reply = factReply('how is the laptop goal', { metric: 'goals', operation: 'get', filters: { goal: 'laptop' } })
  assert.match(reply, /New Laptop is 25% funded with \$1,500\.00 to go and no funding rate set/)
  assert.doesNotMatch(reply, /reaches/)
})

test('unaccounted cash is dated and itemised rather than reported as one anonymous total', () => {
  const withGap = analyze({
    checks: [
        { date: '2026-04-15', balance: 4200, expected: 5700, discrepancy: -1500, beyondLedger: false },
      ],
  })
  const reply = ask('what is unaccounted for', { analysis: withGap })
    .completeIntent(JSON.stringify({ mode: 'fact', query: { metric: 'unexplained', operation: 'explain' } })).reply

  assert.match(reply, /-\$1,500\.00 is unaccounted for/)
  assert.match(reply, /Apr 15, 2026/)
  assert.match(reply, /ledger expected \$5,700\.00 and the real balance was \$4,200\.00/)
})

test('a clean period says so instead of inventing a discrepancy', () => {
  const reply = factReply('anything missing', { metric: 'unexplained', operation: 'explain' })
  assert.match(reply, /Every dollar of the change is accounted for/)
})

test('an unsupported metric or operation is refused, never coerced into the nearest one', () => {
  const turn = ask('how much did I spend at the grocery store')
  assert.throws(
    () => turn.completeIntent(JSON.stringify({ mode: 'fact', query: { metric: 'merchants', operation: 'sum' } })),
    /Unsupported dashboard-chat metric/,
  )
  assert.throws(
    () => turn.completeIntent(JSON.stringify({ mode: 'fact', query: { metric: 'cash', operation: 'average' } })),
    /Unsupported dashboard-chat operation/,
  )
  assert.throws(() => turn.completeIntent(JSON.stringify({ mode: 'nonsense' })), /must be fact, advice, or clarify/)
})

test('advice mode hands the model pre-formatted numbers it is forbidden to recompute', () => {
  const turn = ask('should I move some cash into savings')
  const outcome = turn.completeIntent(JSON.stringify({ mode: 'advice' }))

  assert.equal(outcome.type, 'advice')
  assert.match(outcome.prompt.system, /Do not perform arithmetic/)
  assert.match(outcome.prompt.system, /never call it net worth/)
  assert.match(outcome.prompt.system, /\$45,000\.00/, 'the total arrives already formatted')
  assert.doesNotMatch(outcome.prompt.system, /claudeApiKey|openaiApiKey/)
})

test('advisory prose is validated before it is returned', () => {
  const turn = ask('what should I do')
  assert.equal(turn.completeAdvice('You have $45000 in liquid assets.'), 'You have $45,000.00 in liquid assets.')
  assert.throws(() => turn.completeAdvice('<b>Do this</b>'), /plain text/)
  assert.throws(() => turn.completeAdvice('   '), /was empty/)
})

test('a clarification is passed through, and is how ledger questions are turned away', () => {
  const turn = ask('which merchant did I spend the most at')
  const outcome = turn.completeIntent(JSON.stringify({
    mode: 'clarify',
    question: 'That is per-transaction detail — the Spend Analyzer tab covers it. Did you mean what your money is held in?',
  }))
  assert.equal(outcome.type, 'reply')
  assert.match(outcome.reply, /Spend Analyzer tab covers it/)
})

test('malformed conversations are refused rather than half-processed', () => {
  assert.throws(() => ask('x', { messages: [] }), /latest message to be from the user/)
  assert.throws(() => ask('x', { messages: [{ role: 'assistant', content: 'hi' }] }), /latest message to be from the user/)
  assert.throws(() => ask('x', { messages: [{ role: 'user', content: '   ' }] }), /cannot be empty/)
  assert.throws(() => ask('x', { messages: [{ role: 'system', content: 'hi' }] }), /user or assistant roles/)
  assert.throws(() => ask('x', { messages: [{ role: 'user', content: 'a'.repeat(2001) }] }), /cannot exceed 2000/)
})

test('a reply is only appended while the generation it answers is still the stored one', () => {
  const record = { period: '6M|a|b', generatedAt: '2026-06-30T12:00:00.000Z', analysisVersion: 1, messages: [] }
  const binding = createDashboardChatBinding({ record, period: '6M|a|b', requestScope: { from: 'x' } })

  assert.equal(binding.storedInsights, record)
  assert.equal(binding.canAppend(record), true)
  assert.equal(binding.canAppend({ ...record, generatedAt: '2026-07-01T12:00:00.000Z' }), false, 'refreshed since')
  assert.equal(binding.canAppend({ ...record, period: '1Y|a|b' }), false, 're-scoped since')
  assert.equal(binding.canAppend(null), false, 'cleared since')

  // A request naming a period the store does not hold falls back to the client's scope and borrows
  // nothing from the older record.
  const mismatched = createDashboardChatBinding({ record, period: '1M|a|b', requestScope: { from: 'x' } })
  assert.equal(mismatched.storedInsights, null)
  assert.deepEqual(mismatched.scope, { from: 'x' })
})

test('the stored period wins over the screen, so a re-scope mid-question cannot switch the answer', () => {
  const record = { period: '6M|a|b', scope: SCOPE, generatedAt: '2026-06-30T12:00:00.000Z', analysisVersion: 1 }
  const binding = createDashboardChatBinding({
    record, period: '6M|a|b', requestScope: { from: '2026-06-01', to: '2026-06-30' },
  })
  assert.deepEqual(binding.scope, SCOPE)
})
