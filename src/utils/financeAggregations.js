/**
 * Bank-side aggregation for the Finances tab.
 *
 * A sibling of `spendAggregations.js`, not a generalization of it. That module opens with a
 * hard rule — spend is negatives only — which inverts here, where positive is income. Threading
 * a sign parameter through it would make every card call site pass a constant and would turn a
 * readable invariant into a configurable one.
 *
 * What IS shared is reused directly: `rankBy` and `buildMonthlyBreakdown` take a `keyOf` and
 * total with `Math.abs`, so they carry no polarity assumption and work unchanged on bank rows.
 *
 * Flow classification always goes through `bankFlowOf` (src/constants/financeRules.js) — never
 * re-derive it here.
 */

import { bankFlowOf } from '../constants/financeRules.js'
import { normalizeDescription } from './duplicates.js'
import { PAYMENT_RE } from './csvHelpers.js'
import { rankBy } from './spendAggregations.js'

const round2 = n => Math.round(n * 100) / 100

/** The statement/account a row was imported from. Backs the `accounts` filter. */
export const accountOf = t => t.source || 'Unknown'

export const CARD_PAYMENTS_PAYEE = 'Card Payments'
export const UNKNOWN_PAYEE = 'Unknown'

// Bank statement lines are far noisier than card lines, and `normalizeDescription` alone is not
// enough for them. It strips standalone runs of 4+ digits, which is right for duplicate matching
// but leaves the masked alphanumeric references banks actually use — `CA*B*F**25BD937`,
// `****3600005464X`, `*****31249136125`. Those differ on every row, so one merchant fragments
// into a row per transaction and the breakdown becomes unreadable.
//
// The cleanup below runs BEFORE `normalizeDescription`, on the raw text where `*` and `-` are
// still present to anchor against. `normalizeDescription` is left untouched: it is shared with
// duplicate detection, where loosening the rules would start merging genuinely distinct charges.

// A leading transaction-type tag, e.g. `ACH DEPOSIT, …` or `ELECTRONIC PMT-WEB, …`. It describes
// the rail the money moved over, not who was paid.
const TYPE_TAG_RE = /^[A-Z0-9 \-#]{3,24},\s*/i

// Masked and reference blobs: any token carrying 3+ digits, plus `AUT 040126`-style trace codes.
const REFERENCE_RE = /\bAUT\s*\d+\b|\b[A-Z0-9*#]*\d{3,}[A-Z0-9*#]*\b/gi

// Network/processor filler that appears on nearly every line of some statements and carries no
// information about the counterparty.
const NOISE_RE = /\b(visa\s+dda\s+pur\s+ap|visa\s+direct|dda\s+pur\s+ap|webxfr|e[-\s]?payment|pmt|web)\b/gi

// Some banks append the truncated statement footer to the last row of a page.
const FOOTER_RE = /\bstatement is:.*$/i

// Card payments settle from the bank account, and each issuer words them differently, so left
// alone they scatter across many near-identical rows. `PAYMENT_RE` covers card-side wording
// ("PAYMENT - THANK YOU"); bank-side wording is different enough to need its own pattern, which
// is why an issuer name is required rather than the word "payment" alone — plenty of legitimate
// merchants take a "payment" without being a credit card.
const CARD_ISSUER_RE = /\b(capital\s*one|discover|amex|american\s*express|chase|citi(bank|cards)?|barclay(card)?s?|synchrony|wells\s*fargo|bank\s*of\s*america|us\s*bank)\b/i
const CARD_PAYMENT_CONTEXT_RE = /\b(pmt|payment|card|cc)\b/i
const TRANSFER_TO_CARD_RE = /\btransfer\s+to\s+cc\b|\bcredit\s*card\s*(payment|pmt|bill)\b/i

function isCardPayment(description) {
  if (PAYMENT_RE.test(description)) return true
  if (TRANSFER_TO_CARD_RE.test(description)) return true
  return CARD_ISSUER_RE.test(description) && CARD_PAYMENT_CONTEXT_RE.test(description)
}

// Venmo settles over the card rails, so the bank writes it as a merchant line ending in a location:
// `VENMO COLE MOBERG NEW YORK * NY`. That location field is not stable for one counterparty — the
// same person appears as `NEW YORK` on one row and as the acquirer tag `VISA DIRECT` on the next,
// which splits them into two buckets. Everything past the name is location, so the name is all we
// keep. Two tokens is the shape Venmo actually sends (first + last); a longer name is truncated,
// which still groups correctly because the truncation is deterministic.
//
// Deliberately Venmo-only. Other rails (Zelle, ACH) do not carry this city field, and stripping a
// trailing token from every merchant would start eating real names.
const VENMO_RE = /\bvenmo\b/i
const VENMO_NAME_TOKENS = 2

const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase())

/**
 * The payee bucket a row belongs to.
 *
 * Bank rows carry no subcategory — only the four reserved FINANCE_CATEGORIES — so a breakdown has
 * to group by something derived, and the counterparty in the description is the honest choice.
 *
 * Labels are title-cased for display; truncation is the UI's job, not this function's.
 *
 * This is deliberately one swappable function: if real bank subcategories are added later, they
 * replace this and nothing else in the breakdown pipeline has to change.
 */
export function payeeOf(t) {
  const description = String(t?.description ?? '')
  if (isCardPayment(description)) return CARD_PAYMENTS_PAYEE

  const cleaned = description
    .replace(FOOTER_RE, ' ')
    .replace(TYPE_TAG_RE, ' ')
    .replace(REFERENCE_RE, ' ')
    .replace(NOISE_RE, ' ')

  if (VENMO_RE.test(cleaned)) {
    const name = normalizeDescription(cleaned.split(VENMO_RE).pop())
      .split(' ')
      .filter(Boolean)
      .slice(0, VENMO_NAME_TOKENS)
      .join(' ')
    return titleCase(name ? `venmo ${name}` : 'venmo')
  }

  // Fall back to the raw description when cleanup consumed everything — a row described only as
  // `DEPOSIT` or `CHECK #170` is all tag and no counterparty, and its own text beats "Unknown".
  const normalized = normalizeDescription(cleaned) || normalizeDescription(description)
  if (!normalized) return UNKNOWN_PAYEE
  return titleCase(normalized)
}

/**
 * Narrow rows by the active bank filter chips. Mirrors `applyFilters` in spendAggregations.js —
 * empty or absent arrays mean "no constraint", and kinds combine with AND while values within a
 * kind combine with OR.
 */
export function applyFinanceFilters(transactions, filters = {}) {
  const { accounts = [], flows = [], payees = [] } = filters
  if (!accounts.length && !flows.length && !payees.length) return transactions
  return transactions.filter(t => {
    if (accounts.length && !accounts.includes(accountOf(t))) return false
    if (flows.length && !flows.includes(bankFlowOf(t))) return false
    if (payees.length && !payees.includes(payeeOf(t))) return false
    return true
  })
}

/**
 * Ranked payee buckets for the two breakdown cards.
 *
 * Inflows are income rows only. Outflows are EXPENSE rows only — savings and investment
 * transfers are deliberately excluded even though they are money leaving the account, because
 * they are allocation and belong to the Savings & investments card. Keeping them out is what
 * makes `expenses + saved + invested` reconcile with total money out instead of double-counting.
 */
export function buildInflows(transactions) {
  return rankBy(transactions.filter(t => bankFlowOf(t) === 'income'), payeeOf)
}

export function buildOutflows(transactions) {
  return rankBy(transactions.filter(t => bankFlowOf(t) === 'expense'), payeeOf)
}

export const UNASSIGNED_DESTINATION = 'Unassigned'

/**
 * Where allocation actually landed.
 *
 * Savings rows resolve through `linkedSavingsAccountId` to a savings account; investment rows carry
 * `linkedHoldingAccountType`, a label string rather than an id because holdings have no account
 * entity to point at — the account type IS the account, and the server already treats it that way.
 *
 * `Unassigned` is a real row, never hidden. Money moved out of checking with no destination on it is
 * the most useful thing this card can tell you, and dropping it would also break the reconciliation
 * with the Saved / Invested KPIs. A link to an account that has since been deleted lands here too:
 * it no longer names a destination, so reporting it as one would be a lie.
 */
export function buildDestinations(transactions, savingsAccounts = [], months = 0) {
  const accountName = new Map(savingsAccounts.map(a => [a.id, a.name]))
  const buckets = new Map()

  let saved = 0
  let invested = 0

  for (const t of transactions) {
    const flow = bankFlowOf(t)
    if (flow !== 'savings' && flow !== 'investments') continue

    const amount = Math.abs(Number(t.amount) || 0)
    if (flow === 'savings') saved += amount
    else invested += amount

    const name = (flow === 'savings'
      ? accountName.get(t.linkedSavingsAccountId)
      : t.linkedHoldingAccountType) || UNASSIGNED_DESTINATION

    // Keyed by kind as well as name so a savings account and a holding type that happen to share a
    // name stay apart — and so the two `Unassigned` residuals do.
    const key = `${flow}:${name}`
    const bucket = buckets.get(key) ?? { key, name, kind: flow, amount: 0, transfers: 0 }
    bucket.amount += amount
    bucket.transfers += 1
    buckets.set(key, bucket)
  }

  saved = round2(saved)
  invested = round2(invested)
  const total = round2(saved + invested)

  const destinations = [...buckets.values()]
    .map(b => ({
      ...b,
      amount: round2(b.amount),
      share: total > 0 ? b.amount / total : 0,
      perMonth: months ? round2(b.amount / months) : 0,
    }))
    // Unassigned sorts last whatever its size: it is a residual, not a destination.
    .sort((a, b) => {
      const aResidual = a.name === UNASSIGNED_DESTINATION
      const bResidual = b.name === UNASSIGNED_DESTINATION
      if (aResidual !== bResidual) return aResidual ? 1 : -1
      return b.amount - a.amount
    })

  return {
    saved,
    invested,
    total,
    months,
    perMonth: months ? round2(total / months) : 0,
    destinations,
    unassigned: round2(
      destinations.filter(d => d.name === UNASSIGNED_DESTINATION).reduce((s, d) => s + d.amount, 0),
    ),
    segments: [
      { key: 'Savings', label: 'Savings', amount: saved, share: total > 0 ? saved / total : 0 },
      { key: 'Investments', label: 'Investments', amount: invested, share: total > 0 ? invested / total : 0 },
    ],
  }
}

/** Absolute total of the rows matching one flow. */
export function sumFlow(transactions, flow) {
  let total = 0
  for (const t of transactions) {
    if (bankFlowOf(t) === flow) total += Math.abs(Number(t.amount) || 0)
  }
  return round2(total)
}

/**
 * The five headline numbers.
 *
 * `netCash` is income minus expenses. Savings and investment transfers are deliberately NOT
 * subtracted: they are allocation, money moved rather than money spent, and subtracting them
 * would report a saver as though they were breaking even.
 *
 * Card credits stay out of income unless `countCredits` is on. A credit shrinks the card bill,
 * and that bill is already an expense on the bank side, so counting it as income too counts the
 * same money twice — see the `countCardCreditsAsIncome` setting.
 */
export function buildFinanceKpis(transactions, range, cardCredits = [], countCredits = false) {
  const income = sumFlow(transactions, 'income')
  const expenses = sumFlow(transactions, 'expense')
  const saved = sumFlow(transactions, 'savings')
  const invested = sumFlow(transactions, 'investments')
  const credits = round2(cardCredits.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0))

  const countedIncome = countCredits ? round2(income + credits) : income
  const months = range?.monthCount || 0
  const per = value => (months ? round2(value / months) : 0)

  return {
    income,
    expenses,
    saved,
    invested,
    credits,
    countedIncome,
    netCash: round2(countedIncome - expenses),
    months,
    perMonth: {
      income: per(income),
      expenses: per(expenses),
      saved: per(saved),
      invested: per(invested),
    },
    // Share of income actually set aside. Null rather than 0 when there is no income to divide
    // by, so the UI can say "—" instead of claiming a 0% savings rate.
    savedShareOfIncome: countedIncome > 0 ? saved / countedIncome : null,
    txCount: transactions.length,
    accountCount: new Set(transactions.map(accountOf)).size,
  }
}
