import dayjs from 'dayjs'

// The Spend Analyzer's period is a date *range*, not the single `YYYY-MM` prefix the page used
// before. Ranges are anchored to the latest transaction, never to today: the ledger lags real
// life by a statement cycle, so anchoring to today would open every view on a half-empty
// trailing month.

// One month is the floor on both tabs. Data arrives one statement at a time, so a sub-monthly
// window can only ever show a fragment of whichever cycle happened to land last — it reads as a
// collapse in spending rather than as a partial import. `resolvePeriod` still understands '7D'
// (below) so a scope key stored back when the chip existed still resolves to its real range
// instead of silently widening to All.
export const PERIOD_KEYS = ['1M', '3M', '6M', '1Y', 'YTD', 'All']

// Whole-calendar-month windows. 7D / YTD / All are anchored differently and handled below.
const MONTH_SPANS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }

export function isCredit(tx) {
  return Number(tx.amount) > 0
}

function dateBounds(transactions) {
  let min = null
  let max = null
  for (const t of transactions) {
    const d = t.date
    if (!d) continue
    if (min === null || d < min) min = d
    if (max === null || d > max) max = d
  }
  return { min, max }
}

function monthsBetween(from, to) {
  const months = []
  let cursor = dayjs(from).startOf('month')
  const last = dayjs(to).startOf('month')
  while (cursor.isBefore(last) || cursor.isSame(last)) {
    months.push(cursor.format('YYYY-MM'))
    cursor = cursor.add(1, 'month')
  }
  return months
}

function formatDay(date) {
  return dayjs(date).format('MMM D, YYYY')
}

const EMPTY_RANGE = {
  key: 'All', from: null, to: null, months: [], monthCount: 0, monthAligned: false, label: 'no data',
}

/**
 * Resolve a period chip key into a concrete range.
 *
 * @returns {{key, from, to, months: string[], monthCount, monthAligned, label}}
 *   `from`/`to` are inclusive `YYYY-MM-DD` strings. `months` is every `YYYY-MM` the range touches,
 *   in order — charts bucket off this list rather than off the data, so a 6M view always draws six
 *   bars even when a month has no spend.
 */
export function resolvePeriod(key, transactions = []) {
  const { min, max } = dateBounds(transactions)
  if (!min || !max) return { ...EMPTY_RANGE, key: PERIOD_KEYS.includes(key) ? key : 'All' }

  const latest = dayjs(max)
  let from
  let to = max
  let monthAligned = false

  if (key === '7D') {
    from = latest.subtract(6, 'day').format('YYYY-MM-DD')
  } else if (key === 'YTD') {
    from = latest.startOf('year').format('YYYY-MM-DD')
  } else if (MONTH_SPANS[key]) {
    const anchor = latest.startOf('month')
    from = anchor.subtract(MONTH_SPANS[key] - 1, 'month').format('YYYY-MM-DD')
    to = anchor.endOf('month').format('YYYY-MM-DD')
    monthAligned = true
  } else {
    // 'All' and anything unrecognised.
    from = min
    key = PERIOD_KEYS.includes(key) ? key : 'All'
  }

  // A month-aligned window can reach past the last transaction; never claim data we don't have,
  // and never start before the ledger does.
  if (from < min) from = min
  if (to > max) to = max

  const months = monthsBetween(from, to)
  return {
    key,
    from,
    to,
    months,
    monthCount: months.length,
    monthAligned,
    label: `${formatDay(from)} – ${formatDay(to)}`,
  }
}

/**
 * The window immediately before `range`, same length — the basis for "vs prior 6M" deltas.
 *
 * Returns null when the range is empty, or when `earliestDate` shows the ledger doesn't reach far
 * enough back to cover the whole prior window. A partial window makes the comparison meaningless:
 * with data starting mid-November, the six months "before February" hold ten weeks of records and
 * report a 377% jump that is really just the ledger beginning.
 */
export function priorRange(range, earliestDate = null) {
  if (!range?.from || !range?.to) return null
  const to = dayjs(range.from).subtract(1, 'day')

  const from = range.monthAligned
    ? to.startOf('month').subtract(range.monthCount - 1, 'month')
    : to.subtract(dayjs(range.to).diff(dayjs(range.from), 'day'), 'day')

  const fromStr = from.format('YYYY-MM-DD')
  const toStr = to.format('YYYY-MM-DD')
  if (earliestDate && fromStr < earliestDate) return null

  return { from: fromStr, to: toStr, months: monthsBetween(fromStr, toStr) }
}

/** Earliest transaction date in the ledger, or null. Pair with `priorRange` to gate the delta. */
export function earliestDate(transactions = []) {
  return dateBounds(transactions).min
}

export function inRange(date, range) {
  if (!date || !range?.from || !range?.to) return false
  return date >= range.from && date <= range.to
}

export function filterByRange(transactions, range) {
  if (!range?.from || !range?.to) return []
  return transactions.filter(t => inRange(t.date, range))
}

// --- Scope: range + active filter chips -------------------------------------------------------
//
// A "scope" is everything that narrows the page: the period range plus the category / card /
// merchant chips. The AI routes need it in two forms — a stable key for equality checks, and a
// sentence for display.

// APPEND-ONLY. Scope keys built from these tables are persisted in db.json (spendInsights.period,
// financeInsights.period) and compared by STRING EQUALITY — by `createChatBinding` before a reply
// is appended, and by the insight rails to decide whether what is on screen is stale. Appending a
// key is safe: a scope carrying none of the new kinds emits no new part, so every stored key stays
// byte-identical. REORDERING or renaming a prefix silently strands every existing record — the
// insights go permanently stale and chat replies are refused, with no error anywhere.
//
// First three are card-side (Spend Analyzer), last three bank-side (Finances).
const FILTER_ORDER = ['categories', 'cards', 'merchants', 'accounts', 'flows', 'payees']
const FILTER_PREFIX = {
  categories: 'cat', cards: 'card', merchants: 'merch',
  accounts: 'acct', flows: 'flow', payees: 'payee',
}
const FILTER_NOUN = {
  categories: 'category', cards: 'card', merchants: 'merchant',
  accounts: 'account', flows: 'type', payees: 'payee',
}

function normalizeFilters(filters = {}) {
  const out = {}
  for (const kind of FILTER_ORDER) {
    const values = filters[kind]
    if (values?.length) out[kind] = [...values].sort()
  }
  return out
}

/**
 * A stable string identifying exactly what the insights on screen describe.
 *
 * Stored as `spendInsights.period` server-side, where `/api/llm/spend-chat` compares it by
 * equality before appending a reply. Encoding the filters — not just the dates — is what stops a
 * follow-up answer from attaching to insights the user has since re-scoped.
 */
export function buildScopeKey(range, filters = {}) {
  const parts = [range?.key ?? 'All', range?.from ?? '', range?.to ?? '']
  const normalized = normalizeFilters(filters)
  for (const kind of FILTER_ORDER) {
    if (normalized[kind]) parts.push(`${FILTER_PREFIX[kind]}:${normalized[kind].join(',')}`)
  }
  return parts.join('|')
}

/** Human-readable version of the same thing, for the "Based on …" line in the insights rail. */
export function describeScope(range, filters = {}) {
  const base = range?.label ?? 'all time'
  const normalized = normalizeFilters(filters)
  const clauses = FILTER_ORDER
    .filter(kind => normalized[kind])
    .map(kind => {
      const values = normalized[kind]
      const noun = FILTER_NOUN[kind] + (values.length > 1 ? 's' : '')
      return `${noun} ${values.join(', ')}`
    })
  return clauses.length ? `${base}, filtered to ${clauses.join(' and ')}` : base
}
