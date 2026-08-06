import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBudgetAnalysis } from '../server/budgetAnalysis.js'
import { createBudgetChatTurn, createBudgetChatBinding } from '../server/budgetChat.js'

// Budget chat answers questions about THE PLAN. These tests exist to stop three failures: an
// answer computed by a second aggregation engine that drifts from the cards; a question about a
// merchant, a balance or an achieved figure answered confidently from a plan that cannot know it;
// and a reply appended to a generation it does not belong to.

const analysis = buildBudgetAnalysis({
  settings: {
    confirmedMonthlyIncome: 6000,
    budgetSavingsRate: 15,
    budgetSavingsTarget: 900,
    categoryBudgets: { Dining: 400, Groceries: 600, Investments: 200 },
  },
  goals: [
    { id: 'g1', name: 'Japan trip', currentAmount: 0, targetAmount: 5000, monthlySavings: 250 },
    { id: 'g2', name: 'New car', currentAmount: 0, targetAmount: 20000, monthlySavings: 0 },
  ],
  fin: {
    monthsCovered: 6,
    windowLabel: 'Feb–Jul 2026',
    income: 6000,
    savingsContrib: 400,
    investContrib: 200,
    cardBreakdown: [
      { category: 'Dining', monthly: 600 },
      { category: 'Groceries', monthly: 500 },
      { category: 'Shopping', monthly: 300 },
    ],
    bankBreakdown: [{ category: 'Savings', monthly: 400 }, { category: 'Investments', monthly: 200 }],
  },
})

const ask = (question, storedInsights = null) =>
  createBudgetChatTurn({ analysis, storedInsights, messages: [{ role: 'user', content: question }] })

const factReply = (question, query) =>
  ask(question).completeIntent(JSON.stringify({ mode: 'fact', query })).reply

// ----------------------------------------------------------- the fact tier

test('a cap question is answered from the computed plan, with the window stated', () => {
  const reply = factReply('what is my dining cap?', {
    metric: 'cap', operation: 'get', filters: { category: 'Dining' },
  })
  assert.match(reply, /Dining is capped at \$400\.00/)
  assert.match(reply, /\$600\.00 actually goes out, \$200\.00 over/)
  assert.match(reply, /Based on your plan against Feb–Jul 2026 averages\./)
})

test('an ambiguous category asks which one rather than guessing', () => {
  // "in" is inside both Dining and Shopping. Picking one would quote a cap the user never asked
  // about, with no signal that a choice was made on their behalf.
  const reply = factReply('what about in', {
    metric: 'cap', operation: 'get', filters: { category: 'in' },
  })
  assert.match(reply, /I found several categories matching/)
  assert.match(reply, /Dining/)
  assert.match(reply, /Shopping/)
})

test('an unknown category says so rather than inventing a cap', () => {
  const reply = factReply('what is my yacht cap?', {
    metric: 'cap', operation: 'get', filters: { category: 'Yacht' },
  })
  assert.match(reply, /could not find a category matching/)
})

test('over-cap questions name every offender and the combined gap', () => {
  const reply = factReply('which caps am I over?', { metric: 'over_caps', operation: 'list', filters: {} })
  assert.match(reply, /Dining at \$600\.00 against a \$400\.00 cap/)
  assert.match(reply, /\$200\.00 a month combined/)
  // Groceries is under its cap and must not be listed as over.
  assert.ok(!/Groceries at/.test(reply))
})

test('uncapped spending is listed with its total', () => {
  const reply = factReply('what has no cap?', { metric: 'uncapped', operation: 'list', filters: {} })
  assert.match(reply, /Shopping at \$300\.00 a month/)
  assert.ok(!reply.includes('Dining at'))
})

test('the allocation answer splits income three ways and sums to the whole', () => {
  const reply = factReply('how does my income divide?', { metric: 'allocation', operation: 'explain', filters: {} })
  assert.match(reply, /Of \$6,000\.00 a month/)
  assert.match(reply, /capped for spending/)
  assert.match(reply, /planned savings/)
})

test('a goal funded from bank activity is disclosed as inferred, not stated as chosen', () => {
  const reply = factReply('how much goes to my goals?', { metric: 'goal_funding', operation: 'list', filters: {} })
  assert.match(reply, /Japan trip at \$250\.00 a month/)
  assert.match(reply, /New car has no funding planned/)
})

test('income says whether it was confirmed or observed', () => {
  const reply = factReply('what income is this based on?', { metric: 'income', operation: 'get', filters: {} })
  assert.match(reply, /\$6,000\.00 of monthly income/)
  assert.match(reply, /take-home pay you confirmed/)
})

test('bank-detected contributions are labelled observations, not plan amounts', () => {
  const reply = factReply('what does my bank show?', {
    metric: 'detected_contributions', operation: 'get', filters: {},
  })
  assert.match(reply, /observations, not plan amounts/)
})

// ----------------------------------------------------------- subject boundary

// Spend's Financial Pace owns the achieved rate. Every plan-side savings answer must qualify
// itself, or the same user reads two different numbers under one name on two tabs.
test('the planned rate answer says it is planned and points at the achieved one', () => {
  const reply = factReply('am I on track?', { metric: 'planned_rate', operation: 'get', filters: {} })
  assert.match(reply, /The plan intends to set aside/)
  assert.match(reply, /Spend Analyzer shows what you actually saved/)
})

test('every savings answer is framed as planned, never as achieved', () => {
  for (const metric of ['savings_planned', 'planned_rate', 'savings_target']) {
    const reply = factReply('savings?', { metric, operation: 'get', filters: {} })
    assert.ok(!/\byou saved\b/i.test(reply), `${metric} claims money was actually saved`)
  }
})

// The allowlist is the boundary. A metric this tab cannot answer must be refused at parse time
// rather than routed to a lookup that would answer confidently from the wrong data.
test('metrics belonging to another tab are rejected outright', () => {
  for (const metric of ['merchant', 'payee', 'transaction', 'liquid_net_worth', 'cash', 'runway']) {
    assert.throws(
      () => ask('anything').completeIntent(JSON.stringify({
        mode: 'fact', query: { metric, operation: 'get', filters: {} },
      })),
      /Unsupported budget-chat metric/,
      `metric "${metric}" was accepted`,
    )
  }
})

test('the classifier is told to send transaction and balance questions elsewhere', () => {
  const { user } = ask('what did I spend at Whole Foods?').intentPrompt
  assert.match(user, /individual transactions, merchants or payees cannot be answered here/)
  assert.match(user, /Spend Analyzer covers card activity/)
  assert.match(user, /balances, net worth or investment performance cannot be answered here/)
  assert.match(user, /Financial Pace shows the achieved rate/)
})

test('a clarification is returned verbatim as the reply', () => {
  const outcome = ask('hmm').completeIntent(JSON.stringify({
    mode: 'clarify', question: 'The Spend Analyzer covers merchant questions — did you mean a category cap?',
  }))
  assert.equal(outcome.type, 'reply')
  assert.match(outcome.reply, /Spend Analyzer covers merchant questions/)
})

// ----------------------------------------------------------- guided prompts

test('a guided choice is answered without a model call at all', () => {
  const turn = ask('Which of my caps are below what I actually spend?')
  assert.ok(turn.directReply)
  assert.equal(turn.intentPrompt, null)
  assert.match(turn.directReply, /Dining at \$600\.00 against a \$400\.00 cap/)
})

test('typing the option number enters the same path as clicking it', () => {
  assert.equal(ask('2').directReply, ask('How does my income divide between caps, savings and what is left?').directReply)
})

// ----------------------------------------------------------- advice tier

test('advice is handed pre-formatted numbers and forbidden from recomputing them', () => {
  const outcome = ask('should I cut dining?').completeIntent(JSON.stringify({ mode: 'advice' }))
  assert.equal(outcome.type, 'advice')
  assert.match(outcome.prompt.system, /Do not perform arithmetic/)
  assert.match(outcome.prompt.system, /never what was actually saved/)
  assert.match(outcome.prompt.system, /\$400\.00/)
})

test('advisory prose is validated and its dollar tokens normalized', () => {
  const turn = ask('should I cut dining?')
  assert.match(turn.completeAdvice('You have $1234.5 spare.'), /\$1,234\.50/)
  assert.throws(() => turn.completeAdvice('<b>Cut it</b>'), /plain text/)
  assert.throws(() => turn.completeAdvice(''), /empty/)
})

// ----------------------------------------------------------- binding

test('a reply is refused when the generation it answers has been replaced', () => {
  const record = { period: 'P', generatedAt: 'T1', analysisVersion: 1, messages: [] }
  const binding = createBudgetChatBinding({ record, period: 'P', requestScope: 'P' })
  assert.equal(binding.storedInsights, record)

  assert.equal(binding.canAppend(record), true)
  // Refreshed in the meantime.
  assert.equal(binding.canAppend({ ...record, generatedAt: 'T2' }), false)
  // Cleared in the meantime.
  assert.equal(binding.canAppend(null), false)
  // Re-scoped in the meantime.
  assert.equal(binding.canAppend({ ...record, period: 'Q' }), false)
})

test('the stored scope wins over the scope on screen', () => {
  const record = { period: 'stored', generatedAt: 'T1', analysisVersion: 1, scope: { label: 'stored window' } }
  const binding = createBudgetChatBinding({ record, period: 'stored', requestScope: 'on-screen' })
  assert.deepEqual(binding.scope, { label: 'stored window' })
})

// ----------------------------------------------------------- message hygiene

test('malformed conversations are refused before any model call', () => {
  assert.throws(() => createBudgetChatTurn({ analysis, messages: 'nope' }), /must be an array/)
  assert.throws(
    () => createBudgetChatTurn({ analysis, messages: [{ role: 'system', content: 'x' }] }),
    /user or assistant roles/,
  )
  assert.throws(() => createBudgetChatTurn({ analysis, messages: [{ role: 'user', content: '  ' }] }), /cannot be empty/)
  assert.throws(
    () => createBudgetChatTurn({ analysis, messages: [{ role: 'user', content: 'x'.repeat(2001) }] }),
    /cannot exceed/,
  )
  assert.throws(
    () => createBudgetChatTurn({ analysis, messages: [{ role: 'assistant', content: 'hi' }] }),
    /latest message to be from the user/,
  )
})
