// Reconciling an account statement against what the app already stores.
//
// **A statement is a snapshot, not a set of purchases.** It says "you hold 40 NVDA today", not
// "you bought 40 NVDA". Importing one as purchase lots the way `+ Add Holding` does would double
// every position the second time a monthly statement is uploaded, and there is nothing in the data
// afterwards that could tell the duplicate apart from a genuine second buy.
//
// So an import reconciles: the named account is made to match the statement, position by position,
// and re-running the same statement changes nothing.
//
// Pure, and imported by BOTH the review modal and the server route — the plan the user approves and
// the write that follows come out of the same function, so they cannot disagree. Same arrangement
// as `budgetModel.js` ↔ `budgetAnalysis.js`.

import { accountTypeOf } from './investmentsModel.js'
import { normalizeListing, listingFromAccountType } from './listing.js'
import { normalizeCurrency, quoteCurrencyOf } from './displayCurrency.js'

const r2 = n => Math.round(n * 100) / 100
const r4 = n => Math.round(n * 10000) / 10000

// Money agrees to the cent; shares to a fraction no brokerage reports.
const moneySame = (a, b) => Math.abs(a - b) < 0.005
const sharesSame = (a, b) => Math.abs(a - b) < 1e-6

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Clean what the vision pass returned into something reconcilable.
 *
 * A null `costBasis` survives normalization on purpose: it means the statement did not print a book
 * value, and the review step has to ask. Filling it in here from `marketValue` would record a
 * fabricated zero gain, which the Dashboard's saved-versus-markets split would then inherit.
 */
export function normalizePositions(raw = [], {
  defaultListing = null,
  defaultCostCurrency = null,
} = {}) {
  const fallback = normalizeListing(defaultListing)
  const costFallback = normalizeCurrency(defaultCostCurrency)
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    const ticker = String(entry?.ticker ?? '').trim().toUpperCase()
    const shares = num(entry?.shares)
    if (!ticker || shares === null || shares <= 0) continue
    if (seen.has(ticker)) continue
    seen.add(ticker)
    const costBasis = num(entry?.costBasis)
    const listing = normalizeListing(entry?.listing) || fallback
    out.push({
      ticker,
      name: String(entry?.name ?? '').trim(),
      shares: r4(shares),
      marketValue: num(entry?.marketValue),
      costBasis: costBasis === null || costBasis < 0 ? null : r2(costBasis),
      // Per-row listing from the section/currency the statement printed; else the statement default.
      listing,
      costCurrency: normalizeCurrency(entry?.costCurrency)
        || costFallback
        || quoteCurrencyOf(listing)
        || null,
    })
  }
  return out
}

/** The earliest lot date on a stored holding, or its own date for a pre-lots record. */
function earliestLotDate(holding) {
  const dates = (holding?.purchases ?? [])
    .map(p => p?.purchaseDate)
    .filter(Boolean)
  if (!dates.length) return holding?.purchaseDate || null
  return dates.sort()[0]
}

/**
 * What committing this statement would do to the named account.
 *
 * The scope is exactly `accountType`: holdings under any other type are never read and never
 * written, which is what makes naming the account in the review step load-bearing rather than
 * cosmetic. A statement for one account cannot disturb another.
 */
export function reconcileHoldings({ holdings = [], accountType, statementDate = null, positions = [] } = {}) {
  const type = String(accountType ?? '').trim()
  if (!type) throw new Error('An account type is required to reconcile a statement')

  const inScope = holdings.filter(h => accountTypeOf(h) === type)
  const byTicker = new Map(inScope.map(h => [String(h.ticker || '').toUpperCase(), h]))
  const matched = new Set()
  const rows = []

  for (const position of positions) {
    const existing = byTicker.get(position.ticker) ?? null
    if (existing) matched.add(position.ticker)

    const prevShares = existing ? Number(existing.shares) || 0 : null
    const prevCostBasis = existing ? r2((Number(existing.purchasePrice) || 0) * prevShares) : null
    const costBasis = position.costBasis
    const needsCostBasis = costBasis === null
    // Only an explicit listing from the statement can change a stored one. Inferring CA from
    // "FHSA" on every re-import would rewrite unchanged rows forever.
    const positionListing = normalizeListing(position.listing)
    const existingListing = normalizeListing(existing?.listing)
    const listing = positionListing || existingListing || listingFromAccountType(type) || null
    const listingChanged = !!existing && !!positionListing && positionListing !== existingListing
    const positionCostCurrency = normalizeCurrency(position.costCurrency)
    const existingCostCurrency = normalizeCurrency(existing?.costCurrency)
    const costCurrency = positionCostCurrency
      || existingCostCurrency
      || quoteCurrencyOf(listing)
      || null
    const costCurrencyChanged = !!existing && !!positionCostCurrency
      && positionCostCurrency !== existingCostCurrency

    let action
    if (!existing) action = 'add'
    else if (!sharesSame(prevShares, position.shares)) action = 'update'
    else if (listingChanged || costCurrencyChanged) action = 'update'
    else if (needsCostBasis) action = 'unchanged'
    else action = moneySame(prevCostBasis, costBasis) ? 'unchanged' : 'update'

    rows.push({
      ticker: position.ticker,
      name: position.name,
      accountType: type,
      listing,
      costCurrency,
      action,
      shares: position.shares,
      prevShares,
      marketValue: position.marketValue,
      costBasis,
      prevCostBasis,
      avgCost: costBasis === null ? null : r4(costBasis / position.shares),
      needsCostBasis,
      holdingId: existing?.id ?? null,
      // A position the app already knows keeps the date it has always had. `holdingLotsAsOf()` in
      // server/netWorthHistory.js includes a lot only when `purchaseDate <= asOf`, so re-dating an
      // existing position to the statement date would delete it from every history point before
      // that date — the holding would look as though it were bought last month.
      purchaseDate: (existing && earliestLotDate(existing)) || statementDate,
    })
  }

  // Anything stored under this account that the statement does not list. A proposal, not a verdict:
  // one statement may not cover the whole account, so the review step can untick it.
  for (const holding of inScope) {
    const ticker = String(holding.ticker || '').toUpperCase()
    if (matched.has(ticker)) continue
    const shares = Number(holding.shares) || 0
    rows.push({
      ticker,
      name: '',
      accountType: type,
      listing: normalizeListing(holding.listing),
      costCurrency: normalizeCurrency(holding.costCurrency),
      action: 'remove',
      shares: 0,
      prevShares: shares,
      marketValue: null,
      costBasis: null,
      prevCostBasis: r2((Number(holding.purchasePrice) || 0) * shares),
      avgCost: null,
      needsCostBasis: false,
      holdingId: holding.id,
      purchaseDate: earliestLotDate(holding),
    })
  }

  const counts = { added: 0, updated: 0, unchanged: 0, removed: 0 }
  for (const row of rows) {
    if (row.action === 'add') counts.added++
    else if (row.action === 'update') counts.updated++
    else if (row.action === 'unchanged') counts.unchanged++
    else counts.removed++
  }

  return { accountType: type, statementDate, rows, counts }
}

/**
 * Apply an approved plan, returning the next holdings array and the lot ids it wrote.
 *
 * A position collapses to ONE lot at its average cost. The statement reports a position, not the
 * trades behind it, so inventing a lot per trade would be fiction — and the app's own
 * `recalculateHoldingTotals` derives exactly this average from a lot list anyway.
 *
 * The missing-cost check is an invariant, not a UI courtesy: the review modal disables its button,
 * and this throws even if something else calls it. Neither alone is enough to keep a fabricated
 * zero gain out of the ledger.
 */
export function applyReconcile(holdings = [], rows = [], { newId } = {}) {
  if (typeof newId !== 'function') throw new Error('applyReconcile needs a newId factory')

  const writes = rows.filter(r => r.action === 'add' || r.action === 'update')
  for (const row of writes) {
    if (row.costBasis === null || row.costBasis === undefined) {
      throw new Error(`${row.ticker} has no cost basis — confirm one before importing`)
    }
    if (!(row.shares > 0)) {
      throw new Error(`${row.ticker} has no share count`)
    }
    if (!row.purchaseDate) {
      throw new Error(`${row.ticker} has no date to record the position under`)
    }
  }

  const removeIds = new Set(rows.filter(r => r.action === 'remove').map(r => r.holdingId))
  const updates = new Map(writes.filter(r => r.holdingId).map(r => [r.holdingId, r]))
  const purchaseIds = []

  const next = []
  for (const holding of holdings) {
    if (removeIds.has(holding.id)) continue
    const row = updates.get(holding.id)
    if (!row) {
      next.push(holding)
      continue
    }
    const lotId = newId()
    purchaseIds.push(lotId)
    next.push({
      ...holding,
      ticker: row.ticker,
      shares: row.shares,
      purchasePrice: row.avgCost,
      purchaseDate: row.purchaseDate,
      accountType: row.accountType,
      listing: row.listing || holding.listing || null,
      costCurrency: row.costCurrency || holding.costCurrency || null,
      purchases: [{ id: lotId, shares: row.shares, purchasePrice: row.avgCost, purchaseDate: row.purchaseDate }],
    })
  }

  for (const row of writes) {
    if (row.holdingId) continue
    const lotId = newId()
    purchaseIds.push(lotId)
    next.push({
      id: newId(),
      ticker: row.ticker,
      shares: row.shares,
      purchasePrice: row.avgCost,
      purchaseDate: row.purchaseDate,
      accountType: row.accountType,
      listing: row.listing || null,
      costCurrency: row.costCurrency || null,
      purchases: [{ id: lotId, shares: row.shares, purchasePrice: row.avgCost, purchaseDate: row.purchaseDate }],
    })
  }

  return { holdings: next, purchaseIds }
}

// ── Savings accounts ────────────────────────────────────────────────────────────────────────────

const nameKey = value => String(value ?? '').trim().toLowerCase()

export function normalizeSavings(raw = []) {
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    const name = String(entry?.name ?? '').trim()
    const balance = num(entry?.balance)
    if (!name || balance === null || balance < 0) continue
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    const apy = num(entry?.apy)
    out.push({
      name,
      accountType: String(entry?.accountType ?? '').trim() || 'Regular Savings',
      balance: r2(balance),
      // A statement that does not print a rate leaves this null rather than guessing zero, which
      // would silently wipe a rate the user had already entered.
      apy: apy === null || apy < 0 ? null : r2(apy),
    })
  }
  return out
}

/**
 * Match parsed accounts to stored ones by name, case- and whitespace-insensitively.
 *
 * Savings accounts have no external identifier the statement and the app both know, so the name is
 * the only join available. Unlike holdings, an account the statement omits is left completely
 * alone — a savings statement covers one account, so "not mentioned" carries no information.
 */
export function reconcileSavings({ accounts = [], parsed = [] } = {}) {
  const byName = new Map(accounts.map(a => [nameKey(a.name), a]))
  const rows = parsed.map(entry => {
    const existing = byName.get(nameKey(entry.name)) ?? null
    // A missing rate means "the statement didn't say", so the stored rate stands.
    const apy = entry.apy === null ? (existing ? Number(existing.apy) || 0 : 0) : entry.apy
    const sameBalance = existing && moneySame(Number(existing.balance) || 0, entry.balance)
    const sameApy = existing && moneySame(Number(existing.apy) || 0, apy)
    return {
      ...entry,
      apy,
      apyFromStatement: entry.apy !== null,
      action: !existing ? 'add' : (sameBalance && sameApy ? 'unchanged' : 'update'),
      accountId: existing?.id ?? null,
      prevBalance: existing ? r2(Number(existing.balance) || 0) : null,
      prevApy: existing ? r2(Number(existing.apy) || 0) : null,
      accountType: existing && !entry.accountType ? existing.accountType : entry.accountType,
    }
  })

  const counts = { added: 0, updated: 0, unchanged: 0 }
  for (const row of rows) counts[row.action === 'add' ? 'added' : row.action === 'update' ? 'updated' : 'unchanged']++

  return { rows, counts }
}

export function applySavingsReconcile(accounts = [], rows = [], { newId } = {}) {
  if (typeof newId !== 'function') throw new Error('applySavingsReconcile needs a newId factory')

  const updates = new Map(rows.filter(r => r.action === 'update' && r.accountId).map(r => [r.accountId, r]))
  const createdIds = []

  const next = accounts.map(account => {
    const row = updates.get(account.id)
    if (!row) return account
    return { ...account, name: row.name, accountType: row.accountType, balance: row.balance, apy: row.apy }
  })

  for (const row of rows) {
    if (row.action !== 'add') continue
    const id = newId()
    createdIds.push(id)
    next.push({ id, name: row.name, accountType: row.accountType, balance: row.balance, apy: row.apy })
  }

  return { accounts: next, createdIds }
}
