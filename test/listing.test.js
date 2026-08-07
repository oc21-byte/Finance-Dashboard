import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeListing,
  listingFromCurrency,
  listingFromAccountType,
  resolveListing,
  priceLookupKey,
  priceOfHolding,
  priceQueryToken,
} from '../src/utils/listing.js'
import { yahooSymbolCandidates } from '../src/utils/yahooSymbols.js'

test('currency and exchange aliases normalize to CA or US', () => {
  assert.equal(normalizeListing('cad'), 'CA')
  assert.equal(normalizeListing('TSX'), 'CA')
  assert.equal(normalizeListing('nasdaq'), 'US')
  assert.equal(normalizeListing('other'), null)
})

test('statement currency becomes a default listing', () => {
  assert.equal(listingFromCurrency('CAD'), 'CA')
  assert.equal(listingFromCurrency('USD'), 'US')
})

test('registered account types hint a listing when none is stored', () => {
  assert.equal(listingFromAccountType('FHSA'), 'CA')
  assert.equal(listingFromAccountType('Roth IRA'), 'US')
  assert.equal(listingFromAccountType('Non-Registered'), null)
})

test('explicit listing wins over account type and statement currency', () => {
  assert.equal(resolveListing({
    listing: 'US',
    accountType: 'FHSA',
    statementCurrency: 'CAD',
  }), 'US')
})

test('US listing prefers the bare Yahoo symbol so Harbor TEC is not mistaken for TEC.TO', () => {
  assert.deepEqual(yahooSymbolCandidates('TEC', { listing: 'US' }), ['TEC', 'TEC.TO'])
  assert.deepEqual(yahooSymbolCandidates('HURA', { listing: 'CA' }), ['HURA.TO', 'HURA'])
})

test('price map keys keep CA and US quotes for the same ticker apart', () => {
  assert.equal(priceLookupKey('GIL', 'CA'), 'GIL:CA')
  assert.equal(priceLookupKey('GIL', 'US'), 'GIL:US')
  const prices = { 'GIL:CA': 81.6, 'GIL:US': 58.17 }
  assert.equal(priceOfHolding(prices, { ticker: 'GIL', listing: 'CA' }), 81.6)
  assert.equal(priceOfHolding(prices, { ticker: 'GIL', listing: 'US' }), 58.17)
})

test('price query tokens carry the listing for /api/prices', () => {
  assert.equal(priceQueryToken({ ticker: 'XEQT', listing: 'CA' }), 'XEQT:CA')
  assert.equal(priceQueryToken({ ticker: 'VOO', accountType: 'Roth IRA' }), 'VOO:US')
})
