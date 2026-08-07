// Liquid net worth — the Dashboard's math, extracted from the page.
//
// "Liquid net worth" is cash + savings + investment accounts. It excludes property, vehicles,
// private or corporate shares, and debts, none of which the app tracks. The name is deliberate:
// the number was previously labelled "net worth", which claimed far more than it measured.
//
// Everything here is a pure function of data the page already queries. The server counterpart is
// `server/netWorthHistory.js`, which owns the stored history these functions read; the split is
// the same one Finances and Spend use — derivation on the server, presentation math here.

import dayjs from 'dayjs'
import {
  isBankIncome,
  isBankExpense,
  isSavingsTransfer,
  isInvestmentTransfer,
} from '../constants/financeRules.js'
import { accountTypeOf } from './investmentsModel.js'
import { convertHoldingMoney, normalizeCurrency } from './displayCurrency.js'

const r2 = n => Math.round((n ?? 0) * 100) / 100

// The API returns history sorted, but anything that indexes positionally (earliest, latest, last
// point in a month) is wrong by a whole month if it ever arrives otherwise — and it does, since a
// backfill appends older dates after newer ones. Sort at the door rather than trusting callers.
const byDate = (history = []) => [...history].filter(e => e?.date).sort((a, b) => a.date.localeCompare(b.date))

// The only axis the stored history has. Investment ACCOUNT TYPES (TFSA, RRSP, …) are a finer
// split available for today's composition but not backwards in time, which is why the donut
// filters the trend by parent bucket rather than by slice.
export const LIQUID_BUCKETS = ['cash', 'savings', 'portfolio']

export const BUCKET_LABELS = { cash: 'Cash', savings: 'Savings', portfolio: 'Portfolio' }

// The trend plots balances, so it is anchored to real calendar time. This is deliberately NOT
// `PERIOD_KEYS` from period.js: those anchor to the latest TRANSACTION, which is the right anchor
// for flows (a ledger lags real life by a statement cycle) and the wrong one for balances, which
// are current as of today whether or not a statement has landed.
export const TREND_PERIODS = ['6M', '1Y', 'All']

// When an unexplained gap is worth chasing. Exported so the card can state the threshold it is
// applying rather than printing a number that agrees with this one by coincidence.
export const MATERIAL_FLOOR = 50
export const MATERIAL_SHARE = 0.01

/** Value holdings in the display currency, falling back to converted cost when unpriced. */
export function portfolioValueOf(
  holdings = [],
  prices = {},
  { displayCurrency = 'CAD', usdCad = null } = {},
) {
  const home = normalizeCurrency(displayCurrency) || 'CAD'
  return r2(holdings.reduce((sum, h) => {
    const { value } = convertHoldingMoney(h, { prices, displayCurrency: home, usdCad })
    return sum + value
  }, 0))
}

/** Today's portfolio split by investment account type, at the same prices. */
export function holdingsByAccountType(
  holdings = [],
  prices = {},
  { displayCurrency = 'CAD', usdCad = null } = {},
) {
  const home = normalizeCurrency(displayCurrency) || 'CAD'
  const byType = {}
  for (const h of holdings) {
    const type = accountTypeOf(h)
    const { value } = convertHoldingMoney(h, { prices, displayCurrency: home, usdCad })
    byType[type] = (byType[type] ?? 0) + value
  }
  return Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, r2(v)]))
}

export function savingsTotalOf(savingsAccounts = []) {
  return r2(savingsAccounts.reduce((s, a) => s + (a.balance ?? 0), 0))
}

/**
 * The latest history point at or before `date`, or null.
 *
 * At-or-before rather than nearest: a range boundary must never be answered with a balance from
 * the future, which would let a later deposit leak into an earlier period's change.
 */
export function historyAt(history = [], date) {
  let found = null
  for (const entry of history) {
    if (entry.date <= date && (!found || entry.date > found.date)) found = entry
  }
  return found
}

/**
 * Today's four headline figures and how each moved over the trailing window.
 *
 * Today's values come from live data (settings, savings accounts, live prices), NOT from the
 * newest history point — the card must agree with the rest of the app the instant a balance is
 * edited, and history only catches up on the next snapshot. The comparison point comes from
 * history, since that is the only record of the past.
 */
export function buildLiquidKpis({ history = [], cash = 0, savings = 0, portfolio = 0, days = 30, asOf = null }) {
  const today = asOf ?? dayjs().format('YYYY-MM-DD')
  const liquid = r2(cash + savings + portfolio)
  const totals = { liquid, cash, savings, portfolio }

  const sorted = byDate(history)
  const cutoff = dayjs(today).subtract(days, 'day').format('YYYY-MM-DD')
  // Fall back to the earliest point when history is younger than the window: comparing against
  // "as far back as we go" is more useful than showing nothing, provided `since` is surfaced.
  const prior = historyAt(sorted, cutoff) ?? (sorted.length ? sorted[0] : null)

  if (!prior || prior.date >= today) {
    return { ...totals, deltas: null, since: null, days, basis: null }
  }

  const priorTotals = {
    liquid: prior.netWorth,
    cash: prior.breakdown?.cash ?? 0,
    savings: prior.breakdown?.savings ?? 0,
    portfolio: prior.breakdown?.portfolio ?? 0,
  }

  const deltas = {}
  for (const key of Object.keys(totals)) {
    const abs = r2(totals[key] - priorTotals[key])
    deltas[key] = { abs, pct: priorTotals[key] !== 0 ? r2((abs / Math.abs(priorTotals[key])) * 100) : null }
  }

  return { ...totals, deltas, since: prior.date, days, basis: prior.basis ?? null }
}

/** Points for the KPI sparkline: liquid net worth over the trailing window, oldest first. */
export function sparklinePoints(history = [], days = 30, asOf = null) {
  const sorted = byDate(history)
  const cutoff = dayjs(asOf ?? undefined).subtract(days, 'day').format('YYYY-MM-DD')
  const within = sorted.filter(e => e.date >= cutoff)
  // One point cannot draw a line; widen to the whole history rather than render a stub.
  return (within.length >= 2 ? within : sorted).map(e => ({ date: e.date, value: e.netWorth }))
}

/**
 * Monthly points for the trend chart: one per calendar month plus today's, oldest first.
 *
 * Month-end is represented by the last point recorded in that month, which after a rebuild is the
 * true month-end. Today is always appended so the newest value on screen matches the KPI strip.
 */
export function buildTrendSeries(history = [], periodKey = '6M', asOf = null) {
  const sorted = byDate(history)
  if (!sorted.length) return []
  const today = asOf ?? dayjs().format('YYYY-MM-DD')
  const months = { '6M': 6, '1Y': 12 }[periodKey] ?? null
  const from = months ? dayjs(today).subtract(months - 1, 'month').startOf('month').format('YYYY-MM-DD') : null

  const within = from ? sorted.filter(e => e.date >= from) : sorted
  const byMonth = new Map()
  for (const entry of within) byMonth.set(entry.date.slice(0, 7), entry)

  const latest = within[within.length - 1]
  const points = [...byMonth.values()]
  if (latest && points[points.length - 1] !== latest) points.push(latest)

  return points
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      date: e.date,
      label: dayjs(e.date).format("MMM 'YY"),
      cash: e.breakdown?.cash ?? 0,
      savings: e.breakdown?.savings ?? 0,
      portfolio: e.breakdown?.portfolio ?? 0,
      liquid: e.netWorth,
      basis: e.basis ?? null,
    }))
}

/**
 * Decompose a change in liquid net worth into what you saved, what the markets did, and what is
 * left over.
 *
 * The identity, which holds by construction because history stores market value and cost basis
 * separately (see server/netWorthHistory.js):
 *
 *   end − start = (moneyIn − moneyOut) + market + other
 *
 * `market` is the change in UNREALISED GAIN — end's (market − cost) minus start's. A purchase
 * raises market value and cost by the same amount, so contributions cancel out and cannot be
 * mistaken for performance.
 *
 * `reconciliation` is the cash the ledger could not account for, taken from `statementChecks` —
 * each statement's closing balance against what the rows since the previous statement predicted.
 * It is split further:
 *
 *   lag         — checks whose date the ledger does not reach. A balance was recorded for a
 *                 statement whose rows were never imported, so this is a missing import rather
 *                 than a missing transaction, and must not be presented as a mystery.
 *   unexplained — checks INSIDE coverage. The ledger claimed to know that stretch and was wrong,
 *                 so this is the number actually worth chasing, and it names which statement.
 *
 * `other` is what is left after all of that, and should sit near zero. Anything large means the
 * decomposition itself has sprung a leak.
 *
 * Naming these separately is the point. Folding them into `market` would be a lie about
 * investment performance, and folding them into one "Other" bar tells the user something is
 * wrong without telling them what.
 *
 * `range` is a resolved range from period.js — anchored to the latest transaction, because
 * moneyIn/moneyOut are flows and a today-anchored range would end mid-statement.
 */
export function buildChangeAttribution(history = [], bankRows = [], range = null, checks = []) {
  const empty = {
    from: null, to: null, start: 0, end: 0, change: 0,
    moneyIn: 0, moneyOut: 0, saved: 0, market: 0, other: 0,
    reconciliation: 0, lag: 0, unexplained: 0, adjustments: [],
    savedShare: null, marketShare: null, basis: null, hasOther: false, hasReconciliation: false,
  }
  const sorted = byDate(history)
  if (!sorted.length || !range?.from || !range?.to) return empty

  const startEntry = historyAt(sorted, range.from) ?? sorted[0]
  const endEntry = historyAt(sorted, range.to) ?? sorted[sorted.length - 1]
  if (!startEntry || !endEntry || startEntry.date === endEntry.date) return empty

  // Flows must be summed over the SAME window the balances describe, not over the requested
  // range. History rarely has a point on the exact boundary — ask for Jul 13 and the nearest
  // point at or before it might be Jul 9 — so any row in that gap would otherwise be counted as
  // a flow while its effect on the balance sat outside `end`, leaking into the residual.
  const rows = bankRows.filter(t => t.date && t.date > startEntry.date && t.date <= endEntry.date)
  const moneyIn = r2(rows.filter(isBankIncome).reduce((s, t) => s + t.amount, 0))
  const moneyOut = r2(rows.filter(isBankExpense).reduce((s, t) => s + Math.abs(t.amount), 0))

  const unrealised = e => (e.breakdown?.portfolio ?? 0) - (e.portfolioCost ?? 0)
  const market = r2(unrealised(endEntry) - unrealised(startEntry))

  // Each anchor corrects cash on its own date, so the checks that moved this range are exactly
  // those landing after the start point and on or before the end point.
  const applied = (checks ?? [])
    .filter(c => c?.date && c.date > startEntry.date && c.date <= endEntry.date)
    .sort((x, y) => x.date.localeCompare(y.date))
  const sumGap = list => r2(list.reduce((s, c) => s + (c.discrepancy ?? 0), 0))
  const lag = sumGap(applied.filter(c => c.beyondLedger))
  const unexplained = sumGap(applied.filter(c => !c.beyondLedger))
  const reconciliation = r2(lag + unexplained)

  const start = startEntry.netWorth
  const end = endEntry.netWorth
  const change = r2(end - start)
  const saved = r2(moneyIn - moneyOut)
  const other = r2(change - saved - market - reconciliation)

  // Shares are taken over |saved| + |market| so the two headline percentages always sum to 100
  // even when one term is negative. `other` is excluded on purpose — it is not an explanation.
  const magnitude = Math.abs(saved) + Math.abs(market)
  const share = v => (magnitude > 0 ? Math.round((Math.abs(v) / magnitude) * 100) : null)

  return {
    from: startEntry.date,
    to: endEntry.date,
    start, end, change,
    moneyIn, moneyOut, saved, market, other,
    reconciliation, lag, unexplained,
    // The checks that actually moved this range, so the card can name and date them rather than
    // showing one anonymous bar. Sorted, because they are rendered as a timeline.
    adjustments: applied,
    savedShare: share(saved),
    marketShare: share(market),
    // Market return is only trustworthy when both endpoints were priced at market.
    basis: startEntry.basis === 'market' && endEntry.basis === 'market' ? 'market' : 'partial',
    // Whether the gap is big enough to be worth a reader's attention. It does NOT gate the bar —
    // the steps have to reach End, and a suppressed residual would have to be folded into Market,
    // reporting untraceable movement as investment return. It gates the INVITATION to investigate.
    hasOther: Math.abs(other) > MATERIAL_FLOOR && Math.abs(other) > Math.abs(change) * MATERIAL_SHARE,
    hasReconciliation: Math.abs(reconciliation) > MATERIAL_FLOOR,
  }
}

/**
 * The Unaccounted bar, itemised.
 *
 * One row per dated reconciliation that moved the range, plus a final row for the residual. The
 * point of the itemisation is that "unaccounted" on its own tells the user something is wrong
 * without telling them what — a date, an expected figure and an actual figure turns a mystery into
 * an errand.
 *
 * `from`/`to` bound the stretch over which each discrepancy accumulated: from the previous
 * statement close — the last moment the ledger and the bank agreed — to this one. `statementChecks`
 * already carries that boundary, and it is deliberately the previous statement in the FULL series
 * rather than the in-range subset: the last agreement may predate the period on screen, and
 * pretending otherwise would send the user hunting in the wrong weeks.
 *
 * Rows are ordered by size, not by date: the user wants the $6,000 one, and it should not be
 * third in the list because it happened last.
 */
export function buildUnaccountedRows(attribution) {
  if (!attribution?.from) return []

  const rows = (attribution.adjustments ?? [])
    .filter(c => Math.abs(c.discrepancy ?? 0) >= 0.5)
    .map(c => ({
      key: c.date,
      kind: c.beyondLedger ? 'lag' : 'unexplained',
      date: c.date,
      from: c.from ?? attribution.from,
      to: c.date,
      balance: c.balance ?? 0,
      expected: c.expected ?? 0,
      amount: r2(c.discrepancy ?? 0),
    }))

  // The residual is what survived every named explanation. It has no date and nothing to link to,
  // so it is always last regardless of size — a row the user can act on outranks one they cannot.
  if (Math.abs(attribution.other) >= 0.5) {
    rows.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
    rows.push({
      key: 'residual',
      kind: 'residual',
      date: null,
      from: attribution.from,
      to: attribution.to,
      balance: null,
      expected: null,
      amount: attribution.other,
    })
    return rows
  }

  return rows.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
}

/**
 * How many real places money sits: chequing, each savings account, each investment account type.
 *
 * The header quotes this, so it has to mean something concrete rather than counting rows in a
 * table. Account TYPE, not holding — sixteen tickers in one TFSA is one account, and calling it
 * sixteen would tell the reader they have a portfolio they do not have.
 */
export function accountCount({ cash = 0, savingsAccounts = [], holdings = [] }) {
  return (cash !== 0 ? 1 : 0)
    + savingsAccounts.length
    + new Set(holdings.map(accountTypeOf)).size
}

/**
 * Rows the waterfall could not include: dated after the balance it closed on, but still inside the
 * range that was asked for.
 *
 * The two boundaries differ whenever the ledger runs past the newest recorded balance — ask for a
 * range ending Jul 13 and the nearest balance at or before it might be Jul 9. Those rows are real
 * and will land in the next reading, which is why the card says so rather than letting Finances
 * quietly report a larger total for what looks like the same period.
 */
export function trailingRowCount(bankRows = [], attribution = null, range = null) {
  if (!attribution?.to || !range?.to) return 0
  return bankRows.filter(t => t.date && t.date > attribution.to && t.date <= range.to).length
}

// A figure has drifted once it would round differently on screen. Sub-dollar movement is live
// prices ticking, which is not a reason to tell someone their analysis is out of date.
const DRIFT_DOLLARS = 1

/**
 * Why a stored insight record no longer describes what is on screen, or null when it still does.
 *
 * A generation is a SNAPSHOT — it is written once and never recomputes. That is deliberate: a
 * follow-up question has to be answerable against the same numbers the user read. But it means a
 * record goes stale two different ways, and only one of them used to be surfaced:
 *
 *   'scope' — the period chip moved. Cheap to detect, and always was.
 *   'data'  — the underlying data changed beneath it. Editing a transaction or reconciling a
 *             balance updates every card instantly, because they are live, while the panel below
 *             goes on quoting figures that now contradict them. Two numbers disagreeing on one
 *             screen is precisely what the deterministic triad exists to prevent, so silence here
 *             is worse than a stale badge.
 *
 * Compared against the record's own stored `kpis` and `attribution` rather than a fingerprint of
 * the inputs: what matters is whether a number the user can SEE has moved, not whether some row
 * they will never look at was re-categorised.
 */
export function staleInsightReason({ record = null, scopeKey = null, kpis = null, attribution = null }) {
  if (!record?.headline) return null
  if (record.period !== scopeKey) return 'scope'
  const drifted = (before, after) => Math.abs((before ?? 0) - (after ?? 0)) >= DRIFT_DOLLARS
  if (kpis && drifted(record.kpis?.liquid, kpis.liquid)) return 'data'
  if (attribution && (
    drifted(record.attribution?.change, attribution.change)
    || drifted(record.attribution?.unexplained, attribution.unexplained)
    || drifted(record.attribution?.moneyOut, attribution.moneyOut)
  )) return 'data'
  return null
}

/**
 * What the ledger says the chequing balance should be on `date`, counting rows not yet imported.
 *
 * The client-side twin of `cashAsOf`, and it exists for exactly one screen: import review, where
 * the rows in question are still on their way in. Measuring from the previous statement close —
 * the last moment the bank and the ledger agreed — is what makes the answer a check on THIS
 * import rather than on every import ever.
 *
 * Returns null when there is nothing to measure from. A discrepancy against an unknown starting
 * point would be invented, and inventing one on the screen where a user decides what to keep is
 * worse than staying quiet.
 */
export function expectedBalanceAt({ opening = null, statementBalances = [], bankRows = [], incomingRows = [] }, date) {
  if (!date) return null
  const previous = [...statementBalances]
    .filter(b => b?.date && b.date < date && Number.isFinite(Number(b.balance)))
    .sort((x, y) => x.date.localeCompare(y.date))
    .pop()
  const anchor = previous
    ? { date: previous.date, balance: Number(previous.balance) }
    : (opening?.date && Number.isFinite(opening.amount) ? { date: opening.date, balance: opening.amount } : null)
  if (!anchor) return null

  const between = rows => rows
    .filter(t => t?.date && t.date > anchor.date && t.date <= date)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0)

  return {
    from: anchor.date,
    expected: r2(anchor.balance + between(bankRows) + between(incomingRows)),
  }
}

/**
 * Today's composition, one row per real account bucket.
 *
 * Each row carries the `bucket` it rolls up into, so clicking a slice can highlight the matching
 * band on the trend — the trend only has three bands, and every investment account type maps to
 * `portfolio`.
 */
export function buildComposition({
  cash = 0, savings = 0, holdings = [], prices = {},
  displayCurrency = 'CAD', usdCad = null,
} = {}) {
  const rows = [
    { key: 'cash', name: 'Cash', bucket: 'cash', value: Math.max(0, r2(cash)) },
    { key: 'savings', name: 'Savings', bucket: 'savings', value: r2(savings) },
    ...Object.entries(holdingsByAccountType(holdings, prices, { displayCurrency, usdCad }))
      .map(([type, value]) => ({
        key: `portfolio:${type}`, name: type, bucket: 'portfolio', value,
      })),
  ].filter(r => r.value > 0)

  const total = r2(rows.reduce((s, r) => s + r.value, 0))
  return rows.map(r => ({ ...r, pct: total > 0 ? Math.round((r.value / total) * 100) : 0 }))
}

/**
 * The most recent complete calendar months in the bank ledger, newest first.
 *
 * The month containing the latest transaction is excluded: a statement lands mid-month, so
 * averaging it in reads as a collapse in spending rather than as a partial import. Same reasoning
 * as `fullMonthsWithData` in server/spendAnalysis.js.
 */
export function completeMonths(bankRows = [], limit = 6) {
  const dated = bankRows.filter(t => t.date)
  if (!dated.length) return []
  const latestMonth = dated.reduce((max, t) => (t.date > max ? t.date : max), dated[0].date).slice(0, 7)
  const months = [...new Set(dated.map(t => t.date.slice(0, 7)))]
    .filter(m => m < latestMonth)
    .sort()
    .reverse()
  return months.slice(0, limit)
}

/** Average monthly spend across complete months, or null when there is not one yet. */
export function averageMonthlySpend(bankRows = [], limit = 6) {
  const months = completeMonths(bankRows, limit)
  if (!months.length) return null
  const set = new Set(months)
  const total = bankRows
    .filter(t => t.date && set.has(t.date.slice(0, 7)) && isBankExpense(t))
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  return total > 0 ? r2(total / months.length) : null
}

/** How many months of ordinary spending the cash balance covers. Null when spend is unknown. */
export function monthsOfSpend(bankRows = [], cash = 0) {
  const avg = averageMonthlySpend(bankRows)
  if (!avg) return null
  return Math.round((cash / avg) * 10) / 10
}

/**
 * How fast a goal is actually being funded, per month.
 *
 * Derived from the ledger wherever possible: allocation rows carry their destination
 * (`linkedSavingsAccountId` for Savings, `linkedHoldingAccountType` for Investments) and a goal's
 * `links[]` name those same destinations with a percentage, so contributions can be attributed
 * properly rather than guessed from the overall savings rate.
 *
 * Falls back to the user's stated `monthlySavings` when nothing is attributable — a brand-new
 * goal has a plan but no history, and showing "no pace" there would be less useful than showing
 * the plan. `source` says which, so the UI can label it.
 */
export function goalPace(goal, bankRows = [], limit = 6) {
  const months = completeMonths(bankRows, limit)
  const plan = goal?.monthlySavings > 0
    ? { perMonth: r2(goal.monthlySavings), source: 'plan', months: 0 }
    : { perMonth: null, source: 'none', months: 0 }

  if (!months.length || !goal?.links?.length) return plan
  const set = new Set(months)
  const rows = bankRows.filter(t => t.date && set.has(t.date.slice(0, 7)))

  let contributed = 0
  for (const link of goal.links) {
    const pct = (link.percent ?? 100) / 100
    if (link.sourceType === 'savings') {
      contributed += pct * rows
        .filter(t => isSavingsTransfer(t) && t.linkedSavingsAccountId === link.sourceId)
        .reduce((s, t) => s + Math.abs(t.amount), 0)
    } else if (link.sourceType === 'holdingsAccountType') {
      contributed += pct * rows
        .filter(t => isInvestmentTransfer(t) && t.linkedHoldingAccountType === link.sourceId)
        .reduce((s, t) => s + Math.abs(t.amount), 0)
    }
    // A 'cash' link earmarks a slice of the checking balance. Cash is not contributed TO, so it
    // adds nothing to pace — counting it would double-count money already sitting in the goal.
  }

  if (contributed <= 0) return plan
  return { perMonth: r2(contributed / months.length), source: 'derived', months: months.length }
}

/**
 * Progress and projected completion for one goal.
 *
 * `eta` is when the goal lands at its current pace, which is the number worth showing — the
 * target date is a wish, the ETA is a forecast. `slipMonths` compares the two so the UI can say
 * an emergency fund lands two months late without recomputing anything.
 *
 * `asOf` exists so the server triad can call this: `server/dashboardAnalysis.js` must be a pure
 * function of its inputs, and an ETA counted from an ambient clock is not.
 */
export function goalProgress(goal, bankRows = [], limit = 6, asOf = null) {
  const target = goal?.targetAmount ?? 0
  const current = goal?.currentAmount ?? 0
  const remaining = Math.max(0, r2(target - current))
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  const pace = goalPace(goal, bankRows, limit)

  let eta = null
  let monthsToGo = null
  if (remaining <= 0) {
    eta = null
  } else if (pace.perMonth > 0) {
    monthsToGo = Math.ceil(remaining / pace.perMonth)
    eta = dayjs(asOf ?? undefined).add(monthsToGo, 'month').format('YYYY-MM-DD')
  }

  const slipMonths = eta && goal?.targetDate ? dayjs(eta).diff(dayjs(goal.targetDate), 'month') : null

  return { pct, remaining, reached: remaining <= 0, pace, eta, monthsToGo, slipMonths }
}
