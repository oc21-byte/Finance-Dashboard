// The Investments derivation chain, extracted from the page's render body.
//
// One module so the KPI strip, the account chips, the ranked table and the allocation donut all
// read the same numbers. They previously each recomputed their own slice inline, which is how the
// filter dropdown ended up listing account types the donut had never heard of.

import { resolveListing } from './listing.js'
import { convertHoldingMoney, normalizeCurrency } from './displayCurrency.js'

const r2 = n => Math.round(n * 100) / 100

/** Every holding without an explicit type is Non-Registered, matching the add-holding default. */
export const DEFAULT_ACCOUNT_TYPE = 'Non-Registered'

export function accountTypeOf(holding) {
  return holding?.accountType || DEFAULT_ACCOUNT_TYPE
}

/**
 * Price one holding in the display currency.
 *
 * `currentValue` stays null when Yahoo has no price or FX is missing for a foreign quote —
 * the caller decides what to show. `value` falls back to converted cost so one unpriced ticker
 * cannot make the portfolio appear to shrink by its whole position.
 */
function priceRow(holding, prices, { displayCurrency = 'CAD', usdCad = null } = {}) {
  const ticker = String(holding.ticker || '').toUpperCase()
  const shares = Number(holding.shares) || 0
  const purchasePrice = Number(holding.purchasePrice) || 0
  const converted = convertHoldingMoney(holding, { prices, displayCurrency, usdCad })
  const gainDollar = converted.currentValue !== null
    ? r2(converted.currentValue - converted.costBasis)
    : null
  const gainPct = gainDollar !== null && converted.costBasis > 0
    ? r2((gainDollar / converted.costBasis) * 100)
    : null
  return {
    ...holding,
    ticker,
    shares,
    purchasePrice,
    accountType: accountTypeOf(holding),
    listing: converted.listing ?? resolveListing(holding),
    costCurrency: converted.costCurrency,
    quoteCurrency: converted.quoteCurrency,
    purchaseCount: holding.purchases?.length ?? 1,
    currentPrice: converted.currentPrice,
    costBasis: converted.costBasis,
    currentValue: converted.currentValue,
    value: converted.value,
    gainDollar,
    gainPct,
    fxMissing: converted.fxMissing,
  }
}

/**
 * Everything the page renders, from the three queries it makes.
 *
 * Rows come back ranked by value descending — the mockup's "Holdings ranked by value" — which is
 * also the order the donut and its legend read in, so a slice and a table row line up by eye.
 */
export function buildInvestmentsModel({
  holdings = [],
  prices = {},
  savingsAccounts = [],
  displayCurrency = 'CAD',
  usdCad = null,
} = {}) {
  const home = normalizeCurrency(displayCurrency) || 'CAD'
  const rows = holdings
    .map(h => priceRow(h, prices, { displayCurrency: home, usdCad }))
    .sort((a, b) => b.value - a.value)

  const totalCost = r2(rows.reduce((s, r) => s + r.costBasis, 0))
  const totalValue = r2(rows.reduce((s, r) => s + r.value, 0))
  const totalGain = r2(totalValue - totalCost)
  const totalGainPct = totalCost > 0 ? r2((totalGain / totalCost) * 100) : 0

  // Weight is a share of the portfolio as valued above, so the column sums to 100% even when some
  // rows are priced at cost.
  const weighted = rows.map(r => ({
    ...r,
    weight: totalValue > 0 ? r2((r.value / totalValue) * 100) : 0,
  }))

  // Chips and donut slices both come from here, so a chip can never offer a filter that empties
  // the table and the donut can never draw a type the chips omit.
  const byType = new Map()
  for (const row of weighted) {
    byType.set(row.accountType, (byType.get(row.accountType) ?? 0) + row.value)
  }
  const rollup = [...byType.entries()]
    .map(([name, value]) => ({
      key: name,
      name,
      value: r2(value),
      pct: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value)

  const totalSavings = r2(savingsAccounts.reduce((s, a) => s + (Number(a.balance) || 0), 0))
  const totalAnnualInterest = r2(
    savingsAccounts.reduce((s, a) => s + (Number(a.balance) || 0) * ((Number(a.apy) || 0) / 100), 0),
  )

  return {
    rows: weighted,
    totalCost,
    totalValue,
    totalGain,
    totalGainPct,
    accountTypes: rollup.map(r => r.name),
    rollup,
    totalSavings,
    totalAnnualInterest,
    unpricedCount: weighted.filter(r => r.currentPrice === null).length,
    displayCurrency: home,
  }
}

export function filterByAccount(rows, accountType) {
  return !accountType || accountType === 'All'
    ? rows
    : rows.filter(r => r.accountType === accountType)
}

const SORTERS = {
  ticker: r => r.ticker,
  accountType: r => r.accountType,
  shares: r => r.shares,
  value: r => r.value,
  // An unpriced row has no gain to rank on. It sorts to the bottom in either direction rather
  // than jumping to the top of a descending sort as a bare null would.
  gainPct: r => (r.gainPct ?? -Infinity),
  gainDollar: r => (r.gainDollar ?? -Infinity),
}

export function sortHoldings(rows, field, dir = 'asc') {
  const pick = SORTERS[field]
  if (!pick) return rows
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = pick(a)
    const bv = pick(b)
    if (av < bv) return -sign
    if (av > bv) return sign
    return 0
  })
}
