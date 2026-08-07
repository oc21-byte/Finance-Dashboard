// Goals colour tokens.
//
// Same arrangement as `dashboard/palette.js` and `spend/palette.js`: the data ink is tokenised
// here, chrome (cards, borders, body text) stays on stock Tailwind so this tab sits alongside the
// others without looking like a different product. The 7c wireframe's warm palette — beige page,
// amber section labels, sage progress — is deliberately not reproduced; the layout came across,
// the colours did not.
//
// Rings and bars share one entry per tone so a card and the detail panel below it can never
// disagree about how a goal is doing. `ring` is a hex because SVG `stroke` takes a colour, not a
// class; `bar` is a class because the progress bar is a div.

export const TONES = {
  // `reached` and `good` paint the same green on purpose — see `progressTone` in goalsModel.js.
  reached: { ring: '#10b981', bar: 'bg-emerald-500' },
  good: { ring: '#10b981', bar: 'bg-emerald-500' },
  mid: { ring: '#fbbf24', bar: 'bg-amber-400' },
  low: { ring: '#d1d5db', bar: 'bg-gray-300' },
}

/** The unfilled remainder of a ring. Light enough to read as a track, not as a fourth tone. */
export const RING_TRACK = '#f3f4f6'

/** The one badge a card carries. Violet for linked matches the AI/automation accent used app-wide. */
export const CHIPS = {
  linked: 'bg-violet-50 text-violet-700',
  rate: 'bg-blue-50 text-blue-700',
  none: 'bg-gray-100 text-gray-500',
}

/**
 * The allocation bar in the detail panel: this goal's share, other goals', and free capacity.
 * Free is a plain track rather than a colour — it is the absence of a claim, not a third claimant.
 */
export const ALLOCATION = {
  this: 'bg-blue-500 text-white',
  other: 'bg-violet-300 text-white',
  free: 'bg-gray-100 text-gray-400',
}
