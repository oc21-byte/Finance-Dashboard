/**
 * Home / reporting currency and FX conversion for mixed CA/US portfolios.
 *
 * Bank, card, cash and savings are assumed already entered in `displayCurrency`.
 * Investment quotes arrive in the listing's currency (CA→CAD, US→USD); cost basis
 * may be in the statement currency. Both are converted before totals and gains.
 */

import { resolveListing, priceOfHolding } from './listing.js'

export const DISPLAY_CURRENCIES = new Set(['CAD', 'USD'])

export function normalizeCurrency(value) {
  const v = String(value ?? '').trim().toUpperCase()
  return DISPLAY_CURRENCIES.has(v) ? v : null
}

export function quoteCurrencyOf(listing) {
  if (listing === 'CA') return 'CAD'
  if (listing === 'US') return 'USD'
  return null
}

/**
 * Cost currency for a holding: stored value, else the quote currency, else display currency.
 */
export function costCurrencyOf(holding, { displayCurrency = 'CAD' } = {}) {
  return (
    normalizeCurrency(holding?.costCurrency)
    || quoteCurrencyOf(resolveListing(holding))
    || normalizeCurrency(displayCurrency)
    || 'CAD'
  )
}

/**
 * Convert `amount` from `from` into `to` using a USDCAD rate
 * (how many CAD one USD buys). Missing/invalid rate → null when conversion is needed.
 */
export function toDisplay(amount, from, to, usdCad) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  const src = normalizeCurrency(from)
  const dst = normalizeCurrency(to)
  if (!src || !dst) return null
  if (src === dst) return n
  const rate = Number(usdCad)
  if (!(Number.isFinite(rate) && rate > 0)) return null
  if (src === 'USD' && dst === 'CAD') return n * rate
  if (src === 'CAD' && dst === 'USD') return n / rate
  return null
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/**
 * Price and cost a holding in the display currency.
 *
 * When a foreign quote cannot be converted (no FX), `currentPrice` / `currentValue`
 * stay null so the row falls back to converted cost rather than mixing units.
 */
export function convertHoldingMoney(holding, {
  prices = {},
  displayCurrency = 'CAD',
  usdCad = null,
  rawPrice = undefined,
} = {}) {
  const shares = Number(holding?.shares) || 0
  const purchasePrice = Number(holding?.purchasePrice) || 0
  const listing = resolveListing(holding)
  const home = normalizeCurrency(displayCurrency) || 'CAD'
  const quoteCurrency = quoteCurrencyOf(listing) || home
  const costCurrency = costCurrencyOf(holding, { displayCurrency: home })
  const nativePrice = rawPrice !== undefined
    ? rawPrice
    : priceOfHolding(prices, holding)

  const nativeCost = purchasePrice * shares
  const costBasis = toDisplay(nativeCost, costCurrency, home, usdCad)
  const currentPriceNative = nativePrice !== null && nativePrice !== undefined && Number.isFinite(Number(nativePrice))
    ? Number(nativePrice)
    : null
  const currentPrice = currentPriceNative === null
    ? null
    : toDisplay(currentPriceNative, quoteCurrency, home, usdCad)
  const currentValue = currentPrice === null ? null : currentPrice * shares

  const convertedCost = costBasis
  const value = currentValue !== null
    ? currentValue
    : (convertedCost !== null ? convertedCost : nativeCost)

  return {
    listing,
    quoteCurrency,
    costCurrency,
    currentPrice: currentPrice === null ? null : r2(currentPrice),
    currentValue: currentValue === null ? null : r2(currentValue),
    costBasis: convertedCost === null ? r2(nativeCost) : r2(convertedCost),
    value: r2(value),
    fxMissing: (
      (currentPriceNative !== null && currentPrice === null && quoteCurrency !== home)
      || (convertedCost === null && costCurrency !== home)
    ),
  }
}
