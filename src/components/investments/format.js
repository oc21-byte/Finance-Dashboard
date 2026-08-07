// Shared formatting for the Investments tab, for the same reason `budget/format.js` exists: eight
// components rounding independently is eight chances for a KPI and a row to disagree by a cent on
// the same figure.

import { formatMoney } from '../../utils/moneyFormat.js'

/** Active display currency for this tab's formatters. Set from Investments when settings load. */
let activeCurrency = 'CAD'

export function setMoneyCurrency(currency) {
  activeCurrency = currency === 'USD' ? 'USD' : 'CAD'
}

/** Whole dollars. Portfolio figures are large enough that cents are noise in a headline. */
export const money = (value, currency = activeCurrency) => formatMoney(value, currency)

/** Two decimals, for per-share prices and APYs where the cents are the point. */
export const exact = (value, digits = 2) => Number(value ?? 0).toLocaleString(undefined, {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
})

export const signedMoney = value => (Number(value) < 0 ? '−' : '+') + money(value)

/**
 * A share count, without the float artifact.
 *
 * Quantities are summed across purchase lots, so a holding of 1.71356 shares arrives as
 * 1.7135600000000002 and rendered straight it reads as broken software. Six decimals is the
 * precision actually stored, and trailing zeros are trimmed so a whole 40 stays `40`.
 */
export const shares = value => Number(Number(value ?? 0).toFixed(6)).toLocaleString(undefined, {
  maximumFractionDigits: 6,
})

export const signedPct = value =>
  (Number(value) < 0 ? '−' : '+') + exact(Math.abs(Number(value) || 0), 1) + '%'

/** Zero is neutral: breaking even is not a gain. */
export const gainClass = value => {
  if (value === null || value === undefined) return 'text-gray-300'
  if (!value) return 'text-gray-500'
  return value > 0 ? 'text-green-600' : 'text-red-500'
}

/** "4 min ago" for the price freshness line. Null until the first fetch lands. */
export function agoLabel(timestamp) {
  if (!timestamp) return null
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} d ago`
}
