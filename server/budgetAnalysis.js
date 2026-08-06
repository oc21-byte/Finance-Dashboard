import { formatUsd } from './currencyFormatting.js'
import { buildBudgetPlan, budgetFingerprint } from '../src/utils/budgetModel.js'

// The Budget triad's deterministic half.
//
// **Its subject is the PLAN, and only the plan.** The three existing catalogues are disjoint by
// subject — spend is the card ledger, finance the bank ledger, dashboard the balance — and this is
// the fourth: what the user has decided to commit their income to, and how those decisions compare
// against the averages the ledgers report. It never reports a transaction, a merchant, a payee or
// a balance. A user reading two tabs must not meet one finding under two headings.
//
// The sharpest boundary is with Spend's Financial Pace, which also involves a savings rate:
//
//   Financial Pace  → savingsContributions / income — what the ledger says ACTUALLY happened.
//   Budget          → totalSavingsPlanned  / income — what the plan INTENDS.
//
// They are routinely far apart. Every string here says "planned", and nothing here is ever
// labelled a savings rate without it.
//
// `buildBudgetPlan` is imported from `src/utils/budgetModel.js` — the same module the Budget cards
// render from — so an insight agreeing with the KPI strip above it is structural rather than luck.
// Same arrangement `buildDashboardAnalysis` has with `liquidNetWorth.js`.
//
// Pure: no clock, no file, no network. Everything arrives as an argument.

const OBSERVATION_COUNT = 3
const ANALYSIS_VERSION = 1

// A cap gap smaller than this is noise against a monthly average built from six months of imports.
const MATERIAL_DOLLARS = 25
// Uncapped spending worth mentioning. Below this, telling someone to set a cap is busywork.
const UNCAPPED_MATERIAL = 75
// Headroom above this share of income reads as "you have not decided where this goes" rather than
// as prudent slack. The comparison is made HERE so the model is never handed the raw share and
// left to invent a benchmark for it — see the RUNWAY_COMFORTABLE lesson in AGENTS.md.
const IDLE_HEADROOM_SHARE = 0.2

const round2 = value => Math.round(Number(value) * 100) / 100
const share = (part, whole) => (whole > 0 ? Math.round(part / whole * 10000) / 10000 : null)

function observation(key, title, status, evidence, facts, score) {
  return { key, title, status, evidence, facts, score: Math.round(score) }
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

/**
 * The catalogue. Fixed, ranked, and selected in JS — the model later writes only the body under
 * each selected title, and an unexpected key rejects the whole generation.
 */
function selectObservations(plan) {
  const found = []
  const { income, capPressure, savingsRate, budgetedLeft, totalSpendingCaps, goalRows } = plan
  const incomeDollars = income.display

  // Ranked above everything else: a plan that does not fit inside its own income makes every
  // other observation about that plan secondary.
  if (budgetedLeft < 0) {
    found.push(observation(
      'over_committed',
      `The plan commits ${formatUsd(Math.abs(budgetedLeft))} more than comes in`,
      'watch',
      `${formatUsd(totalSpendingCaps)} of spending caps and ${formatUsd(plan.totalSavingsPlanned)} of planned savings against ${formatUsd(incomeDollars)} of monthly income.`,
      {
        overBy: round2(Math.abs(budgetedLeft)),
        income: incomeDollars,
        spendingCaps: totalSpendingCaps,
        savingsPlanned: plan.totalSavingsPlanned,
      },
      95,
    ))
  }

  if (capPressure.overCount > 0 && capPressure.overBy >= MATERIAL_DOLLARS) {
    const worst = capPressure.worst
    found.push(observation(
      'caps_below_actual',
      `${capPressure.overCount} of ${capPressure.capped} ${plural(capPressure.capped, 'cap')} ${plural(capPressure.overCount, 'sits', 'sit')} below what actually gets spent`,
      'watch',
      // Scoped explicitly to the over-cap rows. Stated as a bare total it sits one sentence away
      // from the caps total and the average-spend total, and a generation will happily present it
      // as the difference between those two — which it is not, because under-cap categories are
      // excluded from it.
      `Across just the categories that are over, average spending exceeds their caps by ${formatUsd(capPressure.overBy)} a month, with ${worst.name} the widest single gap at ${formatUsd(worst.avg)} against a ${formatUsd(worst.cap)} cap.`,
      {
        overCount: capPressure.overCount,
        cappedCount: capPressure.capped,
        overBy: capPressure.overBy,
        worst: { name: worst.name, cap: worst.cap, average: worst.avg, pct: worst.pct },
      },
      // A plan whose caps are all fiction is worse than one with a single stretch category.
      70 + Math.min(capPressure.overCount / Math.max(capPressure.capped, 1), 1) * 20,
    ))
  }

  const uncapped = plan.spendingCategories
    .filter(row => row.cap == null && row.avg >= UNCAPPED_MATERIAL)
    .sort((a, b) => b.avg - a.avg)
  if (uncapped.length) {
    const total = round2(uncapped.reduce((sum, row) => sum + row.avg, 0))
    found.push(observation(
      totalSpendingCaps > 0 ? 'uncapped_spending' : 'no_caps_set',
      totalSpendingCaps > 0
        ? `${formatUsd(total)} a month is spent outside any cap`
        : 'No spending caps are set yet',
      'steady',
      `${uncapped.length} ${plural(uncapped.length, 'category', 'categories')} with regular spending ${plural(uncapped.length, 'has', 'have')} no cap, led by ${uncapped[0].name} at ${formatUsd(uncapped[0].avg)} a month.`,
      {
        count: uncapped.length,
        total,
        shareOfIncome: share(total, incomeDollars),
        categories: uncapped.slice(0, 5).map(row => ({ name: row.name, average: row.avg })),
      },
      // Nothing capped at all is a bigger gap than a few strays alongside a working plan.
      totalSpendingCaps > 0 ? 45 + Math.min(share(total, incomeDollars) ?? 0, 0.5) * 40 : 80,
    ))
  }

  if (incomeDollars > 0 && savingsRate.targetPct > 0) {
    if (savingsRate.shortfall >= MATERIAL_DOLLARS) {
      found.push(observation(
        'planned_rate_below_target',
        `The plan sets aside ${savingsRate.plannedPct}% against a ${savingsRate.targetPct}% target`,
        'watch',
        `Planned savings of ${formatUsd(plan.totalSavingsPlanned)} a month fall ${formatUsd(savingsRate.shortfall)} short of the ${formatUsd(savingsRate.targetDollars)} target.`,
        {
          plannedPct: savingsRate.plannedPct,
          targetPct: savingsRate.targetPct,
          plannedDollars: plan.totalSavingsPlanned,
          targetDollars: savingsRate.targetDollars,
          shortfall: savingsRate.shortfall,
        },
        65,
      ))
    } else {
      found.push(observation(
        'planned_rate_clears_target',
        `The plan sets aside ${savingsRate.plannedPct}% of income`,
        'good',
        `Planned savings of ${formatUsd(plan.totalSavingsPlanned)} a month clear the ${savingsRate.targetPct}% target of ${formatUsd(savingsRate.targetDollars)}. This is what the plan intends, not what the ledger shows was saved.`,
        {
          plannedPct: savingsRate.plannedPct,
          targetPct: savingsRate.targetPct,
          plannedDollars: plan.totalSavingsPlanned,
          targetDollars: savingsRate.targetDollars,
          aheadBy: round2(-savingsRate.shortfall),
        },
        40,
      ))
    }
  }

  // Only when the plan actually fits: uncommitted income inside an over-committed plan is not
  // headroom, it is an artefact of the shortfall, and calling it slack would contradict the
  // observation ranked at the top of this list.
  const headroomShare = share(budgetedLeft, incomeDollars)
  if (budgetedLeft > 0 && headroomShare !== null && headroomShare >= IDLE_HEADROOM_SHARE) {
    found.push(observation(
      'idle_headroom',
      `${Math.round(headroomShare * 100)}% of income is not committed anywhere`,
      'steady',
      `${formatUsd(budgetedLeft)} a month is left after every cap and every savings commitment, which is above the ${Math.round(IDLE_HEADROOM_SHARE * 100)}% the plan would normally have spare.`,
      { headroom: round2(budgetedLeft), shareOfIncome: headroomShare, benchmark: IDLE_HEADROOM_SHARE },
      50 + Math.min(headroomShare, 0.6) * 30,
    ))
  }

  const unfunded = goalRows.filter(row => row.amount <= 0)
  if (unfunded.length) {
    found.push(observation(
      'goal_unfunded',
      `${unfunded.length} active ${plural(unfunded.length, 'goal')} ${plural(unfunded.length, 'has', 'have')} no monthly funding`,
      'steady',
      `${unfunded.map(row => row.name).join(', ')} ${plural(unfunded.length, 'is', 'are')} set as a goal with no amount planned and none detected in bank activity.`,
      { count: unfunded.length, names: unfunded.map(row => row.name) },
      55,
    ))
  }

  // Ranked deliberately low but always available: it qualifies every figure above rather than
  // reporting a problem of its own.
  if (!income.isConfirmed && incomeDollars > 0) {
    found.push(observation(
      'income_unconfirmed',
      'Income is a bank average, not a confirmed figure',
      'steady',
      `Every share above is measured against ${formatUsd(incomeDollars)} a month observed across ${income.monthsCovered} complete ${plural(income.monthsCovered, 'month')} of bank activity.`,
      { income: incomeDollars, monthsCovered: income.monthsCovered, source: 'observed_bank_income' },
      20,
    ))
  }

  return found
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, OBSERVATION_COUNT)
}

/**
 * Pure Budget Analysis interface. It reads no files, clocks, settings stores or remote systems.
 *
 * `fin` is the output of `buildMonthlyFinancials` — averages over the last <=6 complete bank
 * months. That window is the Budget tab's fixed scope: there are no period chips here, because a
 * plan is a monthly statement of intent rather than something you slice by date.
 */
export function buildBudgetAnalysis({ settings = {}, goals = [], fin = null, insightScope = null } = {}) {
  const plan = buildBudgetPlan({ settings, goals, fin })
  const observations = selectObservations(plan)

  return {
    analysisVersion: ANALYSIS_VERSION,
    scope: {
      label: plan.income.windowLabel ?? 'no complete bank months',
      monthsCovered: plan.income.monthsCovered,
      ...(insightScope && typeof insightScope !== 'string' ? insightScope : {}),
    },
    // The fingerprint travels with the generation so a later edit to any cap, the income, or the
    // target can be detected as staleness without re-running the analysis client-side.
    fingerprint: budgetFingerprint(plan),
    income: plan.income,
    caps: {
      spendingTotal: plan.totalSpendingCaps,
      averageSpend: plan.totalAvgSpend,
      pressure: plan.capPressure,
      rows: plan.spendingCategories.map(row => ({
        name: row.name, cap: row.cap, average: row.avg, pct: row.pct, over: row.over, near: row.near,
        // The per-row gap, supplied rather than left to be derived. A model handed only the cap
        // and the average will subtract them itself, and "do not perform arithmetic" is a weaker
        // guarantee than simply not leaving the subtraction to be done.
        overBy: row.over ? round2(row.avg - row.cap) : null,
      })),
    },
    savings: {
      planned: plan.totalSavingsPlanned,
      goals: plan.totalGoalSavings,
      target: plan.savingsTarget.effective,
      targetSource: plan.savingsTarget.source,
      categoryCaps: plan.totalSavingsCaps,
      rate: plan.savingsRate,
      rows: plan.savingsCategories.map(row => ({ name: row.name, planned: row.cap, detected: row.avg })),
      goalRows: plan.goalRows.map(row => ({
        name: row.name, planned: row.amount, isAuto: row.isAuto, detected: row.bankAvg,
      })),
    },
    allocation: {
      ...plan.allocation,
      budgetedLeft: plan.budgetedLeft,
      avgLeft: plan.avgLeft,
      spread: plan.spread,
    },
    detectedFromBank: plan.detectedFromBank,
    observations,
  }
}
