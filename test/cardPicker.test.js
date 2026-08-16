import test from 'node:test'
import assert from 'node:assert/strict'
import {
  walletEntryFor, pickerValueFor, linkKindOf, resolveCard,
} from '../src/utils/rewardsModel.js'

// The picker is the only thing that writes a wallet entry, and `rewardsModel` is the only thing
// that reads one. These tests pin the round trip between them: a value that survives being stored
// and read back, and slots/quarters that never follow a card they were not answered about.

test('a catalog pick round-trips through storage', () => {
  const entry = walletEntryFor('amexBcp')
  assert.equal(entry.kind, 'catalog')
  assert.equal(entry.catalogId, 'amexBcp')
  assert.equal(linkKindOf(entry), 'catalog')
  assert.equal(pickerValueFor(entry), 'amexBcp')
  assert.equal(resolveCard('Blue Cash', entry).short, 'Blue Cash Preferred')
})

test('the two non-catalog answers round-trip, and stay distinguishable', () => {
  for (const kind of ['unlisted', 'none']) {
    const entry = walletEntryFor(kind)
    assert.deepEqual(entry, { kind })
    assert.equal(pickerValueFor(entry), kind)
    assert.equal(linkKindOf(entry), kind)
    assert.equal(resolveCard('x', entry), null)
  }
})

test('clearing the picker stores nothing, so the setup screen can ask again', () => {
  assert.equal(walletEntryFor(''), null)
  assert.equal(pickerValueFor(null), '')
  assert.equal(pickerValueFor(undefined), '')
})

test('re-picking the same card keeps its slots and quarters', () => {
  const previous = { kind: 'catalog', catalogId: 'tdCash', slots: { 0: 'Grocery' }, quarters: { '2026-Q3': 'Transport' } }
  const entry = walletEntryFor('tdCash', previous)
  assert.deepEqual(entry.slots, { 0: 'Grocery' })
  assert.deepEqual(entry.quarters, { '2026-Q3': 'Transport' })
})

test('switching to a different card drops them — they were answers about the old card', () => {
  const previous = { kind: 'catalog', catalogId: 'tdCash', slots: { 0: 'Grocery' }, quarters: { '2026-Q3': 'Transport' } }
  const entry = walletEntryFor('discoverIt', previous)
  assert.deepEqual(entry.slots, {}, 'a TD slot choice means nothing on a Discover card')
  assert.deepEqual(entry.quarters, {})
})

test('a stored id the catalog no longer has still shows in the picker', () => {
  // Rather than snapping silently to "not linked", which would hide that a link ever existed.
  assert.equal(pickerValueFor({ kind: 'catalog', catalogId: 'goneInV2' }), 'goneInV2')
})
