import { DEFAULT_DISPLAY_CURRENCY, normalizeCurrency, resolveDisplayCurrency } from './displayCurrency.js'

const formatters = {
  CAD: new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }),
  USD: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }),
}

const exactFormatters = {
  CAD: new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
}

/** Whole dollars for headlines. */
export function formatMoney(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  const n = Math.round(Math.abs(Number(value) || 0))
  const code = resolveDisplayCurrency(currency)
  return formatters[code].format(n)
}

/** Two-decimal money for per-share prices. */
export function formatMoneyExact(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  const n = Number(value)
  if (!Number.isFinite(n)) return exactFormatters[resolveDisplayCurrency(currency)].format(0)
  const code = resolveDisplayCurrency(currency)
  return exactFormatters[code].format(n)
}

export function currencyLabel(currency = DEFAULT_DISPLAY_CURRENCY) {
  return resolveDisplayCurrency(currency)
}
