import dayjs from 'dayjs'
import { formatUsd } from './currencyFormatting.js'
import { resolveDisplayCurrency } from '../src/utils/displayCurrency.js'
import {
  buildLiquidKpis, buildComposition, buildChangeAttribution, buildUnaccountedRows,
  monthsOfSpend, averageMonthlySpend, completeMonths, goalProgress,
  portfolioValueOf, savingsTotalOf, BUCKET_LABELS,
} from '../src/utils/liquidNetWorth.js'

const OBSERVATION_COUNT = 3

// Below this a discrepancy, a shortfall or a residual is rounding on a five-figure balance, not a
// finding. Same threshold the Finances catalogue uses, for the same reason.
const MATERIAL_DOLLARS = 100

// Three months of ordinary spending is the conventional floor for an emergency buffer. Used only
// to pick a status word; the number itself is always stated plainly.
const RUNWAY_COMFORTABLE = 3
const RUNWAY_THIN = 1

// A bucket holding more than this share of everything is worth naming — not as a mistake, but
// because a reader looking at one total cannot see that it is really one account.
const CONCENTRATION_SHARE = 0.6

const round2 = value => Math.round((Number(value) || 0) * 100) / 100
const round4 = value => Math.round((Number(value) || 0) * 10000) / 10000

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid()
}

function formatRange(from, to) {
  if (!from || !to) return 'no data'
  return `${dayjs(from).format('MMM D, YYYY')} – ${dayjs(to).format('MMM D, YYYY')}`
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

/**
 * The window the change decomposition covers.
 *
 * Unlike the two ledger triads there are no filter chips here — the Dashboard scopes one card, by
 * date, and nothing else. So a scope is a plain range, and `buildScopeKey` on the client produces
 * `6M|from|to` with no filter parts, which keeps the APPEND-ONLY `FILTER_ORDER` contract in
 * `period.js` untouched.
 */
function resolvedScope(bankTransactions, requestedScope) {
  const bounds = dateBounds(bankTransactions)
  if (requestedScope && typeof requestedScope === 'object') {
    const from = requestedScope.from ?? bounds.from
    const to = requestedScope.to ?? bounds.to
    return { from, to, label: requestedScope.label ?? formatRange(from, to), basis: 'selected_dashboard_period' }
  }
  return {
    from: bounds.from,
    to: bounds.to,
    label: formatRange(bounds.from, bounds.to),
    basis: 'all_bank_activity',
  }
}

function observation(key, title, status, evidence, facts, score) {
  return { key, title, status, evidence, facts, score: Math.round(score) }
}

/**
 * The fixed observation catalogue for the Dashboard.
 *
 * Deliberately disjoint from the Finances one. That catalogue is about the ledger — what came in,
 * where it went, whether the savings target was met. This one is about the BALANCE: what it is made
 * of, what moved it, how long it would last, and whether the arithmetic behind it holds. A user
 * reading both tabs should never see the same finding twice under two headings.
 *
 * As on the other triads, every title, status, number and ordering here is decided in JS. The model
 * is handed the selected keys and writes a body under each; it cannot add a finding, drop one,
 * reorder them, or restate a number differently, because it never sees the rest.
 */
function buildObservations({ attribution, composition, runway, goals, kpis }) {
  const found = []

  // Ranked above every interpretation, for the same reason `duplicate_exposure` is on the Finances
  // side: this one says the balance itself may be wrong, and the user should hear that before any
  // reading of it. `unexplained` is the in-coverage half only — statement lag is expected and is
  // reported as evidence rather than as a problem.
  if (Math.abs(attribution.unexplained) >= MATERIAL_DOLLARS) {
    const lagNote = Math.abs(attribution.lag) >= MATERIAL_DOLLARS
      ? ` A further ${formatUsd(attribution.lag)} is statement lag, which is expected.`
      : ''
    found.push(observation(
      'unexplained_cash',
      `${formatUsd(Math.abs(attribution.unexplained))} of cash the ledger cannot account for`,
      'watch',
      `Reconciling your real balance moved cash by ${formatUsd(attribution.unexplained)} over dates the imported statements already cover.${lagNote}`,
      {
        unexplained: attribution.unexplained,
        lag: attribution.lag,
        from: attribution.from,
        to: attribution.to,
        entries: attribution.rows.filter(row => row.kind === 'unexplained').length,
      },
      85,
    ))
  }

  if (attribution.change !== 0 && (attribution.saved !== 0 || attribution.market !== 0)) {
    const savedLead = Math.abs(attribution.saved) >= Math.abs(attribution.market)
    found.push(observation(
      'saved_vs_markets',
      savedLead
        ? `Most of the change came from what you saved, not the markets`
        : `Most of the change came from the markets, not what you saved`,
      attribution.change >= 0 ? 'good' : 'watch',
      `Liquid net worth moved ${formatUsd(attribution.change)}: ${formatUsd(attribution.saved)} from money in against money out, and ${formatUsd(attribution.market)} from investment prices.`,
      {
        change: attribution.change,
        saved: attribution.saved,
        market: attribution.market,
        savedShare: attribution.savedShare,
        marketShare: attribution.marketShare,
        basis: attribution.basis,
      },
      // A lopsided split is the interesting case; a near-even one is worth a slot but not the top.
      50 + (attribution.marketShare === null ? 0 : Math.abs(attribution.marketShare - 50) * 0.4),
    ))
  }

  if (runway.months !== null) {
    const status = runway.months < RUNWAY_THIN ? 'watch' : runway.months < RUNWAY_COMFORTABLE ? 'steady' : 'good'
    // The benchmark is stated here, in JS, and not left for the model to supply. Without it a
    // generation filled the gap on its own and wrote that 1.1 months "aligns with a conventional
    // emergency fund target" — an evaluative claim, unsupported and backwards. A threshold the
    // catalogue already knows must be handed over as a fact, not left as a hole to be filled.
    const versus = runway.months >= RUNWAY_COMFORTABLE
      ? `at or above the ${RUNWAY_COMFORTABLE}-month buffer commonly used as a rule of thumb`
      : `below the ${RUNWAY_COMFORTABLE}-month buffer commonly used as a rule of thumb`
    found.push(observation(
      'cash_runway',
      `Cash covers ${runway.months} month${runway.months === 1 ? '' : 's'} of ordinary spending`,
      status,
      `${formatUsd(runway.cash)} in checking against ${formatUsd(runway.averageMonthlySpend)} of spending in a typical month, measured over ${runway.monthsCounted} complete ${runway.monthsCounted === 1 ? 'month' : 'months'} — ${versus}.`,
      {
        months: runway.months, cash: runway.cash, averageMonthlySpend: runway.averageMonthlySpend,
        benchmarkMonths: RUNWAY_COMFORTABLE, meetsBenchmark: runway.months >= RUNWAY_COMFORTABLE,
      },
      45 + (runway.months < RUNWAY_COMFORTABLE ? (RUNWAY_COMFORTABLE - runway.months) * 12 : 0),
    ))
  }

  const leader = composition.rows[0]
  if (leader && composition.total > 0 && composition.rows.length > 1) {
    const share = round4(leader.value / composition.total)
    if (share >= CONCENTRATION_SHARE) {
      found.push(observation(
        'concentration',
        `${Math.round(share * 100)}% of your liquid net worth sits in ${leader.name}`,
        'steady',
        `${formatUsd(leader.value)} of ${formatUsd(composition.total)}, across ${composition.rows.length} places money is held.`,
        { name: leader.name, bucket: leader.bucket, value: leader.value, share, placeCount: composition.rows.length },
        30 + share * 35,
      ))
    }
  }

  // The goal furthest past its own target date at its current funding rate. One observation, not
  // one per goal: three slots exist and a list of goals is what the Goals tab is for.
  const slipping = goals
    .filter(goal => goal.slipMonths !== null && goal.slipMonths > 0)
    .sort((a, b) => b.slipMonths - a.slipMonths)[0]
  if (slipping) {
    found.push(observation(
      'goal_off_pace',
      `${slipping.name} lands about ${slipping.slipMonths} month${slipping.slipMonths === 1 ? '' : 's'} late`,
      'watch',
      `${formatUsd(slipping.remaining)} still to go at ${formatUsd(slipping.pace.perMonth)} a month, reaching the target around ${dayjs(slipping.eta).format('MMM YYYY')} against a ${dayjs(slipping.targetDate).format('MMM YYYY')} deadline.`,
      {
        name: slipping.name, remaining: slipping.remaining, perMonth: slipping.pace.perMonth,
        paceSource: slipping.pace.source, eta: slipping.eta, targetDate: slipping.targetDate,
        slipMonths: slipping.slipMonths,
      },
      55 + Math.min(slipping.slipMonths, 12) * 2.5,
    ))
  }

  // A goal with no detectable funding at all is a different problem from a slow one, and reporting
  // it as "0 months late" would be both wrong and useless.
  const unfunded = goals.filter(goal => !goal.reached && !(goal.pace.perMonth > 0))
  if (unfunded.length) {
    found.push(observation(
      'goal_unfunded',
      unfunded.length === 1
        ? `${unfunded[0].name} has no funding rate set`
        : `${unfunded.length} goals have no funding rate set`,
      'steady',
      `${formatUsd(unfunded.reduce((total, goal) => total + goal.remaining, 0))} of remaining targets with neither a monthly plan nor transfers the ledger can attribute.`,
      { names: unfunded.map(goal => goal.name), remaining: round2(unfunded.reduce((total, goal) => total + goal.remaining, 0)) },
      35,
    ))
  }

  // The fallback for a period with no decomposable change. Dated by `kpis.since` rather than by
  // the nominal 30 days: when history is younger than the window, `buildLiquidKpis` compares
  // against the earliest point it has, and quoting "30 days" over a five-month gap would be a lie.
  if (kpis.deltas && kpis.since && Math.abs(kpis.deltas.liquid.abs) >= MATERIAL_DOLLARS && !found.some(item => item.key === 'saved_vs_markets')) {
    found.push(observation(
      'recent_move',
      `${formatUsd(kpis.deltas.liquid.abs)} since ${dayjs(kpis.since).format('MMM D, YYYY')}`,
      kpis.deltas.liquid.abs >= 0 ? 'good' : 'watch',
      `Liquid net worth is ${formatUsd(kpis.liquid)} today against ${formatUsd(round2(kpis.liquid - kpis.deltas.liquid.abs))} then.`,
      { abs: kpis.deltas.liquid.abs, pct: kpis.deltas.liquid.pct, since: kpis.since },
      40,
    ))
  }

  return found
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, OBSERVATION_COUNT)
}

/**
 * Pure Dashboard Analysis interface. It reads no files, clocks, settings stores or remote systems —
 * `asOf` and `prices` are supplied by the caller precisely so that stays true.
 *
 * Every number here comes from `src/utils/liquidNetWorth.js`, the same module the Dashboard cards
 * render from. That is the whole point of the triad: an insight quoting a figure the KPI strip
 * contradicts is worse than no insight, and importing the shared functions is what makes agreement
 * structural rather than a coincidence that holds until one side gains a rounding rule.
 */
export function buildDashboardAnalysis({
  netWorthHistory = [],
  bankTransactions = [],
  goals = [],
  savingsAccounts = [],
  holdings = [],
  prices = {},
  cash = 0,
  // Derived by `statementChecks` on the server and passed in, never recomputed here: the route
  // already holds the opening balance and the full statement series, and two derivations of one
  // figure is how the insights start disagreeing with the card above them.
  checks = [],
  settings = {},
  insightScope = null,
  asOf = null,
} = {}) {
  const today = asOf ?? dayjs().format('YYYY-MM-DD')
  const scope = resolvedScope(bankTransactions, insightScope)

  // The home currency and FX rate the Dashboard cards value holdings in. `Dashboard.jsx` passes
  // both into the same two functions; omitting them here valued a foreign portfolio at cost while
  // the card beside it showed market, which is precisely the disagreement this module exists to
  // make impossible. `dashboardAnalysisInputs` supplies the rate on the price map, as `fetchPricesWithFx` builds it.
  const home = resolveDisplayCurrency(settings?.displayCurrency)
  const usdCad = prices?.__USDCAD ?? null

  const savings = savingsTotalOf(savingsAccounts)
  const portfolio = portfolioValueOf(holdings, prices, { displayCurrency: home, usdCad })
  const kpis = buildLiquidKpis({ history: netWorthHistory, cash, savings, portfolio, asOf: today })

  const rows = buildComposition({ cash, savings, holdings, prices, displayCurrency: home, usdCad })
  const composition = {
    total: round2(rows.reduce((total, row) => total + row.value, 0)),
    rows: [...rows].sort((a, b) => b.value - a.value),
  }

  const raw = buildChangeAttribution(netWorthHistory, bankTransactions, scope, checks)
  // The itemised unaccounted rows travel with the attribution so chat can name and date a gap
  // rather than reporting one anonymous total, exactly as the waterfall's drill-down does.
  const attribution = { ...raw, rows: buildUnaccountedRows(raw) }

  const runway = {
    cash: round2(cash),
    months: monthsOfSpend(bankTransactions, cash),
    averageMonthlySpend: averageMonthlySpend(bankTransactions),
    // How many complete months the average was taken over — a runway drawn from one month of data
    // is a guess, and the evidence line has to say so rather than quoting a bare figure.
    monthsCounted: completeMonths(bankTransactions).length,
  }

  const goalRows = goals.map(goal => {
    const progress = goalProgress(goal, bankTransactions, 6, today)
    return {
      id: goal.id,
      name: goal.name,
      targetAmount: round2(goal.targetAmount),
      currentAmount: round2(goal.currentAmount),
      targetDate: goal.targetDate ?? null,
      ...progress,
    }
  }).sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))

  return {
    asOf: today,
    scope,
    kpis,
    composition,
    attribution,
    runway,
    goals: goalRows,
    observations: buildObservations({ attribution, composition, runway, goals: goalRows, kpis }),
  }
}

export { BUCKET_LABELS }
