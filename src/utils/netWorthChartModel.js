/**
 * Geometry for the Dashboard's trend chart and composition donut.
 *
 * Same split as `financeChartModel.js` and `waterfallModel.js`: pure maths here, positioning in the
 * component. Hand-built rather than charted, because nothing under `components/finance/` or
 * `components/spend/` uses a chart library and the Dashboard was the last page that did — a stacked
 * area drawn by a different engine reads as a different product on the same scroll.
 *
 * THE RULE FOR THE TREND: the stack is zero-based and always will be. A stacked area encodes
 * quantity as thickness, so a truncated axis does not merely exaggerate — it makes the bands lie
 * about their own proportions. (The waterfall may truncate; it encodes change as an offset, which
 * survives the cut. Different chart, different rule.)
 */

const r2 = n => Math.round((n ?? 0) * 100) / 100

export const PLOT_H = 260

// Bottom to top. Cash sits at the base because it is the most liquid and the most volatile; the
// band a reader tracks against the axis should be the one that actually moves.
export const BAND_ORDER = ['cash', 'savings', 'portfolio']

export const TREND_MODES = [
  { key: 'stacked', label: 'Stacked' },
  { key: 'total', label: 'Total' },
]

/** The smallest 1/2/5 × 10ⁿ at or above `value`, so the axis reads in round numbers. */
function niceCeiling(value) {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude
  }
  return 10 * magnitude
}

/**
 * Lay out the liquid net worth trend.
 *
 * @param points  from `buildTrendSeries` — `{ date, label, cash, savings, portfolio, liquid }`
 * @param mode    'stacked' shows the three buckets; 'total' shows only the headline
 * @returns geometry in a `0 0 100 PLOT_H` viewBox, so x is a percentage and the SVG can be drawn
 *          with `preserveAspectRatio="none"` at any width.
 */
export function buildTrendModel(points = [], mode = 'stacked') {
  if (points.length < 2) return { empty: true, points: [], bands: [], line: '', ticks: [], columns: [], height: PLOT_H, ceiling: 0 }

  const ceiling = niceCeiling(Math.max(...points.map(p => p.liquid)))
  const y = v => PLOT_H - (v / ceiling) * PLOT_H
  const x = i => (i / (points.length - 1)) * 100

  // Cumulative upper edges, so each band is drawn against the one below it rather than from zero.
  const edges = points.map(p => {
    const cash = Math.max(0, p.cash)
    const savings = cash + Math.max(0, p.savings)
    return { cash, savings, portfolio: savings + Math.max(0, p.portfolio) }
  })

  const area = (upper, lower) => [
    ...upper.map((v, i) => `${x(i).toFixed(3)},${y(v).toFixed(2)}`),
    ...lower.map((v, i) => `${x(i).toFixed(3)},${y(v).toFixed(2)}`).reverse(),
  ].join(' ')

  const bands = mode === 'total'
    ? [{ key: 'liquid', path: area(points.map(p => p.liquid), points.map(() => 0)) }]
    : [
        { key: 'cash', path: area(edges.map(e => e.cash), edges.map(() => 0)) },
        { key: 'savings', path: area(edges.map(e => e.savings), edges.map(e => e.cash)) },
        { key: 'portfolio', path: area(edges.map(e => e.portfolio), edges.map(e => e.savings)) },
      ]

  // The total runs along the top edge of the stack, which by construction IS the liquid net worth.
  // Drawn as its own line so the newest point can be checked against the KPI strip by eye.
  const line = points.map((p, i) => `${x(i).toFixed(3)},${y(p.liquid).toFixed(2)}`).join(' ')

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    value: r2(ceiling * f),
    y: PLOT_H - f * PLOT_H,
  }))

  // Hover targets and label anchors, one per point.
  //
  // These MUST be derived from the same `x(i)` the SVG uses. Laying them out as equal flex columns
  // instead puts anchor i at (i + 0.5)/n while the data sits at i/(n − 1) — an offset of half a
  // column that grows toward the edges, so the axis labels name the wrong month and the hover
  // guide lands beside the point it is reporting. `hitFrom`/`hitTo` split the difference between
  // neighbours, which is what makes the nearest point the one you actually get.
  const columns = points.map((p, i) => {
    const here = x(i)
    return {
      ...p,
      index: i,
      xPct: here,
      y: y(p.liquid),
      hitFrom: i === 0 ? 0 : (x(i - 1) + here) / 2,
      hitTo: i === points.length - 1 ? 100 : (here + x(i + 1)) / 2,
      // Labels crowd past a dozen points; thin them rather than shrinking the type to unreadable.
      showLabel: points.length <= 8 || i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0,
    }
  })

  return { empty: false, points, bands, line, ticks, columns, height: PLOT_H, ceiling }
}

/**
 * An SVG path for one donut segment.
 *
 * Angles run clockwise from twelve o'clock, which is where a reader expects a proportion chart to
 * start. A segment covering the whole circle is drawn as two half-arcs, because a single arc whose
 * endpoints coincide renders as nothing at all.
 */
export function arcPath(cx, cy, outer, inner, startAngle, endAngle) {
  const sweep = endAngle - startAngle
  if (sweep <= 0) return ''
  if (sweep >= 360) {
    return [arcPath(cx, cy, outer, inner, 0, 180), arcPath(cx, cy, outer, inner, 180, 360)].join(' ')
  }
  const point = (radius, angle) => {
    const rad = ((angle - 90) * Math.PI) / 180
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]
  }
  const large = sweep > 180 ? 1 : 0
  const [ox1, oy1] = point(outer, startAngle)
  const [ox2, oy2] = point(outer, endAngle)
  const [ix2, iy2] = point(inner, endAngle)
  const [ix1, iy1] = point(inner, startAngle)
  return [
    `M ${ox1.toFixed(3)} ${oy1.toFixed(3)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${ox2.toFixed(3)} ${oy2.toFixed(3)}`,
    `L ${ix2.toFixed(3)} ${iy2.toFixed(3)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${ix1.toFixed(3)} ${iy1.toFixed(3)}`,
    'Z',
  ].join(' ')
}

// A hairline gap between segments so two adjacent slices of similar colour stay distinguishable.
// Skipped when a slice is too thin to survive it — better a touching slice than a vanished one.
const GAP_DEGREES = 1.2

/**
 * Turn composition rows into drawable segments.
 *
 * @param rows  from `buildComposition` — each already carries its `bucket` and `pct`
 */
export function buildDonutModel(rows = [], { cx = 100, cy = 100, outer = 92, inner = 66 } = {}) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!(total > 0)) return { empty: true, total: 0, segments: [] }

  let angle = 0
  const segments = rows.map(row => {
    const sweep = (row.value / total) * 360
    // A gap exists to separate a slice from its neighbour, so a lone slice gets none — otherwise
    // it renders as a full ring with an unexplained notch in it.
    const gap = rows.length > 1 && sweep > GAP_DEGREES * 2 ? GAP_DEGREES : 0
    const segment = {
      ...row,
      path: arcPath(cx, cy, outer, inner, angle, angle + sweep - gap),
      startAngle: angle,
      sweep,
    }
    angle += sweep
    return segment
  })

  return { empty: false, total: r2(total), segments, cx, cy, outer, inner }
}
