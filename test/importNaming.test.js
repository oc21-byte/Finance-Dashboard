import test from 'node:test'
import assert from 'node:assert/strict'
import { matchSourceName } from '../src/utils/sourceNaming.js'

// A statement's printed account identity is EVIDENCE, not a name. These tests pin the one place it
// is allowed to become a suggestion. The bug this replaces mislabelled 71 transactions by silently
// reusing the last card name imported, so the bar here is: match confidently, or say nothing.

test('a printed identity maps onto the name the user already uses', () => {
  const sources = ['Capital One Savor', 'Discover It', 'TD Visa']
  assert.equal(matchSourceName('DISCOVER IT CARD ENDING IN 6957', sources), 'Discover It')
  assert.equal(
    matchSourceName('Savor Credit Card | World Elite Mastercard ending in 5450', sources),
    'Capital One Savor',
  )
})

test('an unrecognised card returns nothing rather than a guess', () => {
  const sources = ['Capital One Savor', 'Discover It']
  assert.equal(matchSourceName('CHASE SAPPHIRE PREFERRED ENDING IN 1234', sources), null)
  assert.equal(matchSourceName('', sources), null)
  assert.equal(matchSourceName(null, sources), null)
  // Nothing to match against is not a licence to invent one.
  assert.equal(matchSourceName('DISCOVER IT CARD ENDING IN 6957', []), null)
})

test('generic words alone never carry a match', () => {
  // "Credit Card ending in 1234" says nothing about WHICH card, and matching a source called
  // "Card" off it would be exactly the silent mislabelling this replaces.
  assert.equal(matchSourceName('CREDIT CARD ENDING IN 1234', ['Card', 'Visa']), null)
  assert.equal(matchSourceName('WORLD ELITE MASTERCARD', ['Mastercard']), null)
})

test('two plausible matches means we do not know', () => {
  // Ambiguity is what caused the original bug. Refuse rather than pick.
  assert.equal(matchSourceName('TD VISA INFINITE CASH BACK 9999', ['TD Visa', 'TD']), null)
})

test('a partial name is not a match — every significant word must be accounted for', () => {
  // "Capital One Venture" must not match a statement that only says Savor.
  const sources = ['Capital One Venture']
  assert.equal(matchSourceName('Savor Credit Card ending in 5450', sources), null)
})

test('a different card from the same issuer is refused, not matched on the issuer', () => {
  // The dangerous near-miss: two Capital One products share "capital" and "one" and differ only in
  // the word that identifies them. Matching on shared issuer words would put a Venture statement
  // onto the Savor — the same class of error as the import that started this.
  assert.equal(matchSourceName('Capital One Venture ending in 1111', ['Capital One Savor']), null)
  assert.equal(
    matchSourceName('Capital One Venture ending in 1111', ['Capital One Savor', 'Capital One Venture']),
    'Capital One Venture',
  )
})

test('product wording around the name does not break the match', () => {
  assert.equal(
    matchSourceName('Discover it Cash Back CARD ENDING IN 6957', ['Discover It', 'TD Visa']),
    'Discover It',
  )
})
