// Money and rate formatting for the Rewards view.
//
// Rewards are small numbers standing next to large ones: a $4,300 grocery month earns $258. Whole
// dollars everywhere would round a real week's earnings to "$12" and a thin category to "$0", so
// anything under $100 keeps its cents and everything above drops them — the precision follows the
// magnitude, which is how a person reads these figures anyway.

export function money(value) {
  const n = Number(value) || 0
  if (Math.abs(n) < 100 && n !== 0) {
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return '$' + Math.round(n).toLocaleString()
}

/** Whole dollars, for spend rather than reward. */
export function dollars(value) {
  return '$' + Math.round(Number(value) || 0).toLocaleString()
}

/** A rate. Trailing `.0` is noise on a 5% card, so one decimal only when it says something. */
export function rate(value) {
  const n = Math.round((Number(value) || 0) * 10) / 10
  return `${n}%`
}
