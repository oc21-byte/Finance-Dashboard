import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinanceAnalysis } from '../server/financeAnalysis.js'
import { createFinanceChatTurn, createFinanceChatBinding } from '../server/financeChat.js'

const SCOPE = {
  from: '2026-01-01',
  to: '2026-06-30',
  filters: {},
  label: 'Jan 1, 2026 – Jun 30, 2026',
}

// Complete calendar months, or `fullMonthsWithData` returns nothing and the pace answers all
// collapse into not_enough_data.
function ledger() {
  return ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].flatMap(month => {
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    return [
      { id: `${month}-in`, date: `${month}-01`, description: 'ACH DEPOSIT, EMPLOYER PAYROLL', amount: 6000, category: 'Income', type: 'income', source: 'TD Bank' },
      { id: `${month}-rent`, date: `${month}-02`, description: 'GREENFIELD PROPERTIES', amount: -2200, category: 'Expense', type: 'expense', source: 'TD Bank' },
      { id: `${month}-card`, date: `${month}-${lastDay}`, description: 'ELECTRONIC PMT-WEB, CAPITAL ONE MOBILE PMT', amount: -1300, category: 'Expense', type: 'expense', source: 'Chime' },
      { id: `${month}-sav`, date: `${month}-05`, description: 'ONLINE XFER TO SAVINGS', amount: -600, category: 'Savings', type: 'expense', source: 'TD Bank' },
    ]
  })
}

const BANK = ledger()

function analysisFor(settings = { budgetSavingsRate: 15 }) {
  return buildFinanceAnalysis({
    bankTransactions: BANK,
    savingsAccounts: [{ id: 'hysa', name: 'Capital One HYSA' }],
    settings,
    insightScope: SCOPE,
  })
}

function turnFor(question, options = {}) {
  const analysis = options.analysis ?? analysisFor()
  return createFinanceChatTurn({
    analysis,
    bankTransactions: BANK,
    settings: { budgetSavingsRate: 15 },
    messages: [{ role: 'user', content: question }],
    ...options,
  })
}

function factReply(query, options = {}) {
  const turn = turnFor('anything at all', options)
  const outcome = turn.completeIntent(JSON.stringify({ mode: 'fact', query }))
  assert.equal(outcome.type, 'reply')
  return outcome.reply
}

test('the three guided prompts are answered without a model call', () => {
  for (const prompt of [
    'How did money in compare with money out?',
    'Where did most of my money go?',
    'How much am I setting aside, and is it enough?',
  ]) {
    const turn = turnFor(prompt)
    assert.ok(turn.directReply, `${prompt} answers deterministically`)
    assert.equal(turn.intentPrompt, null, 'no classification call is made')
    assert.match(turn.directReply, /Based on Jan 1, 2026 – Jun 30, 2026\.$/)
  }

  // Cash flow states the reconciliation the page shows: 36,000 in, 21,000 out, 15,000 net.
  assert.match(turnFor('1').directReply, /\$36,000\.00 came in and \$21,000\.00 went out/)
  assert.match(turnFor('1').directReply, /\$15,000\.00 stayed/)
})

test('allocation is never reported as spending', () => {
  const outflow = turnFor('2').directReply
  assert.match(outflow, /counted separately as allocation/)
  // Savings transfers are absent from the spending breakdown entirely.
  assert.doesNotMatch(outflow, /Online Xfer To Savings/i)

  const allocation = turnFor('3').directReply
  assert.match(allocation, /\$3,600\.00 went to savings/)
  assert.match(allocation, /\$900\.00 monthly target/)

  const netCash = factReply({ metric: 'net_cash', operation: 'get', scope: 'insight' })
  assert.match(netCash, /allocated rather than spent/)
})

test('ledger questions are answered from computed facts, with the payee resolved server-side', () => {
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum' }),
    /You spent \$21,000\.00 across 12 matching payments/,
  )
  assert.match(
    factReply({ metric: 'income', operation: 'sum' }),
    /You received \$36,000\.00 across 6 matching deposits/,
  )
  assert.match(
    factReply({ metric: 'savings', operation: 'sum' }),
    /You set aside \$3,600\.00 across 6 matching transfers/,
  )
  // A partial name resolves to the one payee that matches.
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { payee: 'greenfield' } }),
    /\$13,200\.00 across 6/,
  )
  // "Money out" is spending PLUS allocation — 7,800 of 24,600 — because that is what left the
  // account. A share of spending alone would quietly exclude the savings transfers.
  assert.match(
    factReply({ metric: 'expenses', operation: 'share', filters: { payee: 'Card Payments' } }),
    /\$7,800\.00, or 32% of money out/,
  )
  assert.match(
    factReply({ metric: 'expenses', operation: 'average', averageBy: 'month' }),
    /\$3,500\.00 per month across 6 months/,
  )
  assert.match(
    factReply({ metric: 'expenses', operation: 'largest' }),
    /The largest matching payment was \$2,200\.00 to Greenfield Properties/,
  )
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { account: 'Chime' } }),
    /\$7,800\.00 across 6/,
  )
})

test('a name that matches nothing, or several things, is reported rather than guessed at', () => {
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { payee: 'Wholefoods' } }),
    /could not find a payee matching “Wholefoods”/,
  )
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { account: 'Barclays' } }),
    /could not find an account matching “Barclays”/,
  )
  // A fragment matching several payees asks rather than picking one.
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { payee: 'pay' } }),
    /I found several payee matches for “pay”.*Which one did you mean\?/,
  )
  // …while a fragment matching exactly one still resolves.
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', filters: { account: 'Bank' } }),
    /\$13,200\.00 across 6/,
  )
})

test('comparisons work across payees and across months', () => {
  assert.match(
    factReply({
      metric: 'expenses',
      operation: 'compare',
      compare: { dimension: 'payee', left: 'Greenfield Properties', right: 'Card Payments' },
    }),
    /Greenfield Properties was \$13,200\.00 and Card Payments was \$7,800\.00\. Greenfield Properties was higher by \$5,400\.00\./,
  )
  assert.match(
    factReply({
      metric: 'expenses',
      operation: 'compare',
      compare: { dimension: 'period', left: '2026-01', right: '2026-02' },
    }),
    /They were equal\./,
  )
  assert.match(
    factReply({
      metric: 'expenses',
      operation: 'compare',
      compare: { dimension: 'period', left: 'January', right: 'February' },
    }),
    /two months in YYYY-MM format/,
  )
})

test('Financial Pace answers use the pace window, not the on-screen period', () => {
  const analysis = analysisFor({ budgetSavingsRate: 15, confirmedMonthlyIncome: 6200 })
  const pace = factReply({ metric: 'financial_pace', operation: 'explain', scope: 'financial' }, { analysis })

  assert.match(pace, /Your Financial Pace is/)
  assert.match(pace, /Based on Jan 2026 – Jun 2026\.$/, 'the complete-months window, labelled as such')
  assert.match(
    factReply({ metric: 'headroom', operation: 'get', scope: 'financial' }, { analysis }),
    /Average monthly headroom was \$2,700\.00/,
  )
  // The same metric name in the on-screen scope answers about the period instead.
  assert.match(
    factReply({ metric: 'expenses', operation: 'sum', scope: 'insight' }, { analysis }),
    /\$21,000\.00/,
  )
})

test('duplicates are answered over the whole ledger and never silently resolved', () => {
  const fee = { date: '2026-03-09', description: 'ANNUAL FEE', amount: -95, category: 'Expense', type: 'expense', source: 'TD Bank' }
  const analysis = buildFinanceAnalysis({
    bankTransactions: [...BANK, { ...fee, id: 'fee-a' }, { ...fee, id: 'fee-b' }],
    insightScope: SCOPE,
    settings: {},
  })
  const reply = factReply({ metric: 'duplicates', operation: 'count' }, { analysis })

  assert.match(reply, /1 set of transactions look like repeats, worth \$95\.00/)
  assert.match(reply, /flagged rather than removed/)
  assert.match(reply, /Based on your whole bank ledger, not just this period\.$/)
})

test('intent JSON is validated against the bank allowlist before anything is computed', () => {
  const turn = turnFor('anything at all')
  const reject = (payload, expected) => assert.throws(() => turn.completeIntent(JSON.stringify(payload)), expected)

  // Card-side vocabulary must not be accepted here: there are no merchants or cards on this ledger.
  reject({ mode: 'fact', query: { metric: 'merchants', operation: 'sum' } }, /Unsupported finance-chat metric/)
  reject({ mode: 'fact', query: { metric: 'expenses', operation: 'forecast' } }, /Unsupported finance-chat operation/)
  reject({ mode: 'fact', query: { metric: 'expenses', operation: 'sum', scope: 'profile' } }, /Unsupported finance-chat scope/)
  reject({ mode: 'fact', query: { metric: 'expenses', operation: 'sum', filters: { from: 'March' } } }, /from date must use YYYY-MM-DD/)
  reject({ mode: 'fact', query: { metric: 'expenses', operation: 'sum', filters: { from: '2026-06-01', to: '2026-01-01' } } }, /must not be after the to date/)
  reject({ mode: 'fact', query: { metric: 'expenses', operation: 'compare' } }, /comparison requires a supported dimension/)
  reject({ mode: 'nonsense' }, /must be fact, advice, or clarify/)

  // A clarification is passed straight through as the reply.
  const clarify = turn.completeIntent(JSON.stringify({ mode: 'clarify', question: 'Which month did you mean?' }))
  assert.deepEqual(clarify, { type: 'reply', reply: 'Which month did you mean?' })
})

test('subjective questions route to advisory wording over pre-formatted facts', () => {
  const turn = turnFor('Should I be worried about how much I am spending?')
  assert.equal(turn.directReply, null)
  assert.ok(turn.intentPrompt.user.includes('Payees:'), 'the classifier is given the bank vocabulary')

  const outcome = turn.completeIntent(JSON.stringify({ mode: 'advice' }))
  assert.equal(outcome.type, 'advice')
  assert.match(outcome.prompt.system, /Do not perform arithmetic/)
  assert.match(outcome.prompt.system, /allocation, not spending/)
  assert.match(outcome.prompt.system, /\$21,000\.00/, 'amounts arrive already formatted')
  assert.doesNotMatch(outcome.prompt.system, /\$\d{4}(?!,)/, 'nothing is left for the model to render')

  assert.equal(
    turn.completeAdvice('Spending held steady at $3500 a month, which leaves room to keep saving.'),
    'Spending held steady at $3,500.00 a month, which leaves room to keep saving.',
  )
  assert.throws(() => turn.completeAdvice('A <b>bold</b> claim.'), /must be plain text/)
  assert.throws(() => turn.completeAdvice(''), /was empty/)
})

test('message context is validated and capped before any model call', () => {
  const build = messages => createFinanceChatTurn({
    analysis: analysisFor(),
    bankTransactions: BANK,
    messages,
  })

  assert.throws(() => build([{ role: 'system', content: 'hi' }]), /user or assistant roles/)
  assert.throws(() => build([{ role: 'user', content: '   ' }]), /cannot be empty/)
  assert.throws(() => build([{ role: 'user', content: 'x'.repeat(2001) }]), /cannot exceed 2000 characters/)
  assert.throws(() => build([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]), /latest message to be from the user/)

  // Only the most recent turns are carried, so a long conversation cannot grow the prompt without
  // bound. The classifier sees the last six of them.
  const long = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }))
  const turn = build([...long, { role: 'user', content: 'and now a fresh question' }])
  const conversation = JSON.parse(turn.intentPrompt.user.match(/Conversation:\n(\[[\s\S]*?\n\])/)[1])
  assert.equal(conversation.length, 6)
  assert.equal(conversation.at(-1).content, 'and now a fresh question')
})

test('chat binds to one stored generation and drops a reply the refresh outran', () => {
  const record = {
    period: '6M|2026-01-01|2026-06-30',
    generatedAt: '2026-08-04T18:00:00.000Z',
    analysisVersion: 1,
    scope: SCOPE,
    messages: [],
  }
  const binding = createFinanceChatBinding({
    record,
    period: '6M|2026-01-01|2026-06-30',
    requestScope: { from: '2026-05-01', to: '2026-06-30', filters: {}, label: 'something else' },
  })

  assert.equal(binding.storedInsights, record, 'the stored record owns the conversation')
  assert.deepEqual(binding.scope, SCOPE, 'the STORED scope wins over the screen')
  assert.equal(binding.canAppend(record), true)
  assert.equal(binding.canAppend({ ...record, generatedAt: '2026-08-04T19:00:00.000Z' }), false)
  assert.equal(binding.canAppend({ ...record, period: 'All' }), false)
  assert.equal(binding.canAppend(null), false)

  // A request whose period does not match the record borrows no facts from it.
  const unmatched = createFinanceChatBinding({ record, period: 'All', requestScope: 'all' })
  assert.equal(unmatched.storedInsights, null)
  assert.equal(unmatched.scope, 'all')
  assert.equal(unmatched.canAppend(record), false)
})

test('chat prompts never expose provider credentials', () => {
  const analysis = buildFinanceAnalysis({
    bankTransactions: BANK,
    insightScope: SCOPE,
    settings: { claudeApiKey: 'sk-ant-secret-value', openaiApiKey: 'sk-openai-secret-value', budgetSavingsRate: 15 },
  })
  const turn = turnFor('What should I do next?', {
    analysis,
    settings: { claudeApiKey: 'sk-ant-secret-value', openaiApiKey: 'sk-openai-secret-value' },
  })
  const advice = turn.completeIntent(JSON.stringify({ mode: 'advice' }))
  const serialized = JSON.stringify(turn.intentPrompt) + JSON.stringify(advice.prompt)

  assert.doesNotMatch(serialized, /sk-ant-secret-value/)
  assert.doesNotMatch(serialized, /sk-openai-secret-value/)
})
