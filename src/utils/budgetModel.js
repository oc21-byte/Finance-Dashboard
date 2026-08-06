// The Budget tab's entire derivation chain, in one pure module.
//
// Read this before touching anything on the Budget tab. The chain used to live inline in the
// render body of `src/pages/Budget.jsx`, which meant every figure was recomputed on every
// keystroke of every inline editor and none of it could be tested. It is also the module
// `server/budgetAnalysis.js` imports, so an insight quoting a number and the KPI strip showing it
// agree by construction rather than by coincidence — the same arrangement `liquidNetWorth.js` has
// with the Dashboard.
//
// The one contract worth stating up front: **Savings and Investments are allocation, not
// spending.** A cap on a savings category counts toward `totalSavingsPlanned`, never toward
// `totalSpendingCaps`, and the two are subtracted from income separately. Folding them together
// double-counts money leaving checking, which is the mistake `src/constants/financeRules.js`
// exists to stop on the ledger side and this file exists to stop on the plan side.

/** Never a spending cap: these are ledger bookkeeping tags, not budgetable categories. */
export const SPENDING_EXCLUDED_CATS = new Set(['Income', 'Transfer'])

/**
 * Categories whose caps are allocation rather than spending. Deliberately wider than the four
 * reserved `FINANCE_CATEGORIES` — 'Retirement' and 'Emergency Fund' are ordinary user categories
 * on the ledger, but on a plan they are money set aside, so a cap on one is a savings intention.
 */
export const SAVINGS_CATS = new Set(['Savings', 'Investments', 'Retirement', 'Emergency Fund'])

/** Used when `settings.budgetSavingsRate` is missing or unusable. Matches the server default. */
export const DEFAULT_SAVINGS_RATE = 15

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const round = value => Math.round(value)

/**
 * The general savings target, from settings alone.
 *
 * The precedence ladder — explicit target, then rate-of-income — is the single implementation for
 * the whole app. It previously existed twice, in `Budget.jsx` and in `server/spendAnalysis.js`,
 * and the two disagreed: the server clamped the rate to 0–100 and the client did not, so a stored
 * rate of 500 produced a target five times income on the Budget tab and a sane one in Spend's
 * Financial Pace. The clamp is kept; the divergence is not.
 *
 * `budgetSavingsTarget: null` means "not set" — 0 is a legitimate explicit target of zero.
 */
export function resolveSavingsTarget(settings, income) {
  const explicit = Number(settings?.budgetSavingsTarget)
  const hasExplicit = settings?.budgetSavingsTarget !== null
    && settings?.budgetSavingsTarget !== undefined
    && settings?.budgetSavingsTarget !== ''
    && Number.isFinite(explicit)
    && explicit >= 0

  const rawRate = Number(settings?.budgetSavingsRate)
  const rate = Number.isFinite(rawRate) ? clamp(rawRate, 0, 100) : DEFAULT_SAVINGS_RATE
  const auto = round(income * rate / 100)

  return {
    effective: hasExplicit ? round(explicit) : auto,
    auto,
    rate,
    isAuto: !hasExplicit,
    source: hasExplicit ? 'explicit_monthly_target' : 'income_rate',
  }
}

/** How an average compares to its cap. `null` cap means the user has not set one. */
function capStatus(cap, avg) {
  if (cap == null || cap <= 0) return { pct: null, over: false, near: false }
  const pct = Math.round(avg / cap * 100)
  const over = avg > cap
  return { pct, over, near: !over && pct >= 80 }
}

/**
 * Everything the Budget tab renders, from the three queries it already runs.
 *
 * @param settings  `/api/settings`
 * @param goals     `/api/goals`
 * @param fin       `/api/monthly-financials` — averages over the last <=6 FULL bank months
 * @param pendingBudgets       staged AI caps, or null. Overlay only; never persisted from here.
 * @param pendingSavingsTarget staged AI target, or null.
 */
export function buildBudgetPlan({
  settings, goals = [], fin,
  pendingBudgets = null, pendingSavingsTarget = null,
} = {}) {
  const confirmed = Number(settings?.confirmedMonthlyIncome)
  const isConfirmed = settings?.confirmedMonthlyIncome != null
    && settings?.confirmedMonthlyIncome !== ''
    && Number.isFinite(confirmed)
  const displayIncome = isConfirmed ? confirmed : (fin?.income ?? 0)

  // Card categories are what the user *spends*; bank categories are what they *move*. A savings
  // category's average has to come from the bank side — a transfer to savings never touches a
  // credit card, so reading it off `cardBreakdown` would report zero for every savings row.
  const cardBreakdownMap = {}
  for (const entry of (fin?.cardBreakdown ?? [])) {
    if (!SPENDING_EXCLUDED_CATS.has(entry.category)) cardBreakdownMap[entry.category] = entry.monthly
  }
  const bankBreakdownMap = {}
  for (const entry of (fin?.bankBreakdown ?? [])) {
    bankBreakdownMap[entry.category] = entry.monthly
  }

  const activeGoals = goals.filter(g => Number(g.currentAmount) < Number(g.targetAmount))
  const goalNames = new Set(activeGoals.map(g => g.name))

  const storedBudgets = settings?.categoryBudgets ?? {}
  const effectiveBudgets = pendingBudgets ?? storedBudgets

  // A goal funded by name gets its amount from the goal row, not from a cap — counting both would
  // book the same dollar twice under Savings Planned.
  const isSpendingCap = cat => !SAVINGS_CATS.has(cat) && !goalNames.has(cat)
  const totalSpendingCaps = Object.entries(effectiveBudgets)
    .filter(([cat]) => isSpendingCap(cat))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0)
  const totalSavingsCaps = Object.entries(effectiveBudgets)
    .filter(([cat]) => SAVINGS_CATS.has(cat))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0)

  const savingsTarget = resolveSavingsTarget(settings, displayIncome)
  const pendingTargetActive = pendingSavingsTarget != null
  const effectiveSavingsTarget = pendingTargetActive ? Number(pendingSavingsTarget) : savingsTarget.effective

  // A goal with no manual monthly amount falls back to what the bank shows going to a category of
  // the same name, so an already-automated transfer is not double-counted as unfunded.
  const goalRows = activeGoals.map(goal => {
    const manual = Number(goal.monthlySavings) || 0
    const bankAvg = bankBreakdownMap[goal.name] || 0
    const isAuto = manual === 0 && bankAvg > 0
    return {
      id: goal.id,
      name: goal.name,
      manual,
      bankAvg,
      isAuto,
      amount: isAuto ? bankAvg : manual,
    }
  })
  const totalGoalSavings = goalRows.reduce((sum, row) => sum + row.amount, 0)

  const totalSavingsPlanned = totalGoalSavings + effectiveSavingsTarget + totalSavingsCaps

  // Spending caps and savings are separate subtractions from income. `totalAvgSpend` is card-side
  // only and excludes savings categories for the same reason.
  const totalAvgSpend = Object.entries(cardBreakdownMap)
    .filter(([cat]) => !SAVINGS_CATS.has(cat))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0)
  const budgetedLeft = displayIncome - totalSpendingCaps - totalSavingsPlanned
  const avgLeft = displayIncome - totalAvgSpend - totalSavingsPlanned
  const spread = avgLeft - budgetedLeft

  const capOf = cat => (effectiveBudgets[cat] != null ? Number(effectiveBudgets[cat]) : null)
  const isPending = cat => !!(pendingBudgets && cat in pendingBudgets)

  const spendingCategories = [...new Set([
    ...Object.keys(cardBreakdownMap),
    ...Object.keys(storedBudgets).filter(cat => !SPENDING_EXCLUDED_CATS.has(cat)),
    ...Object.keys(effectiveBudgets).filter(cat => !SPENDING_EXCLUDED_CATS.has(cat)),
  ])]
    .filter(isSpendingCap)
    .sort((a, b) => (cardBreakdownMap[b] || 0) - (cardBreakdownMap[a] || 0))
    .map(name => {
      const cap = capOf(name)
      const avg = Math.round((cardBreakdownMap[name] || 0) * 100) / 100
      return { name, cap, avg, isPending: isPending(name), ...capStatus(cap, avg) }
    })

  // Savings rows come from the bank side and are shown wherever a cap OR an observed contribution
  // exists — a user who has never set a cap still needs to see what is already going out.
  const savingsCategories = [...new Set([
    ...Object.keys(effectiveBudgets).filter(cat => SAVINGS_CATS.has(cat)),
    ...Object.keys(bankBreakdownMap).filter(cat => SAVINGS_CATS.has(cat)),
  ])]
    .sort((a, b) => (bankBreakdownMap[b] || 0) - (bankBreakdownMap[a] || 0))
    .map(name => ({
      name,
      cap: capOf(name),
      avg: bankBreakdownMap[name] || 0,
      isPending: isPending(name),
      kind: name === 'Investments' || name === 'Retirement' ? 'Investment' : 'Savings',
    }))

  // The flow bar. Clamped so an over-committed plan cannot push a segment past the track, with
  // the residual re-labelled rather than hidden — an over-budget plan that renders as a full bar
  // of "unallocated" would read as the opposite of what it is.
  const spendPct = displayIncome > 0 ? clamp(totalSpendingCaps / displayIncome * 100, 0, 100) : 0
  const savePct = displayIncome > 0
    ? clamp(totalSavingsPlanned / displayIncome * 100, 0, 100 - spendPct)
    : 0
  const allocation = {
    spendPct,
    savePct,
    freePct: Math.max(0, 100 - spendPct - savePct),
    overBudget: budgetedLeft < 0,
    unallocatedPct: displayIncome > 0 ? Math.abs(budgetedLeft) / displayIncome * 100 : 0,
  }

  // Planned, not achieved. Spend's Financial Pace owns the achieved rate; this one is what the
  // plan intends to set aside, and the two must never be shown under the same label.
  const plannedRatePct = displayIncome > 0 ? Math.round(totalSavingsPlanned / displayIncome * 100) : 0
  const targetRatePct = savingsTarget.rate

  // Statuses reuse the shared Financial Pace vocabulary so the Budget rail tints the same way the
  // Spend and Finances rails do. `over_pace` is reserved for a plan that does not fit inside its
  // own income — being under a savings target is a shortfall, not an overdraft.
  const rateStatus = displayIncome <= 0
    ? 'not_enough_data'
    : budgetedLeft < 0
      ? 'over_pace'
      : plannedRatePct >= targetRatePct
        ? 'on_track'
        : 'little_room'

  // How hard the caps are being pressed. Deterministic because it is a classification and a
  // ranking, which the analysis owns — a generation is told which categories are over and by how
  // much, never left to work it out from a list of numbers.
  const cappedRows = spendingCategories.filter(row => row.cap != null && row.cap > 0)
  const overRows = cappedRows.filter(row => row.over)
  const capPressure = {
    capped: cappedRows.length,
    uncapped: spendingCategories.length - cappedRows.length,
    overCount: overRows.length,
    nearCount: cappedRows.filter(row => row.near).length,
    // Only the excess, and only from rows that are actually over — summing signed gaps would let
    // an under-spent category quietly cancel out an over-spent one.
    overBy: Math.round(overRows.reduce((sum, row) => sum + (row.avg - row.cap), 0)),
    worst: overRows.reduce(
      (worst, row) => (worst && worst.avg - worst.cap >= row.avg - row.cap ? worst : row),
      null,
    ),
  }

  return {
    income: {
      display: displayIncome,
      isConfirmed,
      windowLabel: fin?.windowLabel ?? null,
      monthsCovered: fin?.monthsCovered ?? 0,
    },
    cardBreakdownMap,
    bankBreakdownMap,
    activeGoals,
    goalNames,
    effectiveBudgets,
    totalSpendingCaps,
    totalSavingsCaps,
    savingsTarget: {
      ...savingsTarget,
      effective: effectiveSavingsTarget,
      isAuto: savingsTarget.isAuto && !pendingTargetActive,
      isPending: pendingTargetActive,
      pctOfIncome: displayIncome > 0 ? Math.round(effectiveSavingsTarget / displayIncome * 100) : 0,
    },
    goalRows,
    totalGoalSavings,
    totalSavingsPlanned,
    totalAvgSpend,
    budgetedLeft,
    avgLeft,
    spread,
    unallocated: budgetedLeft,
    spendingCategories,
    savingsCategories,
    allocation,
    savingsRate: {
      plannedPct: plannedRatePct,
      targetPct: targetRatePct,
      targetDollars: Math.round(displayIncome * targetRatePct / 100),
      onTrack: plannedRatePct >= targetRatePct,
      status: rateStatus,
      // The comparison is made here, in JS, so a generation is never left to infer whether a
      // plan clears its own target. See the RUNWAY_COMFORTABLE note in AGENTS.md.
      shortfall: Math.round(displayIncome * targetRatePct / 100) - totalSavingsPlanned,
    },
    capPressure,
    detectedFromBank: {
      savingsContrib: fin?.savingsContrib ?? 0,
      investContrib: fin?.investContrib ?? 0,
    },
    hasPending: !!(pendingBudgets || pendingTargetActive),
    hasSpendingData: Object.keys(cardBreakdownMap).length > 0 || Object.keys(storedBudgets).length > 0,
  }
}

/**
 * A stable string identifying the plan a stored insight was generated against.
 *
 * Budget has no period chips, so its scope key alone cannot detect staleness — the window is
 * fixed and the numbers move when the user edits a cap, not when they change a filter. Comparing
 * this fingerprint is what stops the rail asserting a savings rate the KPI strip above it no
 * longer shows. Same reasoning as `staleInsightReason` on the Dashboard, which checks the live
 * cards rather than trusting the scope key.
 */
export function budgetFingerprint(plan) {
  if (!plan) return null
  return [
    round(plan.income.display),
    round(plan.totalSpendingCaps),
    round(plan.totalSavingsCaps),
    round(plan.totalGoalSavings),
    round(plan.savingsTarget.effective),
    round(plan.totalAvgSpend),
  ].join('|')
}

/** Why a stored budget generation no longer describes what is on screen, or null when it still does. */
export function staleBudgetInsightReason({ record, scopeKey, plan }) {
  if (!record) return null
  if (record.period !== scopeKey) return 'scope'
  if (record.fingerprint && plan && record.fingerprint !== budgetFingerprint(plan)) return 'plan'
  return null
}
