/**
 * Where a holding's ticker is listed for Yahoo quotes.
 *
 * Statements print bare symbols (XEQT, HURA). Yahoo needs an exchange hint for Canadian
 * names — otherwise HURA is TuHURA Biosciences (US) instead of Global X Uranium (TSX).
 * Mixed CA/US portfolios cannot share one global preference, so each holding carries
 * its own listing when known.
 */

export const LISTINGS = new Set(['CA', 'US'])

/** Canadian registered accounts — used only when a holding has no stored listing. */
export const CA_ACCOUNT_TYPES = new Set(['TFSA', 'RRSP', 'FHSA'])

/** US tax-advantaged accounts — used only when a holding has no stored listing. */
export const US_ACCOUNT_TYPES = new Set(['Roth IRA', 'Traditional IRA', '401(k)', 'HSA'])

export function normalizeListing(value) {
  const v = String(value ?? '').trim().toUpperCase()
  if (v === 'CA' || v === 'CAD' || v === 'TSX' || v === 'TSXV' || v === 'CSE') return 'CA'
  if (v === 'US' || v === 'USD' || v === 'NYSE' || v === 'NASDAQ' || v === 'AMEX' || v === 'ARCA') return 'US'
  return null
}

export function listingFromCurrency(currency) {
  const c = String(currency ?? '').trim().toUpperCase()
  if (c === 'CAD') return 'CA'
  if (c === 'USD') return 'US'
  return null
}

export function listingFromAccountType(accountType) {
  const t = String(accountType ?? '').trim()
  if (CA_ACCOUNT_TYPES.has(t)) return 'CA'
  if (US_ACCOUNT_TYPES.has(t)) return 'US'
  return null
}

/**
 * Resolve the listing used for Yahoo lookups.
 * Explicit holding/position listing wins, then statement currency, then account-type hint,
 * then the app's home currency (USD books → US quotes; CAD books → TSX-first).
 */
export function resolveListing({
  listing, accountType, statementCurrency, displayCurrency,
} = {}) {
  return (
    normalizeListing(listing)
    || listingFromCurrency(statementCurrency)
    || listingFromAccountType(accountType)
    || listingFromCurrency(displayCurrency)
    || null
  )
}

/** Price-map key so the same bare ticker can be quoted on both sides of the border. */
export function priceLookupKey(ticker, listing) {
  const t = String(ticker || '').trim().toUpperCase()
  if (!t) return ''
  const l = normalizeListing(listing)
  return l ? `${t}:${l}` : t
}

/** Read a live price for a holding from a fetchPrices map. */
export function priceOfHolding(prices, holding, displayCurrency) {
  const ticker = String(holding?.ticker || '').trim().toUpperCase()
  if (!ticker) return null
  const listing = resolveListing({ ...holding, displayCurrency })
  const key = priceLookupKey(ticker, listing)
  const price = prices?.[key] ?? prices?.[ticker]
  return price ?? null
}

/** Encode a holding for `/api/prices?tickers=`. */
export function priceQueryToken(holding, displayCurrency) {
  const ticker = String(holding?.ticker || '').trim().toUpperCase()
  if (!ticker) return null
  const listing = resolveListing({ ...holding, displayCurrency })
  return listing ? `${ticker}:${listing}` : ticker
}
