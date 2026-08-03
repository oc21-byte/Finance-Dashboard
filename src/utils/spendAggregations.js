import dayjs from 'dayjs'
import { isCredit } from './period.js'

// Every aggregate the Spend Analyzer draws. Two rules hold throughout:
//
// 1. Spend is negatives only. A positive card row is cashback, a refund or a rebate — money coming
//    back, never spending. Callers pass an already-split list; `splitSpend` is the only place that
//    split is made.
// 2. Month buckets come from an explicit `months` list (from `resolvePeriod`), not from the data,
//    so a period with no activity in March still draws March.

export { isCredit }

function round2(n) {
  return Math.round(n * 100) / 100
}

export function monthLabel(yyyymm) {
  return dayjs(yyyymm + '-01').format('MMM YY')
}

/** Absolute total of a list of spend rows. */
export function sumSpend(transactions) {
  return round2(transactions.reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0))
}

export function splitSpend(transactions) {
  const spend = []
  const credits = []
  for (const t of transactions) (isCredit(t) ? credits : spend).push(t)
  return { spend, credits }
}

export function summarizeCredits(transactions) {
  const credits = transactions.filter(isCredit)
  const byKind = {}
  for (const tx of credits) {
    const kind = tx.creditKind || 'credit'
    byKind[kind] = (byKind[kind] || 0) + Number(tx.amount)
  }
  return {
    credits,
    total: round2(credits.reduce((s, t) => s + Number(t.amount), 0)),
    byKind: Object.entries(byKind)
      .map(([kind, amount]) => ({ kind, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
  }
}

/**
 * Per-month totals broken down by an arbitrary key (source or category).
 *
 * @param spendTxs  negatives only
 * @param months    ordered `YYYY-MM` list; defines the buckets
 * @param keyOf     row → series key
 * @returns {{ data: Array<{month,label,total,values}>, keys: string[], totals: object }}
 *   `values` always carries an entry for every key (zero when absent), so stacking and line
 *   drawing never has to guard for holes.
 */
export function buildMonthlyBreakdown(spendTxs, months, keyOf) {
  const byMonth = new Map(months.map(m => [m, []]))
  const keys = []
  const seen = new Set()

  for (const t of spendTxs) {
    const bucket = byMonth.get(t.date?.slice(0, 7))
    if (bucket) bucket.push(t)
    const key = keyOf(t)
    if (key && !seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }

  const totals = Object.fromEntries(keys.map(k => [k, 0]))
  const data = months.map(month => {
    const values = Object.fromEntries(keys.map(k => [k, 0]))
    let total = 0
    for (const t of byMonth.get(month)) {
      const amount = Math.abs(Number(t.amount) || 0)
      const key = keyOf(t)
      if (key in values) {
        values[key] += amount
        totals[key] += amount
      }
      total += amount
    }
    for (const k of keys) values[k] = round2(values[k])
    return { month, label: monthLabel(month), total: round2(total), values }
  })

  for (const k of keys) totals[k] = round2(totals[k])
  return { data, keys, totals }
}

export const categoryOf = t => t.category || 'Other'
export const cardOf = t => t.source || 'Unknown'
export const merchantOf = t => t.description || 'Unknown'

export function buildMonthlyByCategory(spendTxs, months) {
  return buildMonthlyBreakdown(spendTxs, months, categoryOf)
}

export function buildMonthlyByCard(spendTxs, months) {
  return buildMonthlyBreakdown(spendTxs, months, cardOf)
}

export function buildMonthlyTotals(spendTxs, months) {
  return buildMonthlyBreakdown(spendTxs, months, () => 'total').data
}

/**
 * Rank a spend list by a key, with each entry's share of the whole.
 * @returns Array<{ name, amount, visits, share }> sorted by amount, share as a 0–1 fraction.
 */
export function rankBy(spendTxs, keyOf) {
  const amounts = new Map()
  const visits = new Map()
  let total = 0
  for (const t of spendTxs) {
    const key = keyOf(t)
    const amount = Math.abs(Number(t.amount) || 0)
    amounts.set(key, (amounts.get(key) || 0) + amount)
    visits.set(key, (visits.get(key) || 0) + 1)
    total += amount
  }
  return [...amounts.entries()]
    .map(([name, amount]) => ({
      name,
      amount: round2(amount),
      visits: visits.get(name),
      share: total > 0 ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export function buildCategoryTotals(spendTxs) {
  return rankBy(spendTxs, categoryOf)
}

export function buildMerchantTotals(spendTxs) {
  return rankBy(spendTxs, merchantOf)
}

/** Card totals carry an average ticket, which the mockup's Cards legend shows. */
export function buildCardTotals(spendTxs) {
  return rankBy(spendTxs, cardOf).map(c => ({
    ...c,
    avg: c.visits ? round2(c.amount / c.visits) : 0,
  }))
}

/**
 * The KPI strip. `priorSpendTxs` is the same-length preceding window; pass an empty list to omit
 * the delta.
 */
export function buildKpis(spendTxs, range, priorSpendTxs = []) {
  const total = sumSpend(spendTxs)
  const monthCount = Math.max(range?.monthCount ?? 0, 1)
  const categories = buildCategoryTotals(spendTxs)
  const top = categories[0] ?? null
  const priorTotal = sumSpend(priorSpendTxs)

  return {
    total,
    txCount: spendTxs.length,
    avgPerMonth: round2(total / monthCount),
    avgTransaction: spendTxs.length ? round2(total / spendTxs.length) : 0,
    topCategory: top?.name ?? null,
    topCategoryAmount: top?.amount ?? 0,
    topCategoryShare: top?.share ?? 0,
    cardCount: new Set(spendTxs.map(cardOf)).size,
    // Null rather than 0 when there is no prior window to compare against — "0% change" and "no
    // basis for comparison" are different claims.
    changeVsPrior: priorTotal > 0 ? (total - priorTotal) / priorTotal : null,
  }
}

/** Apply the active filter chips. Empty/absent arrays mean "no constraint of this kind". */
export function applyFilters(transactions, filters = {}) {
  const { categories, cards, merchants } = filters
  if (!categories?.length && !cards?.length && !merchants?.length) return transactions
  return transactions.filter(t =>
    (!categories?.length || categories.includes(categoryOf(t))) &&
    (!cards?.length || cards.includes(cardOf(t))) &&
    (!merchants?.length || merchants.includes(merchantOf(t)))
  )
}
