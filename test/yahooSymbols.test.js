import test from 'node:test'
import assert from 'node:assert/strict'
import { yahooSymbolCandidates } from '../src/utils/yahooSymbols.js'

test('unknown listing stays Canadian-first for unsuffixed tickers', () => {
  // Regression: bare HURA is TuHURA Biosciences (USD ~$2), while HURA.TO is Global X
  // Uranium (CAD ~$50). Pricing the FHSA lots at the US symbol manufactured ~97% losses.
  assert.deepEqual(yahooSymbolCandidates('HURA'), ['HURA.TO', 'HURA'])
  assert.deepEqual(yahooSymbolCandidates('xeqt'), ['XEQT.TO', 'XEQT'])
})

test('an already-qualified ticker is left alone', () => {
  assert.deepEqual(yahooSymbolCandidates('XEQT.TO'), ['XEQT.TO'])
  assert.deepEqual(yahooSymbolCandidates('SHOP.V'), ['SHOP.V'])
})

test('empty input yields no candidates', () => {
  assert.deepEqual(yahooSymbolCandidates(''), [])
  assert.deepEqual(yahooSymbolCandidates(null), [])
})
