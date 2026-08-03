// Used by the Finances tab (bank transactions)
export const FINANCE_CATEGORIES = ['Income', 'Expense', 'Savings', 'Investments']

export const FINANCE_CATEGORY_COLORS = {
  'Income':      '#22c55e',
  'Expense':     '#f87171',
  'Savings':     '#14b8a6',
  'Investments': '#6366f1',
}

// Used by the Spend Analyzer tab (credit card transactions)
export const CATEGORIES = [
  'Food & Dining',
  'Grocery',
  'Transport',
  'Housing',
  'Entertainment',
  'Subscription',
  'Health',
  'Shopping',
  'Income',
  'Transfer',
  'Other',
]

// Positive credit-card rows: money coming back to you rather than spending. Payments to the card
// are never stored at all (they settle from the bank account, where they already appear), so these
// four kinds cover everything a card statement credits you.
export const CREDIT_KINDS = ['cashback', 'refund', 'rebate', 'credit']

export const CREDIT_KIND_LABELS = {
  cashback: 'Cashback & Rewards',
  refund:   'Refunds & Returns',
  rebate:   'Rebates & Adjustments',
  credit:   'Other Credits',
}

export const CATEGORY_COLORS = {
  'Food & Dining': '#f97316',
  'Grocery':       '#84cc16',
  'Transport':     '#3b82f6',
  'Housing':       '#8b5cf6',
  'Entertainment': '#ec4899',
  'Subscription':  '#6366f1',
  'Health':        '#10b981',
  'Shopping':      '#f59e0b',
  'Income':        '#22c55e',
  'Transfer':      '#6b7280',
  'Other':         '#94a3b8',
}
