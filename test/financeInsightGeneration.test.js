import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinanceAnalysis } from '../server/financeAnalysis.js'
import { createFinanceInsightGeneration, normalizeFinanceInsightRecord } from '../server/financeInsightGeneration.js'

const GENERATED_AT = '2026-08-04T18:00:00.000Z'

const SCOPE = {
  from: '2026-01-01',
  to: '2026-06-30',
  filters: {},
  label: 'Jan 1, 2026 – Jun 30, 2026',
}

// Complete calendar months only — a partial month leaves `fullMonthsWithData` empty and collapses
// every pace assertion into not_enough_data.
function ledger({ income = 6000, expenses = 3500, savings = 600 } = {}) {
  return ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].flatMap(month => {
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    return [
      { id: `${month}-in`, date: `${month}-01`, description: 'ACH DEPOSIT, EMPLOYER PAYROLL', amount: income, category: 'Income', type: 'income', source: 'TD Bank' },
      { id: `${month}-out`, date: `${month}-${lastDay}`, description: 'RENT OFFICE', amount: -expenses, category: 'Expense', type: 'expense', source: 'TD Bank' },
      { id: `${month}-sav`, date: `${month}-05`, description: 'ONLINE XFER TO SAVINGS', amount: -savings, category: 'Savings', type: 'expense', source: 'TD Bank' },
    ]
  })
}

function analyze(overrides = {}) {
  return buildFinanceAnalysis({
    bankTransactions: ledger(),
    settings: { budgetSavingsRate: 15 },
    insightScope: SCOPE,
    ...overrides,
  })
}

function generationFor(analysis) {
  return createFinanceInsightGeneration({
    analysis,
    period: '6M|2026-01-01|2026-06-30',
    periodLabel: SCOPE.label,
    scope: SCOPE,
  })
}

function copyFor(analysis, overrides = {}) {
  return {
    paceSummary: 'Average expenses left room against the savings target this period.',
    observations: analysis.observations.map(item => ({
      key: item.key,
      body: 'A short, plain sentence about this finding.',
    })),
    ...overrides,
  }
}

test('builds a record whose numbers, titles and order all come from the analysis', () => {
  const analysis = analyze()
  const generation = generationFor(analysis)
  const record = generation.complete(JSON.stringify(copyFor(analysis)), GENERATED_AT)

  assert.equal(record.analysisVersion, 1)
  assert.equal(record.period, '6M|2026-01-01|2026-06-30')
  assert.equal(record.periodLabel, SCOPE.label)
  assert.deepEqual(record.scope, SCOPE)
  assert.equal(record.generatedAt, GENERATED_AT)
  assert.equal(record.messages.length, 0)
  assert.equal(record.exploreOptions.length, 3)

  assert.deepEqual(
    record.observations.map(item => item.key),
    analysis.observations.map(item => item.key),
    'the deterministic ranking, not the order the model replied in',
  )
  for (const [index, item] of record.observations.entries()) {
    assert.equal(item.title, analysis.observations[index].title)
    assert.equal(item.evidence, analysis.observations[index].evidence)
    assert.deepEqual(item.facts, analysis.observations[index].facts)
    assert.ok(item.body)
  }
  // The pace object is carried through untouched apart from the added wording.
  assert.equal(record.pace.status, analysis.pace.status)
  assert.equal(record.pace.headroom, analysis.pace.headroom)
  assert.equal(record.cashflow.netCash, analysis.cashflow.netCash)
})

test('the prompt limits AI work to wording deterministic source facts', () => {
  const analysis = analyze()
  const { prompt } = generationFor(analysis)

  assert.match(prompt.system, /already final/i)
  assert.match(prompt.user, /Do not perform arithmetic/)
  assert.match(prompt.user, /allocation, not spending/)
  for (const item of analysis.observations) {
    assert.ok(prompt.user.includes(item.key), `${item.key} is named in the required shape`)
    assert.ok(prompt.user.includes(item.title), `${item.title} is supplied, not requested`)
  }
  // Amounts reach the model pre-formatted, so it never has to render a number itself.
  assert.match(prompt.user, /\$36,000/)
})

test('a model reply is rejected unless it answers exactly the selected keys', () => {
  const analysis = analyze()
  const generation = generationFor(analysis)
  const keys = analysis.observations.map(item => item.key)

  const reject = (copy, expected) => assert.throws(
    () => generation.complete(JSON.stringify(copy), GENERATED_AT),
    expected,
  )

  reject(copyFor(analysis, { observations: [{ key: 'invented_finding', body: 'A new idea.' }] }), /exactly 3 observations/)
  reject(
    copyFor(analysis, { observations: keys.map(() => ({ key: keys[0], body: 'Same key again.' })) }),
    /Duplicate observation key/,
  )
  reject(
    copyFor(analysis, { observations: keys.slice(0, 2).map(key => ({ key, body: 'Only two.' })) }),
    /exactly 3 observations/,
  )
  reject({ paceSummary: 'Only a summary.' }, /exactly paceSummary and observations/)
  reject(copyFor(analysis, { paceSummary: '' }), /non-empty paceSummary/)
})

test('model copy carrying markup, extra sentences or fences is refused before it is stored', () => {
  const analysis = analyze()
  const generation = generationFor(analysis)

  assert.throws(
    () => generation.complete(JSON.stringify(copyFor(analysis, { paceSummary: 'One. Two. Three.' })), GENERATED_AT),
    /no more than 2 sentences/,
  )
  assert.throws(
    () => generation.complete(JSON.stringify(copyFor(analysis, { paceSummary: 'A <b>bold</b> claim.' })), GENERATED_AT),
    /plain text on one line/,
  )
  assert.throws(
    () => generation.complete(JSON.stringify(copyFor(analysis)), 'not-a-timestamp'),
    /valid ISO timestamp/,
  )

  // A fenced response is common enough that it is stripped rather than rejected.
  const fenced = '```json\n' + JSON.stringify(copyFor(analysis)) + '\n```'
  assert.equal(generation.complete(fenced, GENERATED_AT).analysisVersion, 1)
})

test('generation prompts never receive provider credentials', () => {
  const analysis = buildFinanceAnalysis({
    bankTransactions: ledger(),
    insightScope: SCOPE,
    settings: {
      budgetSavingsRate: 15,
      claudeApiKey: 'sk-ant-secret-value',
      openaiApiKey: 'sk-openai-secret-value',
      aiProvider: 'claude',
    },
  })
  const { prompt } = generationFor(analysis)
  const serialized = JSON.stringify(prompt) + JSON.stringify(analysis)

  assert.doesNotMatch(serialized, /sk-ant-secret-value/)
  assert.doesNotMatch(serialized, /sk-openai-secret-value/)
})

test('four-digit currency is formatted in prompts and in previously stored copy', () => {
  const analysis = analyze()
  const { prompt } = generationFor(analysis)
  assert.doesNotMatch(prompt.user, /\$\d{4}(?!,)/, 'no unformatted four-digit amount reaches the model')

  const stored = normalizeFinanceInsightRecord({
    pace: { summary: 'Headroom averaged $2500 a month.', evidence: ['Expenses were $3500.'] },
    observations: [{ key: 'unallocated_cash', body: 'About $1200 stayed put.', evidence: 'Net was $2500.' }],
    messages: [
      { role: 'user', content: 'why is it $2500' },
      { role: 'assistant', content: 'Headroom was $2500.' },
    ],
  })

  assert.equal(stored.pace.summary, 'Headroom averaged $2,500.00 a month.')
  assert.equal(stored.pace.evidence[0], 'Expenses were $3,500.00.')
  assert.equal(stored.observations[0].body, 'About $1,200.00 stayed put.')
  assert.equal(stored.observations[0].evidence, 'Net was $2,500.00.')
  assert.equal(stored.messages[1].content, 'Headroom was $2,500.00.')
  assert.equal(stored.messages[0].content, 'why is it $2500', 'the user\'s own words are never rewritten')
})

test('a sparse ledger still produces a valid record with no observations to word', () => {
  const analysis = buildFinanceAnalysis({ bankTransactions: [], insightScope: SCOPE, settings: {} })
  const generation = generationFor(analysis)

  assert.equal(analysis.observations.length, 0)
  const record = generation.complete(
    JSON.stringify({ paceSummary: 'There is not enough complete bank history to set a pace yet.', observations: [] }),
    GENERATED_AT,
  )
  assert.deepEqual(record.observations, [])
  assert.equal(record.pace.status, 'not_enough_data')
})
