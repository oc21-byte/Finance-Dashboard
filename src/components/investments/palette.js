// Chart colours for the Investments tab.
//
// Account-type colours live in `dashboard/palette.js` so a TFSA slice here matches the Dashboard
// composition donut. Holding-weight colours are local: they name tickers, not account types, and
// must not borrow the account ramp or a SGOV slice would read as the same thing as Non-Registered.

const HOLDING_RAMP = [
  '#7eb6ff', // blue
  '#a78bfa', // violet
  '#c4b5fd', // lavender
  '#e879a9', // magenta
  '#fb7185', // rose
  '#fb923c', // orange
  '#fbbf24', // amber
  '#a3e635', // lime
  '#2dd4bf', // teal
  '#67e8f9', // cyan
  '#94a3b8', // slate
]

export const UNKNOWN_HOLDING = '#d4d0ca'

/**
 * Stable colours for holding tickers.
 *
 * Assigned from the sorted list of ALL tickers on the page, never a filtered subset — same
 * reasoning as `buildCardColors` / `buildAccountTypeColors`. Colour by rank in a filtered list
 * and a ticker changes shade the moment you click an account chip.
 */
export function buildHoldingColors(tickers = []) {
  const sorted = [...new Set(tickers.filter(Boolean).map(t => String(t).toUpperCase()))].sort()
  return Object.fromEntries(
    sorted.map((ticker, i) => [ticker, HOLDING_RAMP[i % HOLDING_RAMP.length]]),
  )
}
