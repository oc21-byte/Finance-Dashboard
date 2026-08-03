import dayjs from 'dayjs'
import { normalizeDescription } from './duplicates.js'

// Recurring-charge detection. Nothing in db.json marks a transaction as a subscription — the
// `Subscription` category is only ever an AI guess — so recurring spend is inferred from the shape
// of the charges themselves: the same merchant, on a regular interval, for a stable amount.
//
// Merchants are keyed with `normalizeDescription` from duplicates.js, which strips punctuation and
// 4+ digit reference numbers. That is what collapses statement noise like
// `VESTA *AT&T PREPAID 866-608-3007 OR` into one series across months.

/**
 * Billing rhythms, shortest first.
 *
 * `minCount` is deliberately not uniform. Three charges is the right bar for a monthly plan, but
 * demanding three annual charges would mean three years of statements before a yearly renewal is
 * ever detected — and almost nobody imports that much history. Only the two longest cadences are
 * allowed to prove themselves with two charges, and only under `TWO_POINT_*` below.
 *
 * Quarterly deliberately requires three. Across a few hundred merchants, two ordinary visits
 * landing ~91 days apart for a similar amount is a coincidence that happens constantly — on real
 * data a two-charge rule promoted Target and 7-Eleven runs into "quarterly subscriptions". At a
 * year's separation that coincidence is rare enough to accept.
 *
 * `tolerance` is the fractional amount spread allowed within one series. Short cadences are held
 * tighter: a weekly charge for exactly the same amount is a subscription, whereas a weekly charge
 * that drifts is a habit (the grocery run), and only the amount tells them apart.
 */
const CADENCES = [
  { name: 'weekly', days: 7, gapSlack: 2, perMonth: 365.25 / 7 / 12, minCount: 4, tolerance: 0.08 },
  { name: 'biweekly', days: 14, gapSlack: 3, perMonth: 365.25 / 14 / 12, minCount: 3, tolerance: 0.10 },
  { name: 'monthly', days: 30.44, gapSlack: 5, perMonth: 1, minCount: 3, tolerance: 0.15 },
  { name: 'quarterly', days: 91.3, gapSlack: 10, perMonth: 1 / 3, minCount: 3, tolerance: 0.08 },
  { name: 'semiannual', days: 182.6, gapSlack: 14, perMonth: 1 / 6, minCount: 2, tolerance: 0.06 },
  { name: 'annual', days: 365.25, gapSlack: 20, perMonth: 1 / 12, minCount: 2, tolerance: 0.06 },
]

// A two-charge series rests on a single gap, so it gets no benefit of the doubt: the amounts must
// match almost exactly (real renewals re-bill the same price) and the gap must sit well inside the
// cadence's slack rather than at its edge.
const TWO_POINT_TOLERANCE = 0.02
const TWO_POINT_GAP_FACTOR = 0.5

// A gap may span more than one billing cycle — a card declines, a month is skipped, a statement
// lands late. Allowing a gap to count as 2 or 3 cycles keeps one hiccup from hiding a real
// subscription, while the cap stops a twice-a-year charge from passing as a lapsed weekly one.
const MAX_SKIPPED_CYCLES = 3

// Share of gaps that must fit the rhythm for a series to qualify.
const MIN_GAP_FIT = 0.7

const TREND_THRESHOLD = 0.02

// How many billing intervals a series may go silent before it counts as cancelled, judged against
// its own cadence so an annual charge isn't measured by a monthly one's clock.
const STALE_INTERVALS = 1.5

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function groupByMerchant(transactions) {
  const groups = new Map()
  for (const tx of transactions) {
    // Spend only. A positive row is a credit, and a refund arriving monthly is not a subscription.
    if (!(Number(tx.amount) < 0) || !tx.date) continue
    const key = normalizeDescription(tx.description)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(tx)
    else groups.set(key, [tx])
  }
  return groups
}

/**
 * Split one merchant's charges into amount clusters.
 *
 * A merchant is not a subscription — `APPLE.COM/BILL` bills $0.99 for one plan and $85.19 for
 * another on the same statement line, and a household with twenty subscriptions will have several
 * such multi-plan merchants. Testing cadence across the merchant as a whole rejects every plan it
 * hosts; testing each price point finds them all. Charges are sorted by amount and cut wherever
 * the step to the next exceeds the tolerance.
 */
function clusterByAmount(txs, tolerance) {
  const byAmount = [...txs].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount))
  const clusters = []
  let current = []
  let anchor = null

  for (const tx of byAmount) {
    const amount = Math.abs(Number(tx.amount))
    if (anchor !== null && Math.abs(amount - anchor) / anchor > tolerance) {
      clusters.push(current)
      current = []
      anchor = null
    }
    if (anchor === null) anchor = amount
    current.push(tx)
  }
  if (current.length) clusters.push(current)
  return clusters
}

/**
 * Score how well a set of day-gaps fits one billing rhythm.
 *
 * Each gap is read as a whole number of cycles, so a skipped month reads as "two cycles" rather
 * than disqualifying the series. `singleShare` — the share of gaps that are exactly one cycle — is
 * the tie-breaker: a true monthly series fits `biweekly` too, at two cycles per gap, and this is
 * what tells the two apart.
 */
function fitCadence(gaps, cadence) {
  if (!gaps.length) return null
  // One gap means one data point; hold it to a tighter window than a series with corroboration.
  const slack = gaps.length === 1 ? cadence.gapSlack * TWO_POINT_GAP_FACTOR : cadence.gapSlack
  let matched = 0
  let singles = 0
  for (const gap of gaps) {
    const cycles = Math.round(gap / cadence.days)
    if (cycles < 1 || cycles > MAX_SKIPPED_CYCLES) continue
    if (Math.abs(gap - cycles * cadence.days) <= slack * cycles) {
      matched++
      if (cycles === 1) singles++
    }
  }
  const fit = matched / gaps.length
  return fit >= MIN_GAP_FIT ? { fit, singleShare: singles / gaps.length } : null
}

function bestCadence(dates) {
  const gaps = []
  for (let i = 1; i < dates.length; i++) {
    gaps.push(dayjs(dates[i]).diff(dayjs(dates[i - 1]), 'day'))
  }
  if (!gaps.length) return null

  let best = null
  for (const cadence of CADENCES) {
    if (dates.length < cadence.minCount) continue
    const score = fitCadence(gaps, cadence)
    if (!score) continue
    const better = !best
      || score.singleShare > best.score.singleShare
      || (score.singleShare === best.score.singleShare && score.fit > best.score.fit)
    if (better) best = { cadence, score }
  }
  return best ? { ...best.cadence, typicalGap: median(gaps), fit: best.score.fit } : null
}

/**
 * Find merchants that charge on a regular cadence.
 *
 * @param transactions  card rows; positives are ignored
 * @param options.activeTo  the date to judge "still active" against — normally the end of the
 *                          visible period. Series that had not started by then, or that have gone
 *                          quiet for longer than their own billing rhythm, are dropped.
 *
 * Note there is deliberately no `activeFrom`: a subscription billed on the 25th is still live on
 * the 1st of the next month, so requiring a charge inside a short window would drop exactly the
 * subscriptions a 1M view most needs to show.
 *
 * @returns {{ series: Array, monthlyTotal: number, count: number, byCadence: object }}
 *   `series` is sorted by monthly cost, each entry `{ merchant, label, amount, monthly, cadence,
 *   count, firstDate, lastDate, trend }`. `trend` is 'increased' | 'decreased' | 'flat'.
 */
export function detectRecurring(transactions = [], options = {}) {
  const { activeTo = null } = options

  // The widest tolerance any cadence allows — clustering happens before the cadence is known, so
  // it must not pre-emptively split a series that a looser rhythm would have accepted.
  const maxTolerance = Math.max(...CADENCES.map(c => c.tolerance))
  const minCount = Math.min(...CADENCES.map(c => c.minCount))
  const series = []

  for (const [merchant, txs] of groupByMerchant(transactions)) {
    if (txs.length < minCount) continue

    for (const cluster of clusterByAmount(txs, maxTolerance)) {
      if (cluster.length < minCount) continue

      const ordered = [...cluster].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      const cadence = bestCadence(ordered.map(t => t.date))
      if (!cadence) continue

      const amounts = ordered.map(t => Math.abs(Number(t.amount)))
      const typical = median(amounts)
      if (typical <= 0) continue
      // Re-checked against the matched cadence's own bar, which is stricter than the clustering
      // tolerance for everything except monthly — and stricter still when there are only two
      // charges to go on.
      const bar = ordered.length === 2 ? Math.min(cadence.tolerance, TWO_POINT_TOLERANCE) : cadence.tolerance
      if (amounts.some(a => Math.abs(a - typical) / typical > bar)) continue

      const firstDate = ordered[0].date
      const lastDate = ordered[ordered.length - 1].date
      if (activeTo && firstDate > activeTo) continue

      // Gone quiet for longer than its own billing rhythm — treat it as cancelled rather than let
      // it keep inflating a "current recurring spend" figure.
      if (activeTo && dayjs(activeTo).diff(dayjs(lastDate), 'day') > cadence.days * STALE_INTERVALS) continue

      const drift = (amounts[amounts.length - 1] - amounts[0]) / typical
      series.push({
        merchant,
        // The most recent raw description — the normalized key is for matching, not for display.
        label: ordered[ordered.length - 1].description,
        amount: round2(typical),
        monthly: round2(typical * cadence.perMonth),
        cadence: cadence.name,
        count: ordered.length,
        firstDate,
        lastDate,
        trend: drift > TREND_THRESHOLD ? 'increased' : drift < -TREND_THRESHOLD ? 'decreased' : 'flat',
      })
    }
  }

  series.sort((a, b) => b.monthly - a.monthly)

  const byCadence = {}
  for (const s of series) byCadence[s.cadence] = (byCadence[s.cadence] ?? 0) + 1

  return {
    series,
    monthlyTotal: round2(series.reduce((sum, s) => sum + s.monthly, 0)),
    count: series.length,
    byCadence,
  }
}
