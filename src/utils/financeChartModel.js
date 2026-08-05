/**
 * Geometry for the "Money in vs money out" chart.
 *
 * Pure maths, no DOM — the same split as `spendChartModel.js`. The component positions what this
 * returns and owns no arithmetic of its own.
 *
 * THE RULE THAT MATTERS: one `pxPerDollar` governs both directions. A diverging chart drawn with
 * separate up and down scales is a lie — a $2k expense bar would match a $6k income bar and the
 * reader would conclude the month broke even. Everything below exists to keep that single scale
 * while still leaving the baseline somewhere visible.
 *
 * A useful consequence: monthly net is income − expenses, so it is bounded by [−maxOut, +maxIn].
 * Under one shared scale the net line therefore cannot leave the plot, and nothing needs clipping.
 */

import { bankFlowOf } from '../constants/financeRules.js'
import { monthLabel } from './spendAggregations.js'

export const PLOT_H = 260

// Vertical breathing room for the value labels that sit just outside the tallest bars.
const PAD_RATIO = 0.06

// How far the baseline may be pushed toward an edge before it stops moving. Without this, a period
// whose expenses dwarf its income pins the baseline to the very top and the income bars become
// invisible slivers with no room for a label. Applied ONLY when both directions carry data — when
// one side is empty there is nothing to squash and the baseline belongs at the edge.
const MIN_RATIO = 0.35
const MAX_RATIO = 0.78

export const IN_OUT_MODES = [
  { key: 'in_out', label: 'In / out' },
  { key: 'net_only', label: 'Net only' },
  { key: 'cumulative', label: 'Cumulative' },
]

export const SERIES_COLORS = {
  income: '#22c55e',
  expenses: '#f87171',
  net: '#1f2937',
  credits: '#a3e635',
}

const round2 = n => Math.round(n * 100) / 100
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/**
 * Lay out paired up/down magnitudes against one shared scale.
 * @param ups    non-negative magnitude drawn above the baseline, per month
 * @param downs  non-negative magnitude drawn below it, per month
 */
function geometry(ups, downs) {
  const maxUp = Math.max(0, ...ups)
  const maxDown = Math.max(0, ...downs)
  const pad = PLOT_H * PAD_RATIO
  const usable = PLOT_H - pad * 2

  const both = maxUp > 0 && maxDown > 0
  const natural = maxUp + maxDown > 0 ? maxUp / (maxUp + maxDown) : 0.5
  const ratio = both ? clamp(natural, MIN_RATIO, MAX_RATIO) : natural

  const above = usable * ratio
  const below = usable - above

  // Take the tighter of the two allotments so the shared scale honours the clamp instead of
  // overflowing it. When the ratio was not clamped these two are equal and nothing is lost.
  const candidates = []
  if (maxUp > 0) candidates.push(above / maxUp)
  if (maxDown > 0) candidates.push(below / maxDown)
  const pxPerDollar = candidates.length ? Math.min(...candidates) : 0

  return { pxPerDollar, baselineY: pad + above, maxUp, maxDown }
}

/** Per-month income / expense / net totals over an explicit month list. */
function monthlyFlows(bankRows, months, cardCredits, countCredits) {
  const byMonth = new Map(months.map(m => [m, { income: 0, expenses: 0 }]))

  for (const t of bankRows) {
    const bucket = byMonth.get(t.date?.slice(0, 7))
    if (!bucket) continue
    const flow = bankFlowOf(t)
    const amount = Math.abs(Number(t.amount) || 0)
    if (flow === 'income') bucket.income += amount
    else if (flow === 'expense') bucket.expenses += amount
  }

  // A credit only reaches income when the user has opted in; off by default because the credit
  // already shrank a card bill that is counted as an expense here.
  if (countCredits) {
    for (const t of cardCredits) {
      const bucket = byMonth.get(t.date?.slice(0, 7))
      if (bucket) bucket.income += Math.abs(Number(t.amount) || 0)
    }
  }

  return months.map(month => {
    const { income, expenses } = byMonth.get(month)
    return {
      month,
      label: monthLabel(month),
      income: round2(income),
      expenses: round2(expenses),
      net: round2(income - expenses),
      hasActivity: income > 0 || expenses > 0,
    }
  })
}

/**
 * @param mode 'in_out' | 'net_only' | 'cumulative'
 * @returns {{ mode, months, bars, legend, pxPerDollar, baselineY, netPoints, worst, empty, totals }}
 *   `bars[]` carry pre-computed pixel heights; `netPoints[]` carry `xPct` (0–100) and `y` in px,
 *   ready for an SVG polyline with `viewBox="0 0 100 PLOT_H"` and `preserveAspectRatio="none"`.
 */
export function buildInOutModel(bankRows = [], months = [], options = {}) {
  const { mode = 'in_out', cardCredits = [], countCredits = false } = options
  const flows = monthlyFlows(bankRows, months, cardCredits, countCredits)
  const empty = !flows.some(f => f.hasActivity)

  // Running total of net, used by the cumulative view.
  let running = 0
  const cumulative = flows.map(f => {
    running = round2(running + f.net)
    return running
  })

  let ups, downs, values
  if (mode === 'net_only') {
    values = flows.map(f => f.net)
  } else if (mode === 'cumulative') {
    values = cumulative
  } else {
    values = null
  }

  if (values) {
    ups = values.map(v => Math.max(v, 0))
    downs = values.map(v => Math.max(-v, 0))
  } else {
    ups = flows.map(f => f.income)
    downs = flows.map(f => f.expenses)
  }

  const { pxPerDollar, baselineY } = geometry(ups, downs)

  const bars = flows.map((f, i) => {
    const value = values ? values[i] : null
    return {
      month: f.month,
      label: f.label,
      income: f.income,
      expenses: f.expenses,
      net: f.net,
      cumulative: cumulative[i],
      hasActivity: f.hasActivity,
      // Single-value modes carry one signed bar; in/out carries a matched pair.
      value,
      up: round2(ups[i]),
      down: round2(downs[i]),
      upHeight: ups[i] * pxPerDollar,
      downHeight: downs[i] * pxPerDollar,
    }
  })

  // The net line belongs to the in/out view only. In the other two modes the bars already ARE the
  // net, so overlaying the same series on itself would just trace the bar tops.
  const netPoints = mode === 'in_out' && months.length
    ? flows.map((f, i) => ({
        month: f.month,
        value: f.net,
        xPct: ((i + 0.5) / months.length) * 100,
        y: baselineY - f.net * pxPerDollar,
      }))
    : []

  // Thinnest month: the lowest net among months that actually have activity. Not drawn on the
  // chart — an annotation pinned to one point competes with the bars for the same space — but kept
  // here because the deterministic insight layer states it in words, where it reads better.
  //
  // Skipping the empty
  // ones matters — an untouched trailing month has a net of exactly 0, which would beat a real
  // month of positive net and label it as the low point of the period. Ties go to the earliest.
  let worst = null
  for (const f of flows) {
    if (!f.hasActivity) continue
    if (!worst || f.net < worst.net) worst = f
  }
  const worstIndex = worst ? flows.indexOf(worst) : -1

  const totals = flows.reduce(
    (acc, f) => ({
      income: round2(acc.income + f.income),
      expenses: round2(acc.expenses + f.expenses),
      net: round2(acc.net + f.net),
    }),
    { income: 0, expenses: 0, net: 0 },
  )

  return {
    mode,
    months,
    bars,
    empty,
    pxPerDollar,
    baselineY,
    netPoints,
    totals,
    worst: worst
      ? {
          month: worst.month,
          label: worst.label,
          net: worst.net,
          xPct: ((worstIndex + 0.5) / months.length) * 100,
          y: baselineY - worst.net * pxPerDollar,
        }
      : null,
    legend: [
      { key: 'income', label: 'Income', color: SERIES_COLORS.income },
      { key: 'expenses', label: 'Expenses', color: SERIES_COLORS.expenses },
      { key: 'net', label: 'Net cash', color: SERIES_COLORS.net, line: true },
    ],
  }
}
