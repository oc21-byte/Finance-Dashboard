import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSpendAnalysis } from '../server/spendAnalysis.js'
import { createSpendInsightGeneration, normalizeSpendInsightRecord } from '../server/spendInsightGeneration.js'

const GENERATED_AT = '2026-08-03T18:00:00.000Z'

function complete(analysis, copy, overrides = {}) {
  const generation = createSpendInsightGeneration({
    analysis,
    period: overrides.period ?? '6M|2026-01-01|2026-06-30',
    periodLabel: overrides.periodLabel ?? 'Jan 1, 2026 – Jun 30, 2026',
    scope: overrides.scope ?? {
      from: '2026-01-01',
      to: '2026-06-30',
      filters: {},
      label: 'Jan 1, 2026 – Jun 30, 2026',
    },
  })
  return {
    generation,
    record: generation.complete(JSON.stringify(copy), GENERATED_AT),
  }
}

function completeBankHistory({ income, expenses }) {
  const months = ['2026-01', '2026-02', '2026-03']
  return months.flatMap((month, index) => [
    {
      date: `${month}-${index === 0 ? '01' : '02'}`,
      description: 'Payroll',
      amount: income,
      category: 'Income',
      type: 'income',
    },
    {
      date: `${month}-${index === months.length - 1 ? '31' : '20'}`,
      description: 'Expenses',
      amount: -expenses,
      category: 'Expense',
      type: 'expense',
    },
  ])
}

test('builds a versioned result with summaries, scopes and exploration options', () => {
  const cardTransactions = [
    { date: '2026-01-01', description: 'Market', amount: -50, category: 'Grocery', source: 'Card' },
    { date: '2026-06-30', description: 'Market', amount: -60, category: 'Grocery', source: 'Card' },
  ]
  const analysis = buildSpendAnalysis({
    bankTransactions: completeBankHistory({ income: 6000, expenses: 4500 }),
    cardTransactions,
    settings: { confirmedMonthlyIncome: 6500, budgetSavingsRate: 15 },
  })
  const { record } = complete(analysis, {
    profileSummary: 'Your recent spending stays close to familiar merchants and priorities.',
    financialPaceSummary: 'Average expenses leave enough room for your current savings target.',
  })

  assert.equal(record.analysisVersion, 2)
  assert.equal(record.period, '6M|2026-01-01|2026-06-30')
  assert.equal(record.profile.summary, 'Your recent spending stays close to familiar merchants and priorities.')
  assert.equal(record.financialPace.summary, 'Average expenses leave enough room for your current savings target.')
  assert.equal(record.financialPace.status, 'on_track')
  assert.deepEqual(record.profileScope, analysis.scopes.profile)
  assert.deepEqual(record.financialScope, analysis.scopes.financial)
  assert.deepEqual(record.messages, [])
  assert.equal(record.generatedAt, GENERATED_AT)
  assert.equal('insights' in record, false)
  assert.deepEqual(record.explorePrompt, {
    title: 'Explore your spending',
    body: 'Choose a deeper look, or ask your own question.',
    footer: 'Reply with 1, 2, or 3—or ask anything about your spending.',
  })
  assert.deepEqual(record.exploreOptions.map(option => option.id), ['1', '2', '3'])
  assert.deepEqual(record.exploreOptions.map(option => option.key), [
    'category_patterns',
    'merchant_habits',
    'anomalies_opportunities',
  ])
})

test('the prompt limits AI work to wording deterministic source facts', () => {
  const analysis = buildSpendAnalysis({
    bankTransactions: completeBankHistory({ income: 4000, expenses: 4500 }),
    settings: { budgetSavingsRate: 15 },
  })
  const generation = createSpendInsightGeneration({ analysis, period: 'all', scope: 'all' })

  assert.match(generation.prompt.system, /Never recalculate, alter or contradict/)
  assert.match(generation.prompt.user, /"status": "over_pace"/)
  assert.match(generation.prompt.user, /"headroom": "-\$500\.00"/)
  assert.match(generation.prompt.user, /never a permanent personality/)
  assert.match(generation.prompt.user, /do not offer the category, merchant or anomaly analyses/i)
  assert.equal(generation.prompt.maxTokens, 384)
})

test('preserves sparse-data classifications while allowing careful copy', () => {
  const analysis = buildSpendAnalysis({})
  const { record } = complete(analysis, {
    profileSummary: 'There is not enough card activity yet to identify a Spend Style.',
    financialPaceSummary: 'Add a complete month of bank activity and income to assess your pace.',
  }, { period: 'all', scope: 'all', periodLabel: 'All time' })

  assert.equal(record.profile.name, 'Not enough data')
  assert.equal(record.profile.confidence.level, 'early_read')
  assert.equal(record.financialPace.status, 'not_enough_data')
  assert.equal(record.profileScope, null)
  assert.equal(record.financialScope, null)
  assert.equal(record.scope, null)
})

test('preserves Over Pace arithmetic and accepts fenced JSON copy', () => {
  const analysis = buildSpendAnalysis({
    bankTransactions: completeBankHistory({ income: 4000, expenses: 4500 }),
    settings: { budgetSavingsRate: 15 },
  })
  const generation = createSpendInsightGeneration({ analysis, period: 'all', scope: 'all' })
  const record = generation.complete(`\`\`\`json
{"profileSummary":"More card history is needed before assigning a Spend Style.","financialPaceSummary":"Average expenses exceeded income by $500.00 per month. Review recurring and flexible costs to begin closing the gap."}
\`\`\``, GENERATED_AT)

  assert.equal(record.financialPace.status, 'over_pace')
  assert.equal(record.financialPace.income, 4000)
  assert.equal(record.financialPace.expenses, 4500)
  assert.equal(record.financialPace.headroom, -500)
  assert.match(record.financialPace.summary, /\$500\.00 per month/)
})

test('rejects malformed AI copy before it can be persisted', () => {
  const analysis = buildSpendAnalysis({})
  const generation = createSpendInsightGeneration({ analysis, period: 'all', scope: 'all' })

  assert.throws(
    () => generation.complete('{"profileSummary":"Only one field"}', GENERATED_AT),
    /exactly profileSummary and financialPaceSummary/,
  )
  assert.throws(
    () => generation.complete('not json', GENERATED_AT),
    /Unexpected token|JSON/,
  )
  assert.throws(
    () => generation.complete('{"profileSummary":"A","financialPaceSummary":"B"}', ''),
    /generatedAt/,
  )
  assert.throws(
    () => generation.complete('{"profileSummary":"A","financialPaceSummary":"B"}', 'not-a-date'),
    /generatedAt/,
  )
  assert.throws(
    () => generation.complete('{"profileSummary":"A","financialPaceSummary":"B","extra":"no"}', GENERATED_AT),
    /exactly profileSummary and financialPaceSummary/,
  )
  assert.throws(
    () => generation.complete(JSON.stringify({
      profileSummary: 'First sentence. Second sentence. Third sentence.',
      financialPaceSummary: 'One sentence.',
    }), GENERATED_AT),
    /no more than 2 sentences/,
  )
  assert.throws(
    () => generation.complete(JSON.stringify({
      profileSummary: '`Markdown` is not allowed.',
      financialPaceSummary: 'One sentence.',
    }), GENERATED_AT),
    /plain text/,
  )
})

test('generation prompts never receive provider credentials', () => {
  const secrets = ['claude-secret-value', 'openai-secret-value']
  const analysis = buildSpendAnalysis({
    bankTransactions: completeBankHistory({ income: 5000, expenses: 4000 }),
    settings: {
      claudeApiKey: secrets[0],
      openaiApiKey: secrets[1],
      confirmedMonthlyIncome: 5000,
    },
  })
  const generation = createSpendInsightGeneration({ analysis, period: 'all', scope: 'all' })
  const serializedPrompt = JSON.stringify(generation.prompt)

  for (const secret of secrets) assert.equal(serializedPrompt.includes(secret), false)
})

test('formats four-digit currency in Financial Pace prompts and generated summaries', () => {
  const analysis = buildSpendAnalysis({
    bankTransactions: completeBankHistory({ income: 6919.23, expenses: 3940.88 }),
    settings: { confirmedMonthlyIncome: 6919.23, budgetSavingsRate: 15 },
  })
  const generation = createSpendInsightGeneration({ analysis, period: 'all', scope: 'all' })
  const record = generation.complete(JSON.stringify({
    profileSummary: 'More card history is needed before assigning a Spend Style.',
    financialPaceSummary: 'Your average monthly income of $6919.23 covers your expenses of $3940.88 with $2978.35 of headroom remaining. You are meeting your savings target of $1037.88 per month.',
  }), GENERATED_AT)

  assert.match(generation.prompt.user, /\$6,919\.23/)
  assert.match(generation.prompt.user, /\$3,940\.88/)
  assert.equal(
    record.financialPace.summary,
    'Your average monthly income of $6,919.23 covers your expenses of $3,940.88 with $2,978.35 of headroom remaining. You are meeting your savings target of $1,037.88 per month.',
  )
})

test('formats currency in previously stored insight copy without changing user messages', () => {
  const record = normalizeSpendInsightRecord({
    profile: { summary: 'A typical purchase was $1037.88.' },
    financialPace: {
      summary: 'Monthly headroom was $2978.35.',
      evidence: ['Income was $6919.23.'],
    },
    messages: [
      { role: 'user', content: 'Why is $1037.88 my target?' },
      { role: 'assistant', content: 'The target is $1037.88 per month.' },
    ],
  })

  assert.equal(record.profile.summary, 'A typical purchase was $1,037.88.')
  assert.equal(record.financialPace.summary, 'Monthly headroom was $2,978.35.')
  assert.equal(record.financialPace.evidence[0], 'Income was $6,919.23.')
  assert.equal(record.messages[0].content, 'Why is $1037.88 my target?')
  assert.equal(record.messages[1].content, 'The target is $1,037.88 per month.')
})
