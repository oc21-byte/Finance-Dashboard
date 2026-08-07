import test from 'node:test'
import assert from 'node:assert/strict'
import { toVisionStatementType } from '../src/utils/accountStatementType.js'

test('the holdings UI target maps to the investment vision branch', () => {
  // Regression: sending `holdings` through unchanged made /api/parse-pdf-vision treat the
  // PDF as a bank ledger, so positions came back empty and the modal showed
  // "No holdings table found" for a real brokerage account summary.
  assert.equal(toVisionStatementType('holdings'), 'investment')
})

test('the Investments tab id also maps to the investment vision branch', () => {
  assert.equal(toVisionStatementType('investments'), 'investment')
})

test('savings and investment targets pass through unchanged', () => {
  assert.equal(toVisionStatementType('savings'), 'savings')
  assert.equal(toVisionStatementType('investment'), 'investment')
})
