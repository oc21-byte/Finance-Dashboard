/** Accepted upload-history ledger values. Unknown non-empty values must be rejected, not coerced. */
export const LEDGERS = new Set(['bank', 'credit_card', 'investment'])

/** Investment upload-history targets. Unknown non-empty values must be rejected, not coerced. */
export const INVESTMENT_TARGETS = new Set(['holdings', 'savings'])

/**
 * Resolve the ledger for a new upload-history entry.
 * Missing/empty → bank (legacy clients). A wrong string → error message, never a silent default.
 */
export function resolveUploadLedger(ledger) {
  if (ledger == null || ledger === '') return { ledger: 'bank' }
  if (!LEDGERS.has(ledger)) {
    return { error: `Unknown ledger "${ledger}". Expected bank, credit_card, or investment.` }
  }
  return { ledger }
}

/**
 * Resolve the investment target for a new upload-history entry.
 * Missing/empty → holdings. A wrong string → error message, never a silent default to holdings
 * that would make a savings cascade look at purchase lots.
 */
export function resolveInvestmentTarget(target) {
  if (target == null || target === '') return { target: 'holdings' }
  if (!INVESTMENT_TARGETS.has(target)) {
    return { error: `Unknown investment target "${target}". Expected holdings or savings.` }
  }
  return { target }
}
