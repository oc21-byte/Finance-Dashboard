import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScopeKey, describeScope } from '../src/utils/period.js'

// These strings are PERSISTED in db.json as spendInsights.period / financeInsights.period and
// compared by equality before a chat reply is appended. If a change to FILTER_ORDER or
// FILTER_PREFIX alters an existing key, every stored record silently goes stale — the insights
// never refresh themselves and chat replies are refused, with no error raised anywhere.
//
// These are therefore golden-value tests on purpose. If one fails, the fix is almost never to
// update the expected string.

const RANGE = { key: '6M', from: '2026-02-01', to: '2026-07-31', label: 'Feb 1 – Jul 31, 2026' }

test('card scope keys are unchanged by the addition of bank filter kinds', () => {
  assert.equal(buildScopeKey(RANGE, {}), '6M|2026-02-01|2026-07-31')
  assert.equal(
    buildScopeKey(RANGE, { categories: ['Food & Dining'] }),
    '6M|2026-02-01|2026-07-31|cat:Food & Dining',
  )
  assert.equal(
    buildScopeKey(RANGE, { categories: ['Grocery', 'Food & Dining'], cards: ['Amex'], merchants: ['UBER'] }),
    '6M|2026-02-01|2026-07-31|cat:Food & Dining,Grocery|card:Amex|merch:UBER',
  )
  // Empty arrays must emit nothing, or an untouched filter bar would change the key.
  assert.equal(
    buildScopeKey(RANGE, { categories: [], cards: [], merchants: [], accounts: [], flows: [], payees: [] }),
    '6M|2026-02-01|2026-07-31',
  )
})

test('bank filter kinds encode after the card kinds', () => {
  assert.equal(
    buildScopeKey(RANGE, { accounts: ['TD Bank'], flows: ['income'], payees: ['RENT'] }),
    '6M|2026-02-01|2026-07-31|acct:TD Bank|flow:income|payee:RENT',
  )
  // Values sort within a kind, so chip click order cannot produce two keys for one scope.
  assert.equal(
    buildScopeKey(RANGE, { payees: ['RENT', 'CARD PAYMENTS'] }),
    buildScopeKey(RANGE, { payees: ['CARD PAYMENTS', 'RENT'] }),
  )
})

test('a missing range falls back to an All-time key rather than throwing', () => {
  assert.equal(buildScopeKey(null, {}), 'All||')
  assert.equal(buildScopeKey(undefined, { flows: ['expense'] }), 'All|||flow:expense')
})

test('describeScope names bank filters with bank nouns', () => {
  assert.equal(describeScope(RANGE, {}), 'Feb 1 – Jul 31, 2026')
  assert.equal(
    describeScope(RANGE, { accounts: ['TD Bank'] }),
    'Feb 1 – Jul 31, 2026, filtered to account TD Bank',
  )
  assert.equal(
    describeScope(RANGE, { flows: ['income', 'savings'] }),
    'Feb 1 – Jul 31, 2026, filtered to types income, savings',
  )
})
