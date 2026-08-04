const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatUsd(value) {
  const number = Number(value)
  return Number.isFinite(number) ? usd.format(number) : null
}

// Model copy is not trusted to preserve punctuation from a prompt. Normalize every dollar token
// before user-facing AI prose is stored or returned so `$1037.88` always becomes `$1,037.88`.
export function normalizeUsdText(value) {
  return String(value ?? '').replace(/\$-?\d[\d,]*(?:\.\d+)?/g, token => {
    const formatted = formatUsd(token.replace(/[$,]/g, ''))
    return formatted ?? token
  })
}
