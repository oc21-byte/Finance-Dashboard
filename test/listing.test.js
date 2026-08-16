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

test('home currency supplies a listing when the holding has none', () => {
  assert.equal(resolveListing({
    accountType: 'Non-Registered',
    displayCurrency: 'USD',
  }), 'US')
  assert.equal(resolveListing({
    accountType: 'Non-Registered',
    displayCurrency: 'CAD',
  }), 'CA')
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

  // A map keyed by bare ticker still resolves, for price maps written before keys carried a
  // listing. The quote is then assumed to be in the listing's currency, which is the best guess
  // available — one more reason a listing-keyed map is the shape to write.
  assert.equal(priceOfHolding({ GIL: 81.6 }, { ticker: 'GIL', listing: 'CA' }), 81.6)
  assert.equal(priceOfHolding({}, { ticker: 'GIL', listing: 'CA' }), null)
})

test('price query tokens carry the listing for /api/prices', () => {
  assert.equal(priceQueryToken({ ticker: 'XEQT', listing: 'CA' }), 'XEQT:CA')
  assert.equal(priceQueryToken({ ticker: 'VOO', accountType: 'Roth IRA' }), 'VOO:US')
  assert.equal(priceQueryToken({ ticker: 'NVDA' }, 'USD'), 'NVDA:US')
  assert.equal(priceQueryToken({ ticker: 'XEQT' }, 'CAD'), 'XEQT:CA')
})
