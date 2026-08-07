import { DEFAULT_DISPLAY_CURRENCY, resolveDisplayCurrency } from '../src/utils/displayCurrency.js'

const formatters = {
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

export function formatMoney(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const code = resolveDisplayCurrency(currency)
  return formatters[code].format(number)
}

/** @deprecated Prefer formatMoney(value, displayCurrency). Kept for call sites mid-migration. */
export function formatUsd(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  return formatMoney(value, currency)
}

// Model copy is not trusted to preserve punctuation from a prompt. Normalize every dollar token
// before user-facing AI prose is stored or returned so `$1037.88` always becomes `$1,037.88`.
export function normalizeMoneyText(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  return String(value ?? '').replace(/\$\s*-?\d[\d,]*(?:\.\d+)?/g, token => {
    const formatted = formatMoney(token.replace(/[$,\s]/g, ''), currency)
    return formatted ?? token
  })
}

/** @deprecated Prefer normalizeMoneyText(value, displayCurrency). */
export function normalizeUsdText(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  return normalizeMoneyText(value, currency)
}
