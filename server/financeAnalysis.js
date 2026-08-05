import dayjs from 'dayjs'
import { formatUsd } from './currencyFormatting.js'
import { buildFinancialPace } from './spendAnalysis.js'
import { bankFlowOf } from '../src/constants/financeRules.js'
import {
  payeeOf, accountOf, buildInflows, buildOutflows, buildDestinations,
  buildFinanceKpis, UNASSIGNED_DESTINATION,
} from '../src/utils/financeAggregations.js'
import { buildInOutModel } from '../src/utils/financeChartModel.js'
import { duplicateFlags } from '../src/utils/duplicates.js'

const TOP_N = 10
const OBSERVATION_COUNT = 3

// Below three months a "thinnest month" is just the smaller of two numbers, and a share of income
// computed over one statement says more about the statement than about the year.
const MIN_MONTHS_FOR_TREND = 3

// A month has to sit this far below the median month's net before it is worth calling out. Without
// a floor every period has a "worst" month, including a period where all six are within $20.
const OUTLIER_GAP_RATIO = 0.35

// Unallocated cash and a savings gap below this are rounding, not a finding.
const MATERIAL_DOLLARS = 100

const round2 = value => Math.round((Number(value) || 0) * 100) / 100
const round4 = value => Math.round((Number(value) || 0) * 10000) / 10000

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid()
}

function dateBounds(rows) {
  let from = null
  let to = null
  for (const row of rows) {
    if (!validDate(row.date)) continue
    if (from === null || row.date < from) from = row.date
    if (to === null || row.date > to) to = row.date
  }
  return { from, to }
}

function monthsBetween(from, to) {
  if (!from || !to) return []
  const months = []
  let cursor = dayjs(from).startOf('month')
  const last = dayjs(to).startOf('month')
  while (cursor.isBefore(last) || cursor.isSame(last)) {
    months.push(cursor.format('YYYY-MM'))
    cursor = cursor.add(1, 'month')
  }
  return months
}

function formatRange(from, to) {
  if (!from || !to) return 'no data'
  return `${dayjs(from).format('MMM D, YYYY')} – ${dayjs(to).format('MMM D, YYYY')}`
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Bank-side scope matching, over `accounts` / `flows` / `payees`.
 *
 * Deliberately separate from the card-side `matchesInsightScope` in `spendAnalysis.js`: the two
 * vocabularies share no filter kind, and one function taking either would have to guess which
 * ledger a scope came from.
 */
export function matchesFinanceScope(tx, scope) {
  if (!scope || scope === 'all') return validDate(tx.date)
  if (typeof scope === 'string') return tx.date?.startsWith(scope)
  if (!validDate(tx.date)) return false
  const { from, to, filters = {} } = scope
  if (from && tx.date < from) return false
  if (to && tx.date > to) return false
  if (filters.accounts?.length && !filters.accounts.includes(accountOf(tx))) return false
  if (filters.flows?.length && !filters.flows.includes(bankFlowOf(tx))) return false
  if (filters.payees?.length && !filters.payees.includes(payeeOf(tx))) return false
  return true
}

function resolvedInsightScope(bankTransactions, requestedScope) {
  const matching = bankTransactions.filter(tx => matchesFinanceScope(tx, requestedScope))
  const bounds = dateBounds(matching)
  if (requestedScope && typeof requestedScope === 'object') {
    const from = requestedScope.from ?? bounds.from
    const to = requestedScope.to ?? bounds.to
    return {
      from,
      to,
      months: from && to ? monthsBetween(from, to) : [],
      filters: requestedScope.filters ?? {},
      label: requestedScope.label ?? formatRange(from, to),
      basis: 'selected_finances_scope',
    }
  }
  return {
    from: bounds.from,
    to: bounds.to,
    months: monthsBetween(bounds.from, bounds.to),
    filters: {},
    label: formatRange(bounds.from, bounds.to),
    basis: requestedScope && requestedScope !== 'all' ? 'legacy_period_scope' : 'all_bank_activity',
  }
}

/**
 * The cash-flow picture for one scope.
 *
 * `buildInOutModel` is reused rather than re-derived so "thinnest month" means exactly what the
 * chart draws. Its pixel fields are ignored here — the shared part is the monthly arithmetic and
 * the rule that a month with no activity can never be the low point.
 */
function summarizeCashflow(rows, scope, cardCredits, countCredits) {
  const months = scope?.months ?? []
  const range = { monthCount: months.length }
  const kpis = buildFinanceKpis(rows, range, cardCredits, countCredits)
  const model = buildInOutModel(rows, months, { cardCredits, countCredits })

  const monthly = model.bars.map(bar => ({
    month: bar.month,
    label: bar.label,
    income: bar.income,
    expenses: bar.expenses,
    net: bar.net,
    hasActivity: bar.hasActivity,
  }))
  const active = monthly.filter(month => month.hasActivity)

  return {
    scope,
    months,
    monthly,
    monthsWithActivity: active.length,
    income: kpis.income,
    countedIncome: kpis.countedIncome,
    expenses: kpis.expenses,
    saved: kpis.saved,
    invested: kpis.invested,
    credits: kpis.credits,
    netCash: kpis.netCash,
    perMonth: kpis.perMonth,
    savedShareOfIncome: kpis.savedShareOfIncome === null ? null : round4(kpis.savedShareOfIncome),
    spendShareOfIncome: kpis.countedIncome > 0 ? round4(kpis.expenses / kpis.countedIncome) : null,
    txCount: kpis.txCount,
    accountCount: kpis.accountCount,
    // `unallocated` is what neither went out nor was deliberately set aside. It is not "savings" —
    // it is money that simply stayed in checking, which is precisely why it is worth naming.
    unallocated: round2(kpis.netCash - kpis.saved - kpis.invested),
    thinnestMonth: model.worst ? { month: model.worst.month, label: model.worst.label, net: model.worst.net } : null,
    medianMonthlyNet: round2(median(active.map(month => month.net))),
  }
}

function observation(key, title, status, evidence, facts, score) {
  return { key, title, status, evidence, facts, score: Math.round(score) }
}

/**
 * The fixed observation catalogue.
 *
 * Every title, number, status and ordering here is deterministic. The model is later handed the
 * selected keys and writes a body for each — it cannot introduce a finding, drop one, reorder them,
 * or restate a number differently, because it never sees the ones that were not selected.
 *
 * `score` is "how much does this deserve one of three slots", not a severity rating shown anywhere.
 */
function buildObservations({ cashflow, pace, outflows, destinations, duplicates }) {
  const found = []
  const months = cashflow.monthsWithActivity

  if (cashflow.spendShareOfIncome !== null && cashflow.expenses > 0) {
    const share = cashflow.spendShareOfIncome
    const cents = Math.round(share * 100)
    found.push(observation(
      'spend_share_of_income',
      `${cents}¢ of every dollar in went back out as spending`,
      share >= 0.9 ? 'watch' : share >= 0.7 ? 'steady' : 'good',
      `${formatUsd(cashflow.expenses)} of spending against ${formatUsd(cashflow.countedIncome)} of income.`,
      { share, expenses: cashflow.expenses, income: cashflow.countedIncome },
      // Always worth a slot, but a share close to half of income is the least interesting case.
      45 + Math.abs(share - 0.5) * 60,
    ))
  }

  if (months >= MIN_MONTHS_FOR_TREND && cashflow.thinnestMonth) {
    const gap = round2(cashflow.medianMonthlyNet - cashflow.thinnestMonth.net)
    const reference = Math.abs(cashflow.medianMonthlyNet)
    if (gap > 0 && (reference === 0 || gap / reference >= OUTLIER_GAP_RATIO)) {
      found.push(observation(
        'outlier_month',
        `${cashflow.thinnestMonth.label} broke the pattern`,
        cashflow.thinnestMonth.net < 0 ? 'watch' : 'steady',
        `${cashflow.thinnestMonth.label} netted ${formatUsd(cashflow.thinnestMonth.net)} against a typical month of ${formatUsd(cashflow.medianMonthlyNet)}.`,
        { month: cashflow.thinnestMonth.month, net: cashflow.thinnestMonth.net, median: cashflow.medianMonthlyNet, gap },
        50 + Math.min(reference > 0 ? (gap / reference) * 40 : 40, 40),
      ))
    }
  }

  if (cashflow.unallocated >= MATERIAL_DOLLARS) {
    const share = cashflow.netCash > 0 ? round4(cashflow.unallocated / cashflow.netCash) : null
    found.push(observation(
      'unallocated_cash',
      'Unallocated cash is building up',
      'steady',
      `${formatUsd(cashflow.unallocated)} stayed in checking after ${formatUsd(cashflow.saved)} to savings and ${formatUsd(cashflow.invested)} to investments.`,
      { unallocated: cashflow.unallocated, saved: cashflow.saved, invested: cashflow.invested, share },
      40 + (share === null ? 0 : share * 35),
    ))
  }

  // The savings gap comes from the Financial Pace window, not the on-screen scope — the pace is a
  // per-month figure over complete months, and mixing it with a partial period would compare a
  // monthly target against a six-month contribution.
  if (pace.status !== 'not_enough_data' && pace.savingsTarget > 0) {
    const gap = round2(pace.savingsTarget - pace.savingsContributions)
    if (gap >= MATERIAL_DOLLARS) {
      found.push(observation(
        'savings_gap',
        `${formatUsd(gap)}/mo short of the savings target`,
        pace.status === 'over_pace' ? 'watch' : 'steady',
        `Savings transfers averaged ${formatUsd(pace.savingsContributions)} a month against a ${formatUsd(pace.savingsTarget)} target.`,
        { gap, target: pace.savingsTarget, contributions: pace.savingsContributions, headroom: pace.headroom },
        55 + Math.min(gap / Math.max(pace.savingsTarget, 1), 1) * 30,
      ))
    }
  }

  const leader = outflows[0]
  if (leader && outflows.length > 1) {
    found.push(observation(
      'outflow_concentration',
      `${leader.name} is ${Math.round(leader.share * 100)}% of everything going out`,
      leader.share >= 0.5 ? 'steady' : 'good',
      `${formatUsd(leader.amount)} across ${leader.visits} ${leader.visits === 1 ? 'transaction' : 'transactions'}, out of ${outflows.length} spending destinations.`,
      { name: leader.name, amount: leader.amount, share: leader.share, visits: leader.visits, payeeCount: outflows.length },
      30 + leader.share * 45,
    ))
  }

  if (duplicates.dollarExposure > 0) {
    found.push(observation(
      'duplicate_exposure',
      `${formatUsd(duplicates.dollarExposure)} may be double-counted`,
      'watch',
      `${duplicates.groupCount} ${duplicates.groupCount === 1 ? 'set' : 'sets'} of transactions look like repeats of each other.`,
      { exposure: duplicates.dollarExposure, groupCount: duplicates.groupCount },
      // Ranked high on purpose: unlike every other observation this one says the numbers on the
      // page may be wrong, which the user should hear before any interpretation of them.
      75,
    ))
  }

  const unassigned = destinations.unassigned
  if (unassigned >= MATERIAL_DOLLARS && destinations.total > 0) {
    found.push(observation(
      'unlinked_allocation',
      `${formatUsd(unassigned)} set aside with no destination linked`,
      'steady',
      `${formatUsd(destinations.total)} moved to savings and investments, of which ${formatUsd(unassigned)} is not linked to an account.`,
      { unassigned, total: destinations.total },
      25 + round4(unassigned / destinations.total) * 25,
    ))
  }

  return found
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, OBSERVATION_COUNT)
}

/**
 * Pure Finance Analysis interface. It reads no files, clocks, settings stores or remote systems.
 *
 * `buildFinancialPace` and `fullMonthsWithData` are imported from `spendAnalysis.js` rather than
 * reimplemented — that is what makes the Financial Pace on the Finances tab and on the Spend
 * Analyzer one number instead of two that happen to agree today.
 */
export function buildFinanceAnalysis({
  bankTransactions = [],
  cardTransactions = [],
  savingsAccounts = [],
  settings = {},
  insightScope = null,
} = {}) {
  const pace = buildFinancialPace(bankTransactions, settings)
  const scope = resolvedInsightScope(bankTransactions, insightScope)
  const scopedRows = bankTransactions.filter(tx => matchesFinanceScope(tx, insightScope))

  const countCredits = !!settings?.countCardCreditsAsIncome
  const credits = cardTransactions.filter(tx =>
    Number(tx.amount) > 0
    && validDate(tx.date)
    && (!scope.from || tx.date >= scope.from)
    && (!scope.to || tx.date <= scope.to))

  const cashflow = summarizeCashflow(scopedRows, scope, credits, countCredits)
  const inflows = buildInflows(scopedRows).slice(0, TOP_N)
  const outflows = buildOutflows(scopedRows).slice(0, TOP_N)
  const destinations = buildDestinations(scopedRows, savingsAccounts, scope.months.length)

  // Duplicates span the whole ledger, never the scope: a pair straddling a period boundary is
  // exactly the case a scoped check would miss, and it is the one most worth surfacing.
  const flags = duplicateFlags(bankTransactions)
  const duplicates = { groupCount: flags.groupCount, dollarExposure: flags.dollarExposure }

  return {
    pace,
    cashflow,
    inflows,
    outflows,
    destinations,
    duplicates,
    observations: buildObservations({ cashflow, pace, outflows, destinations, duplicates }),
    scopes: {
      insight: scope,
      financial: pace.scope,
    },
  }
}

export { UNASSIGNED_DESTINATION }
