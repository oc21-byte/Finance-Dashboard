/**
 * Map the Investments UI target to the vision route's statementType.
 * The modal toggles `holdings` | `savings`; the account-summary branch keys on
 * `investment` | `savings`. Sending `holdings` (or the tab id `investments`) through
 * unchanged lands on the bank ledger prompt and returns no positions — the
 * "No holdings table found" empty result.
 */
export function toVisionStatementType(target) {
  if (target === 'holdings' || target === 'investments') return 'investment'
  return target
}
