// Dashboard colour tokens.
//
// Mirrors `src/components/spend/palette.js`: one place per tab where chart colours live, so a
// series never depends on a hex typed at a call site. The Dashboard needed this more than most —
// it previously used `#8b5cf6` for BOTH the RRSP donut slice and the portfolio trend line, so the
// same colour meant two different things on one screen.
//
// Chrome (cards, borders, text) stays on stock Tailwind classes so the Dashboard sits alongside
// Finances and Spend without looking like a different product. Only the data ink is tokenised.

// The three buckets stored in history. `fill` is for stacked areas and donut slices — pale enough
// to stack legibly; `stroke` is the saturated form for lines, dots and legend keys.
export const BUCKETS = {
  cash:      { fill: '#bbe7c8', stroke: '#15803d', label: 'Cash' },
  savings:   { fill: '#fde3b0', stroke: '#b45309', label: 'Savings' },
  portfolio: { fill: '#bfdbfe', stroke: '#2563eb', label: 'Portfolio' },
}

// The total sits on the top edge of the stack, so it has to read against every fill beneath it.
export const TOTAL_LINE = '#1f2937'

// The trend's "Total" mode fills the whole area with one colour. That colour must NOT be a
// bucket's — filling it with the portfolio blue would say "this is all portfolio" to anyone who
// just read the legend in Stacked mode, which is the same class of collision (`#8b5cf6` meaning
// two things) this file was written to end. A desaturated slate ties it to TOTAL_LINE instead.
export const TOTAL_FILL = '#dbe2ea'

// Investment account types get their own ramp, distinct from BUCKETS.portfolio.stroke so a slice
// is never confused with the band it rolls up into.
const ACCOUNT_TYPE_RAMP = [
  '#bfdbfe', // blue
  '#c9b6ee', // purple
  '#f9c9d9', // pink
  '#a7e0e4', // cyan
  '#fbd5a5', // orange
  '#cfe8a9', // lime
  '#a9dfd0', // teal
]

export const UNKNOWN_ACCOUNT = '#d4d0ca'

/**
 * Stable colours for investment account types.
 *
 * Assigned from the sorted list of ALL account types, never the filtered one — the same reasoning
 * as `buildCardColors` in the Spend palette. Colour by position in a filtered list and TFSA
 * changes colour the moment the user clicks a slice, which reads as a different account.
 */
export function buildAccountTypeColors(accountTypes = []) {
  const sorted = [...new Set(accountTypes.filter(Boolean))].sort()
  return Object.fromEntries(
    sorted.map((type, i) => [type, ACCOUNT_TYPE_RAMP[i % ACCOUNT_TYPE_RAMP.length]]),
  )
}

// Waterfall bars. `market` is deliberately the portfolio blue — it IS portfolio movement — while
// `unaccounted` is a flat grey that reads as absence of explanation rather than as a category.
export const WATERFALL = {
  baseline:    '#e2ded7',
  moneyIn:     '#bbe7c8',
  moneyOut:    '#f7c9c4',
  market:      '#bfdbfe',
  unaccounted: '#ded9d2',
  total:       '#cdd5df',
  totalStroke: '#94a3b8',
}

// Direction of a change. Used for delta text, never for a bucket.
export const UP = '#15803d'
export const DOWN = '#b3261e'

/** Tailwind text class for a signed delta. Zero is neutral: it is not an achievement. */
export function deltaClass(value) {
  if (!value) return 'text-gray-400'
  return value > 0 ? 'text-green-700' : 'text-red-600'
}

/** `▲ 1,234` / `▼ 1,234` — the arrow carries the sign so the number never needs a minus. */
export function deltaArrow(value) {
  if (!value) return ''
  return value > 0 ? '▲' : '▼'
}
