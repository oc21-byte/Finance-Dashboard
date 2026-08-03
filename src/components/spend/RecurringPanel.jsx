import dayjs from 'dayjs'

const money = n => '$' + n.toFixed(2)

// Longest-running rhythms last, so the list reads from "hits you every week" down to "once a year".
const CADENCE_ORDER = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual']
const CADENCE_LABEL = {
  weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly',
  quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Annual',
}

/**
 * The detected subscription list behind the Recurring KPI.
 *
 * A count and a dollar figure are enough for two subscriptions and useless for twenty, which is
 * the case this exists for: the list is grouped by billing rhythm, sorted by monthly cost, and
 * scrolls rather than pushing the rest of the page down. Each row filters the page to that
 * merchant, reusing the merchant chip rather than introducing a second filtering mechanism.
 */
export default function RecurringPanel({ recurring, onSelectMerchant, onClose }) {
  const groups = CADENCE_ORDER
    .map(cadence => ({ cadence, items: recurring.series.filter(s => s.cadence === cadence) }))
    .filter(g => g.items.length)

  const increased = recurring.series.filter(s => s.trend === 'increased')

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Recurring charges</h2>
          <p className="mt-1 text-xs text-gray-400">
            {recurring.count} detected · {money(recurring.monthlyTotal)}/mo equivalent
            {increased.length > 0 && ` · ${increased.length} increased since tracking began`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-sm text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Hide recurring charges"
        >
          ✕
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {groups.map(({ cadence, items }) => (
          <div key={cadence}>
            <div className="sticky top-0 px-5 py-1.5 bg-gray-50/95 backdrop-blur-sm text-[11px] font-medium uppercase tracking-wider text-gray-400 border-b border-gray-100">
              {CADENCE_LABEL[cadence]} · {items.length}
            </div>
            {items.map(s => (
              <button
                key={s.merchant + s.amount}
                onClick={() => onSelectMerchant(s.label)}
                title={`Filter the page to ${s.label}`}
                className="w-full flex items-center gap-4 px-5 py-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-gray-800 truncate">{s.label}</div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    {s.count} charge{s.count === 1 ? '' : 's'} · last {dayjs(s.lastDate).format('MMM D, YYYY')}
                    {s.trend === 'increased' && <span className="ml-1.5 text-amber-600">↑ increased</span>}
                    {s.trend === 'decreased' && <span className="ml-1.5 text-gray-400">↓ decreased</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-medium text-gray-900">{money(s.amount)}</div>
                  {/* Only worth showing when it differs from the charge itself. */}
                  {cadence !== 'monthly' && (
                    <div className="text-xs text-gray-400">{money(s.monthly)}/mo</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
        Detected from charge cadence and amount stability across your full history — not from the
        Subscription category, so a recurring charge filed elsewhere still counts.
      </p>
    </div>
  )
}
