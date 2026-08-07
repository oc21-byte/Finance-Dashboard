import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DISPLAY_CURRENCY,
  normalizeCurrency,
  resolveDisplayCurrency,
  quoteCurrencyOf,
  toDisplay,
  convertHoldingMoney,
  costCurrencyOf,
} from '../src/utils/displayCurrency.js'
import { buildInvestmentsModel } from '../src/utils/investmentsModel.js'

test('toDisplay is identity within one currency', () => {
  assert.equal(toDisplay(100, 'CAD', 'CAD', 1.4), 100)
  assert.equal(toDisplay(100, 'USD', 'USD', 1.4), 100)
})

test('toDisplay converts USD to CAD and back', () => {
  assert.equal(toDisplay(100, 'USD', 'CAD', 1.4), 140)
  assert.equal(toDisplay(140, 'CAD', 'USD', 1.4), 100)
})

test('toDisplay returns null when a cross-currency conversion has no rate', () => {
  assert.equal(toDisplay(100, 'USD', 'CAD', null), null)
  assert.equal(toDisplay(100, 'USD', 'CAD', 0), null)
})

test('home currency defaults to USD', () => {
  assert.equal(DEFAULT_DISPLAY_CURRENCY, 'USD')
  assert.equal(resolveDisplayCurrency(undefined), 'USD')
  assert.equal(resolveDisplayCurrency('bogus'), 'USD')
  assert.equal(resolveDisplayCurrency('CAD'), 'CAD')
})

test('quote currency follows listing', () => {
  assert.equal(quoteCurrencyOf('CA'), 'CAD')
  assert.equal(quoteCurrencyOf('US'), 'USD')
  assert.equal(normalizeCurrency('cad'), 'CAD')
})

test('a missing FX rate does not mix a USD quote into a CAD total', () => {
  const holding = {
    ticker: 'VOO',
    shares: 10,
    purchasePrice: 100, // CAD book from a Canadian statement
    listing: 'US',
    costCurrency: 'CAD',
  }
  const converted = convertHoldingMoney(holding, {
    prices: { VOO: 500 }, // USD
    displayCurrency: 'CAD',
    usdCad: null,
  })
  assert.equal(converted.currentPrice, null)
  assert.equal(converted.currentValue, null)
  assert.equal(converted.costBasis, 1000)
  assert.equal(converted.value, 1000)
  assert.equal(converted.fxMissing, true)
})

test('US quotes convert into a CAD portfolio total when FX is available', () => {
  const model = buildInvestmentsModel({
    holdings: [
      {
        ticker: 'XEQT', shares: 10, purchasePrice: 40, listing: 'CA', costCurrency: 'CAD',
      },
      {
        ticker: 'VOO', shares: 10, purchasePrice: 100, listing: 'US', costCurrency: 'CAD',
      },
    ],
    prices: { XEQT: 45, VOO: 50 }, // VOO in USD
    displayCurrency: 'CAD',
    usdCad: 1.4,
  })
  // XEQT: 10*45 = 450 CAD; VOO: 10*50*1.4 = 700 CAD → 1150
  assert.equal(model.totalValue, 1150)
  const voo = model.rows.find(r => r.ticker === 'VOO')
  assert.equal(voo.currentPrice, 70)
  assert.equal(voo.costBasis, 1000)
  assert.equal(voo.gainDollar, -300)
})

test('cost currency falls back to quote currency then display currency', () => {
  assert.equal(costCurrencyOf({ listing: 'US' }, { displayCurrency: 'CAD' }), 'USD')
  assert.equal(costCurrencyOf({ costCurrency: 'CAD', listing: 'US' }), 'CAD')
  assert.equal(costCurrencyOf({}, { displayCurrency: 'CAD' }), 'CAD')
})
