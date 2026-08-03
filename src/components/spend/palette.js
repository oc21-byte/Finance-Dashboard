// Chart colours for the Spend Analyzer.
//
// A category or card owns exactly one colour across the whole page — its ring slice, its bar
// segments, its row in "Where it went" or "Cards". That is the only reason the ring and the bars
// read as one chart rather than two, so nothing here may be assigned per-chart.

// The one slice the ring and the stack both use for "everything not called out individually".
// Grey because it isn't a thing you can click — it's a residual.
export const REST_GREY = '#e5e7eb'

// The dashed average-per-month reference line, and the warm tint on any month total above it.
// Deliberately outside both the category and card palettes so it can never be mistaken for a series.
export const ABOVE_AVG = '#b45309'

export const MERCHANT_BAR = '#cbd5e1'

export const CARD_PALETTE = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6']

/**
 * Assign a stable colour to each card.
 *
 * Always call this with the *whole ledger's* sources, never the filtered set — otherwise removing
 * a filter chip would recolour every remaining card, and the legend you just read would be wrong.
 */
export function buildCardColors(sourceNames) {
  const names = [...new Set(sourceNames.filter(Boolean))].sort()
  return Object.fromEntries(names.map((name, i) => [name, CARD_PALETTE[i % CARD_PALETTE.length]]))
}
