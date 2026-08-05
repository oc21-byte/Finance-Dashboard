// The canonical bank-side income/expense contract. Imported by the client AND the server —
// `server/spendAnalysis.js` already reaches into `src/utils/`, so this follows the same path.
//
// Read this before writing any bank aggregation. The rules used to live in four places
// (Finances.jsx, server/index.js, server/spendAnalysis.js, Dashboard.jsx) that agreed by
// coincidence rather than by construction; they now all route through here.
//
// The contract, stated once:
//
//   - `category` is the discriminator. It is one of the four reserved FINANCE_CATEGORIES.
//   - `type` is only ever 'income' or 'expense'. There is no 'savings' or 'investment' type,
//     and no import path writes one — Savings and Investments are CATEGORIES carried on rows
//     whose type is 'expense' (money leaving checking), reachable only by editing the category.
//   - `type` is therefore a fallback, consulted only when the category is not one of the four
//     reserved tags (an un-retagged import row like 'Grocery' or ''), never to override one.
//   - Savings and Investments are outflows, but they are ALLOCATION, not spending. They are
//     never folded into expenses; double-counting them is the mistake this file exists to stop.

import { FINANCE_CATEGORIES } from './categories.js'

export const FINANCE_CATEGORY_SET = new Set(FINANCE_CATEGORIES)

/**
 * Which of the four bank flows a row represents, from its category and type alone.
 *
 * Order matters: Savings and Investments are tested first so an allocation row can never fall
 * through to the expense branch on its `type: 'expense'`.
 *
 * @returns {'income'|'expense'|'savings'|'investments'|null} null when the row is neither
 *   (e.g. an uncategorized row with no usable type).
 */
export function bankFlowOf(tx) {
  const category = tx?.category
  if (category === 'Savings') return 'savings'
  if (category === 'Investments') return 'investments'
  const type = tx?.type
  if (category === 'Income' || (type === 'income' && !FINANCE_CATEGORY_SET.has(category))) return 'income'
  if (category === 'Expense' || (type === 'expense' && !FINANCE_CATEGORY_SET.has(category))) return 'expense'
  return null
}

// The sign-checked forms. Use these wherever a wrong-signed row would corrupt an average —
// Financial Pace divides by a month count, so one income row stored negative would silently
// drag the mean down rather than being ignored.
export const isBankIncome = tx => Number(tx?.amount) > 0 && bankFlowOf(tx) === 'income'
export const isBankExpense = tx => Number(tx?.amount) < 0 && bankFlowOf(tx) === 'expense'

// Allocation. Both are outflows, so both are negative on a well-formed row.
export const isSavingsTransfer = tx => Number(tx?.amount) < 0 && bankFlowOf(tx) === 'savings'
export const isInvestmentTransfer = tx => Number(tx?.amount) < 0 && bankFlowOf(tx) === 'investments'
