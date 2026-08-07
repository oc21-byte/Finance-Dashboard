import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveUploadLedger, resolveInvestmentTarget } from '../src/utils/uploadHistory.js'

test('a missing ledger defaults to bank for legacy clients', () => {
  assert.deepEqual(resolveUploadLedger(undefined), { ledger: 'bank' })
  assert.deepEqual(resolveUploadLedger(''), { ledger: 'bank' })
})

test('a known ledger is accepted as-is', () => {
  assert.deepEqual(resolveUploadLedger('credit_card'), { ledger: 'credit_card' })
  assert.deepEqual(resolveUploadLedger('investment'), { ledger: 'investment' })
})

test('a typo ledger is rejected rather than coerced to bank', () => {
  // Regression: `holdings` / `investments` used to land as bank, so delete-cascade looked at
  // transactions instead of lots and quietly removed nothing (or the wrong rows).
  const bad = resolveUploadLedger('holdings')
  assert.match(bad.error, /Unknown ledger/)
  assert.equal(bad.ledger, undefined)
})

test('a missing investment target defaults to holdings', () => {
  assert.deepEqual(resolveInvestmentTarget(undefined), { target: 'holdings' })
})

test('a typo investment target is rejected rather than coerced to holdings', () => {
  const bad = resolveInvestmentTarget('investment')
  assert.match(bad.error, /Unknown investment target/)
  assert.equal(bad.target, undefined)
})

test('savings and holdings targets are accepted', () => {
  assert.deepEqual(resolveInvestmentTarget('savings'), { target: 'savings' })
  assert.deepEqual(resolveInvestmentTarget('holdings'), { target: 'holdings' })
})
