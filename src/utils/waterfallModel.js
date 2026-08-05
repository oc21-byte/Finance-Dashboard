/**
 * Geometry for the Dashboard's "Where the change came from" waterfall.
 *
 * Same split as `financeChartModel.js`: pure maths here, positioning in the component.
 *
 * THE THING THIS CHART HAS TO GET RIGHT: the bars must close. Start plus every step has to land
 * exactly on Today, because the entire claim of the card is that the change is fully explained.
 * `buildChangeAttribution` guarantees the identity in dollars — `other` is *defined* as the
 * residual — so the only way to break it here is to drop a step for being small. Hence
 * `MIN_STEP`: below it a step is dropped, and whatever it was worth is folded into the next one
 * rather than silently discarded.
 *
 * THE AXIS DOES NOT START AT ZERO, and it cannot. A $3k change on a $70k balance is 4% of a
 * zero-based bar, so every step would be a sliver and the card would say nothing. Truncating a bar
 * axis is normally a lie, so three things keep it honest: the floor is a returned value the
 * component prints on the axis, `truncated` tells the component to draw a break mark at the base
 * of the two full-height bars, and every bar is labelled with its dollar value so magnitude is
 * read from the number rather than from the pixels.
 */

const r2 = n => Math.round((n ?? 0) * 100) / 100

export const PLOT_H = 230

// A step worth less than this is rounding noise on a five-figure balance. Folded forward, never
// dropped, so the bars still close.
const MIN_STEP = 0.5

// Sub-pixel bars read as "nothing happened" rather than "a little happened". A step that survives
// MIN_STEP gets at least a visible tick, and its label carries the real figure.
const MIN_BAR_PX = 2

// How much of the plot is given to air. Headroom is for the value labels sitting above each bar;
// underroom only exists on a truncated axis, to keep the step bars off the floor.
const HEADROOM = 0.12
const UNDERROOM = 0.35

// Truncate only when the starting balance genuinely dwarfs the movement. Below this the zero-based
// axis is perfectly readable, and a truncated one would carry all of the risk for none of the gain.
const TRUNCATE_RATIO = 1.5

/**
 * Lay the attribution out as a bridge from Start to Today.
 *
 * @param a  the result of `buildChangeAttribution`
 * @returns  `{ empty, bars, connectors, floor, ceiling, truncated, height, closes }`
 *           `bars[].y`/`.h` are pixels from the top of a `PLOT_H`-tall plot; `.delta` is null on
 *           the two totals, which are levels rather than movements.
 */
export function buildWaterfall(a) {
  const empty = { empty: true, bars: [], connectors: [], floor: 0, ceiling: 0, truncated: false, height: PLOT_H, closes: true }
  if (!a?.from || !a?.to) return empty

  // Order is the story: what you started with, what you put in, what you took out, what the
  // market did, and only then what is left unexplained.
  const unaccounted = r2(a.reconciliation + a.other)
  const steps = [
    { key: 'moneyIn', label: 'Money in', delta: a.moneyIn, kind: 'up' },
    { key: 'moneyOut', label: 'Money out', delta: r2(-a.moneyOut), kind: 'down' },
    { key: 'market', label: 'Market', delta: a.market, kind: 'market' },
    { key: 'unaccounted', label: 'Unaccounted', delta: unaccounted, kind: 'unaccounted' },
  ]

  // Fold anything too small to draw into the following step so the running total is never lost.
  // The last step absorbs its predecessors' remainders, which is why this walks forwards.
  const kept = []
  let carried = 0
  for (const step of steps) {
    const delta = r2(step.delta + carried)
    if (Math.abs(delta) < MIN_STEP) { carried = delta; continue }
    kept.push({ ...step, delta })
    carried = 0
  }
  if (carried && kept.length) kept[kept.length - 1].delta = r2(kept[kept.length - 1].delta + carried)

  // Both totals carry their date. The end point is the newest BALANCE at or before the range end,
  // which on a transaction-anchored range is routinely weeks behind today — so this bar cannot be
  // labelled "Today" on faith. Getting that wrong would put a figure under the word "Today" that
  // contradicts the liquid net worth printed directly above it on the same screen.
  const bars = [{ key: 'start', label: 'Start', date: a.from, kind: 'total', delta: null, value: a.start, lo: 0, hi: a.start }]
  let running = a.start
  for (const step of kept) {
    const next = r2(running + step.delta)
    bars.push({
      ...step,
      value: Math.abs(step.delta),
      lo: Math.min(running, next),
      hi: Math.max(running, next),
      running: next,
    })
    running = next
  }
  const isToday = a.to === new Date().toISOString().slice(0, 10)
  bars.push({ key: 'end', label: isToday ? 'Today' : 'End', date: a.to, kind: 'total', delta: null, value: a.end, lo: 0, hi: a.end })

  // Scale to the totals and to the step extremes. A step that dips below the lower total — money
  // out before money in, in a period that ended up flat — has to stay inside the plot.
  const levels = [a.start, a.end]
  for (const bar of bars) if (bar.kind !== 'total') levels.push(bar.lo, bar.hi)
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const span = hi - lo

  if (!(span > 0)) {
    // Nothing moved. Two equal totals and no steps; draw them at a fixed height rather than
    // dividing by zero.
    return {
      ...empty, empty: false,
      bars: bars.map(b => ({ ...b, y: PLOT_H * 0.3, h: PLOT_H * 0.7 })),
      floor: 0, ceiling: hi, closes: true,
    }
  }

  const truncated = lo > span * TRUNCATE_RATIO
  const floor = truncated ? Math.max(0, lo - span * UNDERROOM) : 0
  const ceiling = hi + span * HEADROOM
  const pxPerDollar = PLOT_H / (ceiling - floor)

  const positioned = bars.map(bar => {
    const top = Math.min(bar.hi, ceiling)
    // Total bars run from zero, which on a truncated axis is off the bottom of the plot. Clamp to
    // the floor: the break mark, not the bar, is what tells the reader the base is missing.
    const bottom = Math.max(bar.lo, floor)
    const h = Math.max(bar.kind === 'total' ? 0 : MIN_BAR_PX, (top - bottom) * pxPerDollar)
    return { ...bar, y: (ceiling - top) * pxPerDollar, h }
  })

  // Dashed carries between one bar's landing level and the next bar's start. Indexed by the bar
  // the connector leads OUT of, so the component can draw it on that column's right edge.
  const connectors = []
  let level = a.start
  for (let i = 0; i < positioned.length - 1; i++) {
    connectors.push({ index: i, y: (ceiling - level) * pxPerDollar })
    if (positioned[i + 1].kind !== 'total') level = positioned[i + 1].running
  }

  return {
    empty: false,
    bars: positioned,
    connectors,
    floor: Math.round(floor),
    ceiling: Math.round(ceiling),
    truncated,
    height: PLOT_H,
    // The identity holds by construction, so a false here means a bug upstream, not a data quirk.
    closes: Math.abs(running - a.end) < 0.01,
  }
}
