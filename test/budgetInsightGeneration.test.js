import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBudgetAnalysis } from '../server/budgetAnalysis.js'
import { createBudgetInsightGeneration, normalizeBudgetInsightRecord } from '../server/budgetInsightGeneration.js'

// The generation's entire claim is that the model wrote nothing but prose. Every test below stops
// that claim going quietly false — a body under a key that was never selected, a number the model
// decided to recompute, or a half-parsed response persisted because most of it looked fine.

const analysis = buildBudgetAnalysis({
  settings: { confirmedMonthlyIncome: 6000, budgetSavingsRate: 15, categoryBudgets: { Dining: 400 } },
  goals: [],
  fin: {
    monthsCovered: 6,
    windowLabel: 'Feb–Jul 2026',
    income: 6000,
    savingsContrib: 400,
    investContrib: 0,
    cardBreakdown: [{ category: 'Dining', monthly: 600 }, { category: 'Shopping', monthly: 300 }],
    bankBreakdown: [{ category: 'Savings', monthly: 400 }],
  },
})

const keys = analysis.observations.map(item => item.key)
const generation = () => createBudgetInsightGeneration({
  analysis, period: 'Budget|2026-02-01|2026-07-31', periodLabel: 'Feb–Jul 2026',
})

const reply = (over = {}) => JSON.stringify({
  headline: 'Your plan is close to balanced.',
  observations: keys.map(key => ({ key, body: 'A short explanation of this finding.' })),
  ...over,
})

const AT = '2026-08-06T12:00:00.000Z'

test('a valid response keeps every deterministic figure and adds only prose', () => {
  const record = generation().complete(reply(), AT)
  assert.equal(record.period, 'Budget|2026-02-01|2026-07-31')
  assert.equal(record.periodLabel, 'Feb–Jul 2026')
  assert.equal(record.fingerprint, analysis.fingerprint)
  assert.equal(record.observations.length, keys.length)
  for (const [index, item] of record.observations.entries()) {
    // Order is the deterministic ranking, not the order the model replied in.
    assert.equal(item.key, keys[index])
    assert.equal(item.title, analysis.observations[index].title)
    assert.equal(item.evidence, analysis.observations[index].evidence)
    assert.equal(item.status, analysis.observations[index].status)
    assert.ok(item.body)
  }
})

test('the model is given the comparisons already made, not the raw numbers to subtract', () => {
  const { user } = generation().prompt
  // Each of these is a comparison the analysis already made. Their absence is what invites a
  // generation to derive one itself and get it wrong — the RUNWAY_COMFORTABLE failure.
  for (const field of [
    'shortfallPerMonth', 'clearsTarget', 'planFitsInsideIncome',
    'overspendAcrossOverCapCategoriesOnlyPerMonth', 'categoriesOverCap', 'percentOfCap', 'overCap',
  ]) {
    assert.ok(user.includes(field), `prompt is missing the pre-made comparison "${field}"`)
  }
  // And the instruction that closes the loop.
  assert.match(user, /Do not perform arithmetic/)
})

// A live generation wrote "caps total $1,748, spending reaches $2,198 — a gap of $486 monthly",
// splicing three supplied figures into an implied subtraction that is false: the $486 counts only
// over-cap categories, so it is not the difference between the two totals.
test('the overspend figure is scoped so it cannot read as the gap between the two totals', () => {
  const { user } = generation().prompt
  assert.ok(user.includes('overspendAcrossOverCapCategoriesOnlyPerMonth'))
  assert.match(user, /not the difference between those two totals/)
  assert.match(user, /Never present one supplied figure as the difference between two others/)

  const capsObservation = analysis.observations.find(item => item.key === 'caps_below_actual')
  if (capsObservation) assert.match(capsObservation.evidence, /Across just the categories that are over/)
})

// Spend's Financial Pace owns the achieved rate. A prompt that said "savings rate" unqualified
// would invite the model to write about the wrong one.
test('the prompt names every savings figure as planned and forbids the achieved framing', () => {
  const { user } = generation().prompt
  assert.ok(user.includes('plannedPerMonth'))
  assert.ok(user.includes('plannedRatePercentOfIncome'))
  assert.match(user, /never what was actually saved/i)
  assert.match(user, /never call it an achieved or actual savings rate/i)
})

test('a body for a key that was not selected rejects the whole generation', () => {
  assert.throws(
    () => generation().complete(reply({
      observations: [...keys.map(key => ({ key, body: 'Fine.' })), { key: 'invented_key', body: 'Extra.' }],
    }), AT),
    /must include exactly \d+ observations/,
  )
})

test('a renamed key rejects rather than being dropped', () => {
  assert.throws(
    () => generation().complete(reply({
      observations: keys.map((key, index) => ({ key: index === 0 ? 'renamed' : key, body: 'Fine.' })),
    }), AT),
    /Unexpected observation key: renamed/,
  )
})

test('a duplicated key rejects rather than the last one winning', () => {
  assert.throws(
    () => generation().complete(reply({
      observations: keys.map(() => ({ key: keys[0], body: 'Fine.' })),
    }), AT),
    /Duplicate observation key/,
  )
})

test('a missing observation rejects rather than persisting a partial record', () => {
  assert.throws(
    () => generation().complete(reply({ observations: keys.slice(1).map(key => ({ key, body: 'Fine.' })) }), AT),
    /must include exactly \d+ observations/,
  )
})

test('an extra top-level field rejects', () => {
  assert.throws(
    () => generation().complete(reply({ recommendation: 'Cut dining.' }), AT),
    /exactly headline and observations/,
  )
})

test('markup and multi-line prose are refused', () => {
  assert.throws(() => generation().complete(reply({ headline: '<b>Nice plan</b>' }), AT), /plain text/)
  assert.throws(() => generation().complete(reply({ headline: 'One.\nTwo.' }), AT), /plain text/)
})

test('an essay where a summary belongs is refused', () => {
  assert.throws(
    () => generation().complete(reply({ headline: 'One. Two. Three. Four.' }), AT),
    /no more than 2 sentences/,
  )
})

test('a fenced response is still parsed', () => {
  const record = generation().complete('```json\n' + reply() + '\n```', AT)
  assert.ok(record.headline)
})

test('a bad timestamp rejects, so a record cannot be stored undated', () => {
  assert.throws(() => generation().complete(reply(), 'not-a-date'), /valid ISO timestamp/)
  assert.throws(() => generation().complete(reply(), ''), /valid ISO timestamp/)
})

test('dollar tokens in model prose are normalized before storage', () => {
  const record = generation().complete(reply({ headline: 'You have $1234.5 spare each month.' }), AT)
  assert.match(record.headline, /\$1,234\.50/)
})

test('a stored record from an older format is normalized on read, not rewritten', () => {
  const normalized = normalizeBudgetInsightRecord({
    headline: 'Spare $1234.5.',
    observations: [{ key: 'k', title: 'T', evidence: 'Was $99.9.', body: 'Body $12.' }],
    messages: [{ role: 'assistant', content: 'About $1234.5.' }, { role: 'user', content: 'and $1.5?' }],
  })
  assert.match(normalized.headline, /\$1,234\.50/)
  assert.match(normalized.observations[0].evidence, /\$99\.90/)
  assert.match(normalized.messages[0].content, /\$1,234\.50/)
  // User messages are the user's own words and are left exactly as typed.
  assert.equal(normalized.messages[1].content, 'and $1.5?')
})

test('a new generation starts an empty conversation', () => {
  assert.deepEqual(generation().complete(reply(), AT).messages, [])
})
