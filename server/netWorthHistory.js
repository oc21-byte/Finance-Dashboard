// Liquid net worth history — the derivation behind the Dashboard's trend chart and its
// change-attribution waterfall. Pure functions only; the routes in `index.js` supply the db and
// the price maps.
//
// WHY THIS FILE EXISTS
//
// The waterfall claims to split a change in liquid net worth into "what you saved" and "what the
// markets did". That claim is only honest if history stores enough to separate the two, and the
// original inline version did not:
//
//   - portfolio was stored at COST BASIS while the KPI card showed live prices, so the newest
//     history point never matched the number above it;
//   - savings was frozen at today's balance for every backfilled month, so a savings deposit made
//     a year ago looked like it had always been there;
//   - cash was reconstructed backwards from the manually-typed `settings.cashBalance`.
//
// The fix is one extra stored field. Keeping BOTH the market value and the cost basis at each
// point makes the split arithmetic rather than guesswork:
//
//   Δportfolio     = ΔportfolioCost  +  Δ(market − cost)
//                    └ contributions    └ market return
//
// Everything the waterfall needs falls out of that identity. Nothing has to infer a contribution
// from a price move, and no residual gets silently relabelled as investment performance.
//
// HOW CASH IS DERIVED
//
// `cashBalance` is the chequing account, the same account the imported statements describe — so
// the statements, not a typed number, are the authority on it. Cash is anchored to the newest
// STATEMENT closing balance at or before the date being asked about:
//
//   cash(d) = closingBalance(newest statement ≤ d) + Σ bank rows since that statement
//
// Cash is therefore not editable anywhere in the app. There is no field for it, because there is
// no answer a user could type that the bank has not already issued. What they supply instead is
// the closing balance printed on each statement, and the ledger does the rest.
//
// Two earlier designs failed here, and both failures are the reason for this one:
//
//   - Reconstructing backwards from today's typed balance made ALL of history a function of the
//     current value; entering a correction silently moved the past.
//   - Storing a typed balance as a dated adjustment fixed that, but froze the discrepancy at the
//     moment it was typed. Correcting the ledger afterwards could not recompute it, so a $5,361
//     phantom outlived the missing transaction that caused it.
//
// Nothing is frozen now. `statementChecks` derives every discrepancy on read, so fixing a row
// fixes the report of it.
// Reconciling against the real ledger showed why that mattered: bidirectional errors of thousands
// and one $32,000 typo, against an import pipeline with zero uncategorised rows, zero duplicates
// and no coverage gaps. The ledger was the trustworthy half all along.
//
// Cash is anchored to STATEMENT closing balances — figures the bank itself issued — and is never
// typed. Everything at or before an anchor is fact; only the stretch after the newest statement is
// derived, from rows the user added by hand. `statementChecks` compares each anchor against what
// the ledger predicted from the one before it, which is the app's only external proof that an
// import was complete.

import { isSavingsTransfer } from '../src/constants/financeRules.js'
import { resolveListing } from '../src/utils/listing.js'
import {
  normalizeCurrency, quoteCurrencyOf, costCurrencyOf, toDisplay,
} from '../src/utils/displayCurrency.js'

// Bump when the stored shape changes in a way that requires recomputation. `settings
// .netWorthHistoryVersion` is compared against this to decide whether to rebuild once on load.
//
//   2 — market/cost split, real savings reconstruction
//   3 — cash anchored to dated observations instead of back-projected from today
//   4 — cash derived forward from an opening balance; typed balances become reconciliations
//   5 — cash anchored to bank-issued statement closing balances; discrepancies derived, not stored
export const HISTORY_VERSION = 5

const r2 = n => Math.round((n ?? 0) * 100) / 100

/**
 * How much of the stored portfolio figure is a real market valuation.
 *
 *   'market'  every holding was priced — market-return math is trustworthy
 *   'partial' some tickers could not be priced; their lots fell back to cost
 *   'cost'    nothing was priced (offline, or no holdings) — market return reads as 0, which is
 *             an absence of data rather than a flat month. Callers must not present it as a
 *             return of zero.
 */
function basisOf(pricedCount, unpricedCount) {
  if (pricedCount === 0) return 'cost'
  return unpricedCount === 0 ? 'market' : 'partial'
}

/**
 * Every lot of a holding that existed on or before `asOf`.
 *
 * A holding either carries a `purchases[]` lot list (the normal case once it has been added to
 * more than once) or is a single implicit lot. Both shapes are live in db.json, so both are
 * handled here rather than at each call site.
 */
function lotsAsOf(holding, asOf) {
  if (holding?.purchases?.length) {
    return holding.purchases
      .filter(p => !asOf || (p.purchaseDate ?? '') <= asOf)
      .map(p => ({ shares: p.shares ?? 0, purchasePrice: p.purchasePrice ?? 0 }))
  }
  if (asOf && (holding?.purchaseDate ?? '') > asOf) return []
  return [{ shares: holding?.shares ?? 0, purchasePrice: holding?.purchasePrice ?? 0 }]
}

/**
 * Value every holding as it stood on `asOf`, at market and at cost.
 *
 * @param priceOf (ticker, yyyymm, listing?) => number|null — native quote in the listing currency.
 * @param opts.displayCurrency home currency for the returned totals
 * @param opts.usdCad CAD per USD; required when converting across currencies
 * @returns {{ market, cost, basis }}
 */
export function valueHoldingsAsOf(
  holdings = [],
  asOf = null,
  priceOf = () => null,
  { displayCurrency = 'CAD', usdCad = null } = {},
) {
  const home = normalizeCurrency(displayCurrency) || 'CAD'
  const yyyymm = asOf ? asOf.slice(0, 7) : null
  let market = 0
  let cost = 0
  let priced = 0
  let unpriced = 0

  for (const h of holdings) {
    const lots = lotsAsOf(h, asOf)
    if (!lots.length) continue
    const shares = lots.reduce((s, l) => s + l.shares, 0)
    const lotCost = lots.reduce((s, l) => s + l.shares * l.purchasePrice, 0)
    if (shares === 0 && lotCost === 0) continue

    const listing = resolveListing(h)
    const quoteCurrency = quoteCurrencyOf(listing) || home
    const costCurrency = costCurrencyOf(h, { displayCurrency: home })
    const costDisp = toDisplay(lotCost, costCurrency, home, usdCad)
    const costInHome = costDisp !== null ? costDisp : lotCost
    cost += costInHome

    const nativePrice = h?.ticker
      ? priceOf(h.ticker.toUpperCase(), yyyymm, listing)
      : null
    const priceDisp = (nativePrice !== null && nativePrice !== undefined && Number.isFinite(nativePrice))
      ? toDisplay(nativePrice, quoteCurrency, home, usdCad)
      : null

    if (priceDisp !== null) {
      market += priceDisp * shares
      priced++
    } else {
      // No convertible price: stand in with cost in home currency (zero market return).
      market += costInHome
      unpriced++
    }
  }

  return { market: r2(market), cost: r2(cost), basis: basisOf(priced, unpriced) }
}

/** The last date the bank ledger covers. Nothing after it is known from statements. */
export function ledgerCoverageEnd(bankRows = []) {
  let max = null
  for (const t of bankRows) if (t.date && (!max || t.date > max)) max = t.date
  return max
}

/** Statement balances, oldest first, with anything malformed dropped at the door. */
export function sortedBalances(statementBalances = []) {
  return statementBalances
    .filter(b => b?.date && Number.isFinite(Number(b.balance)))
    .map(b => ({ ...b, balance: r2(Number(b.balance)) }))
    .sort((x, y) => x.date.localeCompare(y.date))
}

/** The newest statement balance at or before `date`, or null. */
function anchorAt(balances, date) {
  let found = null
  for (const b of balances) if (b.date <= date && (!found || b.date > found.date)) found = b
  return found
}

/**
 * Cash as it stood on `asOf`.
 *
 * Anchored to the newest STATEMENT closing balance at or before that date, plus every bank row
 * since. A statement balance is what the bank itself says the account held on that day, so
 * everything at or before an anchor is fact rather than reconstruction, and only the stretch after
 * the last statement is derived — from rows the user entered by hand, which is exactly the part
 * they can be expected to know about.
 *
 * This is why cash is not typeable anywhere. The old design took a typed balance and stored the
 * gap it implied as a frozen `adjustment`; when the ledger was later corrected, that stored figure
 * could not be recomputed and went on reporting a discrepancy that no longer existed. Nothing is
 * frozen here — fix a row and every figure downstream of it moves.
 *
 * Falls back to `opening` before the first statement, and is not clamped at zero: a negative
 * result means rows are missing, which should be visible rather than quietly floored.
 */
export function cashAsOf({ opening, statementBalances = [], bankRows = [] }, asOf) {
  const anchor = anchorAt(sortedBalances(statementBalances), asOf)
    ?? (opening?.date && Number.isFinite(opening.amount)
      ? { date: opening.date, balance: opening.amount }
      : null)
  if (!anchor) return 0
  const flows = bankRows
    .filter(t => t.date && t.date > anchor.date && t.date <= asOf)
    .reduce((s, t) => s + (t.amount ?? 0), 0)
  return r2(anchor.balance + flows)
}

/**
 * Each statement balance against what the ledger predicted for it.
 *
 * `expected` runs from the PREVIOUS anchor — the last moment the bank and the ledger agreed — so a
 * discrepancy is bounded by two real balances and names exactly which statement's import is short.
 * That is the check worth having: it fires at the boundary where the evidence is, not months later
 * as an unattributable lump.
 *
 * Derived on every read, never stored. Correct a transaction and these recompute; that property is
 * the whole point, and its absence is what let a $5,361 phantom survive a fixed ledger.
 */
export function statementChecks({ opening, statementBalances = [], bankRows = [] }) {
  const balances = sortedBalances(statementBalances)
  const coverageEnd = ledgerCoverageEnd(bankRows)
  let previous = opening?.date && Number.isFinite(opening.amount)
    ? { date: opening.date, balance: opening.amount }
    : null

  return balances.map(entry => {
    const flows = previous
      ? bankRows
        .filter(t => t.date && t.date > previous.date && t.date <= entry.date)
        .reduce((s, t) => s + (t.amount ?? 0), 0)
      : 0
    // With nothing earlier to measure from, the first balance defines the anchor rather than
    // failing it. Claiming a discrepancy against an unknown starting point would be invented.
    const expected = previous ? r2(previous.balance + flows) : entry.balance
    const check = {
      date: entry.date,
      balance: entry.balance,
      expected,
      discrepancy: r2(entry.balance - expected),
      from: previous?.date ?? null,
      // A balance for a date the ledger does not reach means the statement's rows were never
      // imported — a different errand from a short import, so it is labelled rather than counted.
      beyondLedger: !!coverageEnd && entry.date > coverageEnd,
    }
    previous = entry
    return check
  })
}

/**
 * Back-derive an opening balance from a known balance on a later date.
 *
 * Used once, at migration: the ledger predates the first time a balance was ever recorded, so the
 * only way to anchor those early months is to run the known figure backwards through the rows.
 * Assumes the ledger is complete over that stretch — which is why the result is stored with
 * `estimated: true` rather than presented as fact.
 */
export function deriveOpeningBalance(bankRows = [], knownDate, knownBalance, openingDate) {
  const between = bankRows
    .filter(t => t.date && t.date > openingDate && t.date <= knownDate)
    .reduce((s, t) => s + (t.amount ?? 0), 0)
  return { date: openingDate, amount: r2(knownBalance - between), estimated: true }
}

/**
 * Savings as it stood on `asOf`, walked backwards from today's total.
 *
 * Savings transfers are negative bank rows (money leaving checking), so a transfer after `asOf`
 * means savings was that much LOWER back then. Note this is the mirror of `cashAsOf`: the same
 * row raises historical cash and lowers historical savings, which is exactly right — an
 * allocation moves money between buckets and leaves liquid net worth unchanged. That symmetry is
 * what keeps a transfer from showing up in the waterfall as if it were income.
 *
 * Uses `isSavingsTransfer` from the shared bank-flow contract; do not re-derive the predicate.
 */
export function savingsAsOf(currentSavings, bankRows = [], asOf) {
  const depositedAfter = bankRows
    .filter(t => t.date && t.date > asOf && isSavingsTransfer(t))
    .reduce((s, t) => s + Math.abs(t.amount ?? 0), 0)
  return r2((currentSavings ?? 0) - depositedAfter)
}

/** Assemble one stored history entry. The `breakdown` keys are load-bearing — the chart reads them. */
export function buildEntry({ date, cash, savings, market, cost, basis }) {
  return {
    date,
    netWorth: r2(cash + savings + market),
    breakdown: { cash: r2(cash), savings: r2(savings), portfolio: r2(market) },
    portfolioCost: r2(cost),
    basis,
  }
}

/** Last calendar day of each month from `earliest` to `today`, with the final one capped at today. */
export function monthEndDates(earliest, today) {
  if (!earliest || !today) return []
  const dates = []
  let year = Number(earliest.slice(0, 4))
  let month = Number(earliest.slice(5, 7))
  const [ty, tm] = today.split('-').map(Number)

  while (year < ty || (year === ty && month <= tm)) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    const daysInMonth = new Date(year, month, 0).getDate()
    const last = `${ym}-${String(daysInMonth).padStart(2, '0')}`
    dates.push(last > today ? today : last)
    month++
    if (month > 12) { month = 1; year++ }
  }
  return dates
}

/**
 * Recompute the whole history from today's balances outwards. Idempotent: same inputs, same
 * output, so it is safe to re-run on every version bump.
 *
 * `keepDates` carries forward the dates already present in the stored history. Their VALUES are
 * recomputed — the old ones came from the cost-basis/frozen-savings logic — but keeping the dates
 * preserves the daily granularity that the 30-day delta and the KPI sparkline need. Without it a
 * rebuild would flatten history to one point per month.
 */
export function rebuildHistory({
  transactions = [],
  holdings = [],
  savingsAccounts = [],
  opening = null,
  statementBalances = [],
  today,
  keepDates = [],
  priceOf = () => null,
  displayCurrency = 'CAD',
  usdCad = null,
}) {
  const dated = transactions.filter(t => t.date)
  const earliest = dated.length ? dated.map(t => t.date).sort()[0] : today
  const currentSavings = savingsAccounts.reduce((s, a) => s + (a.balance ?? 0), 0)
  const cashSources = { opening, statementBalances, bankRows: dated }
  const fxOpts = { displayCurrency, usdCad }

  const dates = [...new Set([
    ...monthEndDates(earliest, today),
    ...keepDates.filter(d => d && d <= today),
    // Every statement close gets its own point, so an anchor reads as the step it was rather than
    // being smeared across the month it landed in.
    ...sortedBalances(statementBalances).map(b => b.date).filter(d => d <= today),
    today,
  ])].sort()

  return dates.map(date => {
    const { market, cost, basis } = valueHoldingsAsOf(holdings, date, priceOf, fxOpts)
    return buildEntry({
      date,
      cash: cashAsOf(cashSources, date),
      savings: savingsAsOf(currentSavings, dated, date),
      market,
      cost,
      basis,
    })
  })
}
