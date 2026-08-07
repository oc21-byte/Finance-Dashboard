import test from 'node:test'
import assert from 'node:assert/strict'
import { yahooSymbolCandidates } from '../src/utils/yahooSymbols.js'

test('unknown listing prefers the bare US symbol so CDRs cannot steal the quote', () => {
  // Regression: NVDA.TO is NVIDIA CDR (~$49 CAD), not the NASDAQ share (~$219 USD).
  assert.deepEqual(yahooSymbolCandidates('NVDA'), ['NVDA', 'NVDA.TO'])
  assert.deepEqual(yahooSymbolCandidates('HURA'), ['HURA', 'HURA.TO'])
})

test('CA listing stays Canadian-first for unsuffixed tickers', () => {
  // Bare HURA is TuHURA Biosciences (USD ~$2); HURA.TO is Global X Uranium (CAD ~$50).
  assert.deepEqual(yahooSymbolCandidates('HURA', { listing: 'CA' }), ['HURA.TO', 'HURA'])
  assert.deepEqual(yahooSymbolCandidates('xeqt', { listing: 'CA' }), ['XEQT.TO', 'XEQT'])
})

test('an already-qualified ticker is left alone', () => {
  assert.deepEqual(yahooSymbolCandidates('XEQT.TO'), ['XEQT.TO'])
  assert.deepEqual(yahooSymbolCandidates('SHOP.V'), ['SHOP.V'])
})

test('empty input yields no candidates', () => {
  assert.deepEqual(yahooSymbolCandidates(''), [])
  assert.deepEqual(yahooSymbolCandidates(null), [])
})
