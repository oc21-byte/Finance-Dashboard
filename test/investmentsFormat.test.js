import test from 'node:test'
import assert from 'node:assert/strict'
import { shares, money, signedPct } from '../src/components/investments/format.js'

test('a float artifact from summing lots is not shown to the user', () => {
  // What `recalculateHoldingTotals` actually produces for 1.15 + 0.56356 shares.
  assert.equal(shares(1.7135600000000002), '1.71356')
})

test('a six-decimal quantity survives exactly', () => {
  assert.equal(shares(14.900672), '14.900672')
})

test('a whole share count carries no decimal point', () => {
  assert.equal(shares(40), '40')
  assert.equal(shares(2.5), '2.5')
})

test('a missing quantity reads as zero rather than NaN', () => {
  assert.equal(shares(null), '0')
  assert.equal(shares(undefined), '0')
})

test('money rounds to whole dollars and keeps the thousands separator', () => {
  assert.equal(money(38200.49), '$38,200')
  assert.equal(money(0), '$0')
})

test('a signed percent always carries its sign', () => {
  assert.equal(signedPct(43.14), '+43.1%')
  assert.equal(signedPct(-12.4), '−12.4%')
})
