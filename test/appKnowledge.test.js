import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APP_MODEL, VOCABULARY, COPYWRITER_ROLE, advisorRole, financeSystemPrompt, todayLine,
} from '../server/appKnowledge.js'

test('a composed system prompt carries the role, the app model and the vocabulary', () => {
  const prompt = financeSystemPrompt(COPYWRITER_ROLE)

  assert.ok(prompt.startsWith(COPYWRITER_ROLE), 'the role leads')
  assert.ok(prompt.includes(APP_MODEL))
  assert.ok(prompt.includes(VOCABULARY))
})

test('tab-specific material is appended last, closest to the question', () => {
  const prompt = financeSystemPrompt(advisorRole('Dashboard'), { extra: 'TAB RULES' })

  assert.match(prompt, /answering an advisory question about a stored Dashboard result/)
  assert.ok(prompt.indexOf(VOCABULARY) < prompt.indexOf('TAB RULES'))
  assert.ok(prompt.endsWith('TAB RULES'))
})

test('the date is stated only when a surface reasons about calendar time', () => {
  const asOf = new Date(2026, 7, 16)

  assert.doesNotMatch(financeSystemPrompt(COPYWRITER_ROLE), /Today's date/)
  assert.match(financeSystemPrompt(COPYWRITER_ROLE, { today: true, asOf }), /Today's date is 2026-08-16\./)
})

test('todayLine echoes the injected date rather than reading a clock', () => {
  assert.equal(todayLine('2027-01-05'), "Today's date is 2027-01-05.")
  assert.equal(todayLine(new Date(Date.UTC(2027, 0, 5))), "Today's date is 2027-01-05.")
  assert.throws(() => todayLine('not-a-date'), /valid date/)
})

// The primer states vocabulary and ownership. A figure reaching a model from here would be one no
// deterministic analysis had computed, which is the exact contract the insight triads rest on —
// and `test/financeChat.test.js` already refuses a bare four-digit amount in a system prompt.
test('the primer carries no figures for a model to quote', () => {
  const prompt = financeSystemPrompt(COPYWRITER_ROLE, { today: true, asOf: new Date(2026, 7, 16) })
  const withoutDate = prompt.replace(/Today's date is \d{4}-\d{2}-\d{2}\./, '')

  assert.doesNotMatch(withoutDate, /\$/)
  assert.doesNotMatch(withoutDate, /\d/)
})

test('the vocabulary names the distinctions each tab used to restate for itself', () => {
  // Each of these was previously hand-copied into two to four separate prompt strings, and was
  // absent from any surface nobody remembered to copy it into.
  assert.match(VOCABULARY, /allocation, not spending/)
  assert.match(VOCABULARY, /never call it net worth/)
  assert.match(VOCABULARY, /change in unrealised gain/)
  assert.match(VOCABULARY, /planned or achieved/)
  assert.match(VOCABULARY, /shaming/)
})

test('the app model names every tab and what it owns', () => {
  for (const tab of ['Dashboard', 'Finances', 'Spend Analyzer', 'Budget', 'Investments', 'Goals']) {
    assert.ok(APP_MODEL.includes(tab), `${tab} is named`)
  }
  assert.match(APP_MODEL, /disjoint/)
})
