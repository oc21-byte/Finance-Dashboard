// Deterministic goal math: the timeline, the growth projection, and the status a goal is in.
//
// This lived inside `server/index.js`, which boots Express, so `node --test` could not import it
// and none of it was covered. That is how the bug this module exists to fix survived: a goal
// created a minute ago was reported as behind schedule, and no test could have said otherwise.
//
// Two rules carried over from the insight triads (`AGENTS.md` — Insight contracts):
//
//   1. **Deterministic analysis owns the status.** The model is told which status a goal is in and
//      reports it. It never decides on-track versus behind, because a prompt asked to pick a side
//      with nothing to pick from will pick one anyway.
//   2. **Pure.** `asOf` is injected, never read from a clock, so the same goal always produces the
//      same timeline. Everything that needs the database is resolved by the caller and passed in.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A goal younger than this has no track record to fall behind against. */
export const NEW_GOAL_DAYS = 30

/**
 * Parses a stored date into a LOCAL calendar date.
 *
 * `new Date('2028-08-01')` is UTC midnight, and `getMonth()` reads local, so west of Greenwich a
 * goal targeted at the first of a month labelled itself as the month before — "Jul 2028" for an
 * August target, in the prompt and in every date the model was handed. The app stores dates as
 * `YYYY-MM-DD` calendar days with no time zone attached (`AGENTS.md` — Ledger semantics), so they
 * are built field by field rather than parsed as instants.
 */
function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value == null) return new Date()
  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Strips the time of day.
 *
 * `asOf` is a real timestamp while every stored date is a bare calendar day, so a comparison
 * between them otherwise carries hours of noise in one operand — enough, at 12 months, to make a
 * goal funded to arrive exactly on its target date report as arriving late.
 */
function toCalendarDay(date) {
  return date && new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Whole calendar months from `from` to `target`, plus the fraction of the month left over. */
function calendarMonthsBetween(from, target) {
  let months = (target.getFullYear() - from.getFullYear()) * 12 + (target.getMonth() - from.getMonth())
  const anchor = new Date(from.getTime())
  anchor.setMonth(anchor.getMonth() + months)
  // The anchor can land past the target when the day-of-month differs; step back one month so the
  // remainder is always measured forward.
  if (anchor > target) {
    months -= 1
    anchor.setMonth(anchor.getMonth() - 1)
  }
  const next = new Date(anchor.getTime())
  next.setMonth(next.getMonth() + 1)
  const span = next - anchor
  return months + (span > 0 ? (target - anchor) / span : 0)
}

/** "Aug 2027" from a YYYY-MM-DD date, so the model never converts a month count to a calendar date. */
export function monthYearLabel(date) {
  const d = asDate(date)
  if (!d) return 'unknown'
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Whole months from `asOf` until a target date, and the unrounded figure beside it.
 *
 * Both are returned because they answer different questions. The rounded one is what a person
 * reads; the exact one is what a comparison must use. Comparing a ceil-ed month count against a
 * rounded one is what let an exactly-on-pace goal round its way into "behind" by up to a month.
 *
 * Measured in calendar months rather than by dividing days by an average month length. A year is
 * twelve months to a person, but 365 / 30.4375 is 11.99 — enough for a goal funded to reach its
 * target in exactly twelve to be reported as arriving a month late.
 */
export function monthsUntil(targetDate, asOf = null) {
  const target = asDate(targetDate)
  const from = asDate(asOf)
  if (!target || !targetDate || !from) return { months: null, exact: null }
  const exact = calendarMonthsBetween(toCalendarDay(from), toCalendarDay(target))
  return { months: Math.round(exact), exact }
}

/** Calendar month `n` whole months after `asOf`, e.g. "Nov 2028". */
export function dateAfterMonths(months, asOf = null) {
  const d = asDate(asOf)
  if (!d) return 'unknown'
  const shifted = new Date(d.getTime())
  shifted.setMonth(shifted.getMonth() + months)
  return monthYearLabel(shifted)
}

/** Whole days between a creation date and `asOf`, or null when the goal never recorded one. */
export function goalAgeDays(createdAt, asOf = null) {
  const created = asDate(createdAt)
  const from = asDate(asOf)
  if (!createdAt || !created || !from) return null
  // Floored at zero: a creation date in the future is nonsense, but a negative age would read as
  // a goal that has not started, which is a different and equally wrong claim.
  return Math.max(0, Math.round((toCalendarDay(from) - toCalendarDay(created)) / (1000 * 60 * 60 * 24)))
}

/**
 * Blends the expected annual growth of a goal's funding, weighted by the value behind each link.
 *
 * Takes resolved link values rather than the database: valuing a holdings bucket needs prices, FX
 * and the display currency, and none of that belongs in a math module. The caller resolves each
 * link to `{ sourceType, value, apy }` and this decides what that mix earns.
 */
export function blendGrowthRate(linkValues = [], assumedReturn = 0.06) {
  let weighted = 0, total = 0, hasInvestments = false, hasYield = false
  for (const link of linkValues) {
    const value = Number(link?.value) || 0
    if (value <= 0) continue
    let rate = 0
    if (link.sourceType === 'savings') {
      rate = Number(link.apy) > 0 ? Number(link.apy) / 100 : 0
      if (rate > 0) hasYield = true
    } else if (link.sourceType === 'holdingsAccountType') {
      rate = assumedReturn
      hasInvestments = true
    }
    weighted += value * rate
    total += value
  }
  return { blendedAnnualRate: total > 0 ? weighted / total : 0, hasInvestments, hasYield, assumedReturn }
}

/**
 * Months to grow `balance` to `target`, compounding monthly and adding `monthly` each month.
 * Returns `{ months, date }`, or null if unreachable within the cap.
 */
export function projectWithGrowth({ balance, monthly, target, annualRate, asOf = null }) {
  if (balance >= target) return { months: 0, date: dateAfterMonths(0, asOf) }
  const r = annualRate / 12
  let bal = balance
  for (let m = 1; m <= 1200; m++) {
    bal = bal * (1 + r) + monthly
    if (bal >= target) return { months: m, date: dateAfterMonths(m, asOf) }
  }
  return null
}

/**
 * Which of six states a goal is in, and the plain-English line describing it.
 *
 * The states exist because "on track or behind" is not a question every goal can answer, and the
 * previous version forced one anyway. Three of them are the cases that had no home:
 *
 *   - `too_early`  — a goal younger than a month has no track record. Whether its plan reaches the
 *                    target is still worth saying, and the figures are still supplied, but nobody
 *                    falls behind a schedule they started days ago. This is the reported bug: the
 *                    goal form pre-fills a target date one year out, so any goal wanting more than
 *                    twelve times its monthly rate was stamped BEHIND at the moment it was created.
 *   - `funded_by_links` — a linked goal legitimately has no monthly rate. Its balance tracks the
 *                    accounts it links, so "no savings rate is set" reported a problem that was
 *                    not one, while the Dashboard showed a real derived pace from the same data.
 *   - `no_rate`    — no rate and no links. Genuinely unprojectable, and now said plainly instead
 *                    of being handed to a model with instructions to pick a side.
 *
 * `createdAt` is optional and its absence means "age unknown", never "old": goals created before
 * the field existed carry none, and inventing one would repeat the error this fixes.
 */
export function goalTimeline(goal, { growth = null, asOf = null, linkedValue = 0, linkCount = 0 } = {}) {
  const targetAmount = Number(goal?.targetAmount) || 0
  const currentAmount = Number(goal?.currentAmount) || 0
  const monthlySavings = Number(goal?.monthlySavings) || 0
  const remaining = Math.max(0, targetAmount - currentAmount)

  const { months: monthsToTarget, exact: exactMonthsToTarget } = monthsUntil(goal?.targetDate, asOf)
  const monthsAtCurrent = monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : null
  const projectedDate = monthsAtCurrent == null ? null : dateAfterMonths(monthsAtCurrent, asOf)
  const requiredMonthly = (monthsToTarget != null && monthsToTarget > 0)
    ? Math.ceil(remaining / monthsToTarget)
    : null
  const ageDays = goalAgeDays(goal?.createdAt, asOf)
  const isNew = ageDays != null && ageDays < NEW_GOAL_DAYS

  // Compared unrounded on both sides. The rounded counts above are for reading, not for deciding.
  const planReaches = monthlySavings > 0 && exactMonthsToTarget != null
    ? (remaining / monthlySavings) <= exactMonthsToTarget
    : null

  const targetLabel = goal?.targetDate ? monthYearLabel(goal.targetDate) : null
  const age = ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`

  let status, verdict
  if (remaining <= 0 && targetAmount > 0) {
    status = 'reached'
    verdict = 'REACHED: the goal is fully funded.'
  } else if (isNew) {
    status = 'too_early'
    const plan = monthsAtCurrent == null
      ? 'No monthly savings rate is set yet.'
      : `At the stated rate it would take ${monthsAtCurrent} months (${projectedDate})${targetLabel ? `, against a target date of ${targetLabel}` : ''}.`
    const adjust = planReaches === false && requiredMonthly != null
      ? ` Reaching ${targetLabel} would need about $${requiredMonthly}/month; the rate or the date may simply need setting properly.`
      : ''
    verdict = `TOO EARLY TO JUDGE: this goal was created ${age}, so there is no saving history to be ahead of or behind. ${plan}${adjust}`
  } else if (monthsAtCurrent == null && linkCount > 0 && linkedValue > 0) {
    status = 'funded_by_links'
    verdict = `FUNDED BY LINKED ACCOUNTS: no monthly rate is set, and this goal tracks ${linkCount} linked account${linkCount === 1 ? '' : 's'} whose balances move on their own. A completion date cannot be projected from a rate that does not exist.`
  } else if (monthsAtCurrent == null) {
    status = 'no_rate'
    verdict = 'NO RATE SET: no monthly savings rate is set and no accounts are linked, so a completion date cannot be projected.'
  } else if (monthsToTarget == null) {
    status = 'no_target_date'
    verdict = `At the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}). No target date is set.`
  } else if (planReaches) {
    status = 'on_track'
    verdict = `ON TRACK: at the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}), about ${Math.max(0, monthsToTarget - monthsAtCurrent)} month(s) BEFORE the ${targetLabel} target.`
  } else {
    status = 'behind'
    verdict = `BEHIND: at the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}), which is ${monthsAtCurrent - monthsToTarget} month(s) AFTER the ${targetLabel} target. To hit the target date the user must save about $${requiredMonthly}/month (currently $${monthlySavings}/month).`
  }

  let growthMonths = null, growthDate = null, growthVerdict = null
  let blendedAnnualRate = null, assumedReturnUsed = null, hasInvestments = false
  if (growth && growth.blendedAnnualRate > 0 && remaining > 0) {
    blendedAnnualRate = Math.round(growth.blendedAnnualRate * 10000) / 10000
    assumedReturnUsed = growth.assumedReturn
    hasInvestments = growth.hasInvestments
    const proj = projectWithGrowth({
      balance: currentAmount,
      monthly: monthlySavings,
      target: targetAmount,
      annualRate: growth.blendedAnnualRate,
      asOf,
    })
    if (proj) {
      const comp = []
      if (growth.hasYield) comp.push('savings APY')
      if (growth.hasInvestments) comp.push(`${Math.round(growth.assumedReturn * 100)}% assumed investment return`)
      const rateLabel = `~${(growth.blendedAnnualRate * 100).toFixed(1)}%/yr (${comp.join(' + ')})`
      if (monthsAtCurrent != null) {
        const sooner = monthsAtCurrent - proj.months
        if (sooner >= 1) {
          growthMonths = proj.months
          growthDate = proj.date
          growthVerdict = `With growth ${rateLabel}: reached in ${proj.months} months (${proj.date}), about ${sooner} month(s) sooner than the no-growth estimate. Optimistic — assumes returns hold.`
        }
      } else {
        growthMonths = proj.months
        growthDate = proj.date
        growthVerdict = `With growth ${rateLabel} and no monthly contributions, the linked balance compounds to the target in ${proj.months} months (${proj.date}). Optimistic — assumes returns hold.`
      }
    }
  }

  return {
    status, verdict, remaining, monthsAtCurrent, monthsToTarget, projectedDate, requiredMonthly,
    ageDays, growthMonths, growthDate, growthVerdict, blendedAnnualRate, assumedReturnUsed,
    hasInvestments,
  }
}

/**
 * Plain-English line naming the accounts behind a goal, e.g.
 * "Funded by: Capital One HYSA (50% = $30,000.00), TFSA holdings (50% = $25,300.00, live market value)".
 */
export function goalFundingLine(breakdown) {
  if (!breakdown?.length) return null
  const parts = breakdown.map(b => {
    const live = b.sourceType === 'holdingsAccountType' ? ', live market value' : ''
    return `${b.name} (${b.percent}% = $${b.value.toFixed(2)}${live})`
  })
  return `Funded by linked accounts: ${parts.join(', ')}.`
}
