// Everything the Goals tab derives, in one pure module.
//
// The tab renders a grid of progress rings, one detail panel, and an Emergency Fund banner. All
// three used to compute their own figures inline in `src/pages/Goals.jsx`'s render body — the ring
// geometry, the percentage, the allocation split, the emergency-fund arithmetic — which is how the
// emergency fund came to count linked cash twice (see `emergencyFund` below). Same arrangement as
// `budgetModel.js` and `investmentsModel.js`: visual math lives here and is tested, the components
// only position it.
//
// The `/api/goals` response is the input shape throughout: `currentAmount` is already resolved
// server-side (a linked goal's stored amount is ignored in favour of its live sources), and
// `linkedBreakdown[]`, `isLinked` and `growthVerdict` arrive alongside it.

import dayjs from 'dayjs'

/** Ring geometry, shared by the card SVG and `ringDash`. Matches the 7c wireframe's proportions. */
export const RING = { size: 46, r: 19, stroke: 5 }

const CIRCUMFERENCE = 2 * Math.PI * RING.r

const round2 = value => Math.round(value * 100) / 100
const clampPct = value => Math.min(100, Math.max(0, value))

export function money(n) {
  return Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Compact form for the cards, where two decimals on a five-figure target is just noise. */
export function shortMoney(n) {
  return '$' + Math.round(Number(n ?? 0)).toLocaleString()
}

/** How far along a goal is, as a percentage capped at 100. */
export function goalPct(goal) {
  const target = goal?.targetAmount ?? 0
  if (!(target > 0)) return 0
  return clampPct(((goal.currentAmount ?? 0) / target) * 100)
}

/**
 * `stroke-dasharray` for the progress arc: the filled length, then the gap.
 *
 * The consumer draws the circle with `transform="rotate(-90 …)"` so the arc starts at twelve
 * o'clock rather than at three.
 */
export function ringDash(pct) {
  const filled = (clampPct(pct) / 100) * CIRCUMFERENCE
  return `${filled.toFixed(1)} ${(CIRCUMFERENCE - filled).toFixed(1)}`
}

/**
 * Which of four visual bands a goal sits in.
 *
 * The 60/30 thresholds come from the 7c wireframe (the page previously used 80/40). `reached` is
 * its own band even though it currently paints the same green as `good` — the distinction is what
 * lets the detail panel's "Goal reached!" note and the ring agree without recomputing anything.
 */
export function progressTone(pct, reached = false) {
  if (reached) return 'reached'
  if (pct >= 60) return 'good'
  if (pct >= 30) return 'mid'
  return 'low'
}

/**
 * The single badge each card carries.
 *
 * A goal is funded one of two ways and the chip says which: linked accounts track themselves, a
 * monthly rate is something you do by hand. A goal with neither is the case worth surfacing — it
 * has no funding story at all, and nothing else on the card would say so.
 */
export function goalChip(goal) {
  const links = goal?.links ?? []
  if (goal?.isLinked && links.length) {
    return { kind: 'linked', label: `🔗 ${links.length} linked account${links.length === 1 ? '' : 's'}` }
  }
  if (goal?.monthlySavings > 0) return { kind: 'rate', label: `$${money(goal.monthlySavings)}/mo` }
  return { kind: 'none', label: 'No monthly savings set' }
}

/** Everything one card in the grid needs. */
export function goalCardModel(goal) {
  const pct = goalPct(goal)
  const reached = (goal?.currentAmount ?? 0) >= (goal?.targetAmount ?? 0) && (goal?.targetAmount ?? 0) > 0
  return {
    id: goal?.id,
    name: goal?.name ?? '',
    pct,
    pctLabel: `${pct.toFixed(1)}%`,
    reached,
    tone: progressTone(pct, reached),
    dash: ringDash(pct),
    currentLabel: shortMoney(goal?.currentAmount),
    targetLabel: shortMoney(goal?.targetAmount),
    chip: goalChip(goal),
  }
}

/**
 * The ETA line, from the goal's STATED monthly savings.
 *
 * Deliberately not `goalProgress()` in `liquidNetWorth.js`, which the Dashboard's goal card uses.
 * That one prefers the rate actually visible in the bank ledger; this one quotes what the user
 * typed. The difference is documented in `components/dashboard/GoalProgressCard.jsx` and is the
 * point — this tab is where you state a plan, the Dashboard is where you find out whether it is
 * happening. Do not merge them.
 */
export function timelineText(goal, asOf = null) {
  const remaining = (goal?.targetAmount ?? 0) - (goal?.currentAmount ?? 0)
  if (remaining <= 0 || !(goal?.monthlySavings > 0)) return null
  const months = Math.ceil(remaining / goal.monthlySavings)
  const reachDate = dayjs(asOf ?? undefined).add(months, 'month').format('MMM YYYY')
  return `At $${money(goal.monthlySavings)}/mo — ~${months} month${months === 1 ? '' : 's'} to go (est. ${reachDate})`
}

/**
 * One linked source, split three ways: this goal's share, every other goal's, and what is free.
 *
 * `allocatedPct` from `/api/goal-sources` is the total across ALL goals **including this one**, so
 * the other goals' share is a subtraction. Getting that backwards paints a source as fully spoken
 * for the moment one goal links it, which is exactly why this is a tested function and not
 * arithmetic inside JSX.
 *
 * Segments always sum to 100 and zero-width ones are dropped, so the bar can be rendered by
 * mapping straight over the array.
 */
export function allocationSegments(source, thisPct = 0) {
  const mine = clampPct(thisPct)
  const other = Math.max(0, round2((source?.allocatedPct ?? 0) - mine))
  const free = Math.max(0, round2(100 - mine - other))
  const value = pct => round2(((source?.currentValue ?? 0) * pct) / 100)

  const segments = [
    { kind: 'this', pct: mine, value: value(mine) },
    { kind: 'other', pct: other, value: value(other) },
    { kind: 'free', pct: free, value: value(free) },
  ].filter(seg => seg.pct > 0)

  return {
    segments,
    minePct: mine,
    otherPct: other,
    freePct: free,
    freeValue: value(free),
    mineValue: value(mine),
  }
}

/** Cash a goal already counts through its own links, so the EF banner does not add it twice. */
function linkedCash(goal) {
  return (goal?.linkedBreakdown ?? [])
    .filter(b => b.sourceType === 'cash')
    .reduce((sum, b) => sum + (b.value ?? 0), 0)
}

/**
 * The Emergency Fund banner: a target derived from average spend, against goal balance plus cash.
 *
 * Cash counts toward the emergency fund whether or not a goal names it — money in checking is
 * available in an emergency by definition. But a goal *linked* to the cash source already has that
 * cash inside its `currentAmount` (`sourceValue()` returns `settings.cashBalance` for
 * `sourceType: 'cash'`), so adding the balance on top reported it twice. `linkedCash` is netted out
 * so every dollar is counted exactly once, at whatever fraction the link earmarked.
 */
export function emergencyFund({ goals = [], fin = null, cashBalance = 0, months = 6 } = {}) {
  const monthlySpend = fin?.expenses ?? 0
  const target = round2(monthlySpend * months)
  const efGoal = goals.find(g => (g.name ?? '').toLowerCase().includes('emergency')) ?? null

  const goalAmount = efGoal?.currentAmount ?? 0
  const cashCounted = round2(Math.max(0, cashBalance - linkedCash(efGoal)))
  const current = round2(goalAmount + cashCounted)

  const pct = target > 0 ? clampPct((current / target) * 100) : 0
  const gap = Math.max(0, round2(target - current))
  const hasBasis = !!fin && fin.monthsCovered > 0

  return {
    efGoal,
    monthlySpend,
    target,
    goalAmount,
    cashCounted,
    current,
    pct,
    gap,
    hasBasis,
    // Names the source and the rule, not just the window. "Avg spend" alone left the reader with
    // no way to check the figure or to know why a month they remember is missing from it.
    basisLabel: hasBasis
      ? `${months} × $${money(monthlySpend)}/mo average spending — from your bank transactions, complete months only (${fin.windowLabel})`
      : null,
    // Only worth offering a resync when there is a target to sync to and it actually differs.
    targetMismatch: !!efGoal && target > 0 && Math.round(efGoal.targetAmount ?? 0) !== Math.round(target),
  }
}
