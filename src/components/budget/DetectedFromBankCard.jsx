import { money } from './format.js'

/**
 * What the bank ledger already shows going out, monthly.
 *
 * Read-only on purpose. These are observations, not intentions — the plan above says what should
 * happen and this says what does. Making them editable here would let a user "set" a figure that
 * the next import silently contradicts.
 */
export default function DetectedFromBankCard({ plan }) {
  const { savingsContrib, investContrib } = plan.detectedFromBank
  if (savingsContrib <= 0 && investContrib <= 0) return null

  const rows = [
    { label: 'Savings contributions', value: savingsContrib },
    { label: 'Investment contributions', value: investContrib },
  ].filter(row => row.value > 0)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-gray-900">Detected from bank data</h2>
        <p className="mt-1 text-[12.5px] text-gray-400">
          Observed in the bank ledger{plan.income.windowLabel ? `, ${plan.income.windowLabel}` : ''} — not manually set
        </p>
      </div>
      <div className="divide-y divide-gray-100 px-5">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between py-2.5 text-[13px]">
            <span className="text-gray-500">{row.label}</span>
            <span className="font-medium text-gray-900">{money(row.value)}/mo avg</span>
          </div>
        ))}
      </div>
    </div>
  )
}
