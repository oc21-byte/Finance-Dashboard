import {
  buildMonthlyByCategory, buildMonthlyByCard, buildCategoryTotals, buildCardTotals,
} from './spendAggregations.js'
import { REST_GREY } from '../components/spend/palette.js'

/** Plot height in px. */
export const PLOT_H = 280

/**
 * How many series get their own colour. The rest collapse into one "Other" slice.
 *
 * The donut and the stack share this number, which is the whole point: a colour means the same
 * thing in both, so reading the ring tells you how to read the bars.
 */
export const NAMED_SERIES = 4

/**
 * Everything the "Spend over time" card draws, derived in one pass so the donut and the stacked
 * bars can never disagree about what a colour means.
 *
 * Lives outside the component so it can be checked directly against `data/db.json`.
 *
 * @param spendTxs negatives only, already scoped by period and filter chips
 * @param months   ordered `YYYY-MM` list from `resolvePeriod`; defines the bar columns
 * @param mode     'category' | 'card' — what both the ring and the stack break out by
 */
export function buildSpendOverTime(spendTxs, months, mode, categoryColors = {}, cardColors = {}) {
  const byCard = mode === 'card'
  const kind = byCard ? 'cards' : 'categories'
  const byMonth = byCard
    ? buildMonthlyByCard(spendTxs, months)
    : buildMonthlyByCategory(spendTxs, months)
  const ranked = byCard ? buildCardTotals(spendTxs) : buildCategoryTotals(spendTxs)
  const colorOf = name => (byCard ? cardColors[name] : categoryColors[name]) || '#94a3b8'

  const totals = byMonth.data.map(d => d.total)
  const total = totals.reduce((a, b) => a + b, 0)
  const avgMonth = total / Math.max(months.length, 1)

  // Headroom above the tallest bar so the total label has somewhere to sit.
  const scaleMax = Math.max(...totals, 0) * 1.14 || 1
  const barPx = v => (v / scaleMax) * PLOT_H

  const named = ranked.slice(0, NAMED_SERIES)
  const namedNames = named.map(r => r.name)
  const restTotal = total - named.reduce((sum, r) => sum + r.amount, 0)

  // One legend, driving both the ring and the stack.
  const legend = named.map(r => ({
    name: r.name,
    color: colorOf(r.name),
    amount: r.amount,
    share: total > 0 ? r.amount / total : 0,
    // `kind` doubles as "is this a real series?" — the Other bucket isn't one thing, so it can't
    // become a filter chip.
    kind,
  }))
  if (ranked.length > NAMED_SERIES && restTotal > 0.005) {
    legend.push({
      name: `Other (${ranked.length - NAMED_SERIES})`,
      color: REST_GREY,
      amount: restTotal,
      share: total > 0 ? restTotal / total : 0,
      kind: null,
    })
  }

  const bars = months.map((month, i) => {
    const values = byMonth.data[i].values
    const namedHere = namedNames.reduce((sum, n) => sum + (values[n] || 0), 0)

    const slots = legend.map(l => ({
      name: l.name,
      color: l.color,
      kind: l.kind,
      value: l.kind ? (values[l.name] || 0) : Math.max(totals[i] - namedHere, 0),
    }))

    // Zero slots are dropped rather than floored: a month with no Transport spend should show
    // three segments, not a 2px sliver pretending to be a fourth.
    const segs = slots.filter(s => s.value > 0)
    return {
      month,
      total: totals[i],
      aboveAvg: totals[i] > avgMonth * 1.15,
      segs: segs.map((s, si) => ({
        ...s,
        height: Math.max(barPx(s.value), 2),
        share: totals[i] > 0 ? s.value / totals[i] : 0,
        top: si === segs.length - 1,
        divider: si > 0,
      })),
    }
  })

  // Built from the same `legend`, so slice colour and stack colour are the same value by
  // construction rather than by two pieces of code agreeing.
  const stops = []
  let acc = 0
  legend.forEach((l, i) => {
    // The last stop is pinned to 100% so float drift can never leave a hairline gap in the ring.
    const end = i === legend.length - 1 ? 100 : acc + l.share * 100
    stops.push(`${l.color} ${acc.toFixed(2)}% ${end.toFixed(2)}%`)
    acc = end
  })

  return {
    kind,
    total,
    avgMonth,
    scaleMax,
    // Height of the dashed average line above the baseline, in px.
    avgOffset: (avgMonth / scaleMax) * PLOT_H,
    bars,
    legend,
    donutGradient: stops.length ? `conic-gradient(${stops.join(',')})` : REST_GREY,
  }
}
