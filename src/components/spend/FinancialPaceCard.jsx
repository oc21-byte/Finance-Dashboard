import { useQuery } from '@tanstack/react-query'
import { paceStyle } from '../shared/paceStyles.js'
import { formatMoney } from '../../utils/moneyFormat.js'
import { DEFAULT_DISPLAY_CURRENCY, resolveDisplayCurrency } from '../../utils/displayCurrency.js'
import { api } from '../../api/client.js'

function moneyValue(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  return value == null ? '—' : formatMoney(value, currency)
}

function PaceMetric({ label, value, tone, currency = DEFAULT_DISPLAY_CURRENCY }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-2">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-[12.5px] font-bold ${tone ?? 'text-gray-800'}`}>{moneyValue(value, currency)}</p>
    </div>
  )
}

export default function FinancialPaceCard({ pace, scope }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const currency = resolveDisplayCurrency(settings?.displayCurrency)
  const styles = paceStyle(pace?.status)
  const showMetrics = pace?.income != null || pace?.expenses != null
  const headroomTone = pace?.headroom == null
    ? undefined
    : pace.headroom < 0 ? 'text-rose-700' : 'text-emerald-700'

  return (
    <section className={`rounded-xl border p-4 ${styles.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-gray-500">
            Financial Pace
          </p>
          <p className="mt-0.5 text-[10.5px] text-gray-400">Income, expenses and savings room</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px] font-semibold ${styles.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
          {pace?.label ?? 'Not Enough Data'}
        </span>
      </div>

      {pace?.summary && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-gray-700">{pace.summary}</p>
      )}

      {showMetrics && (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <PaceMetric label="Monthly income" value={pace.income} currency={currency} />
          <PaceMetric label="Monthly expenses" value={pace.expenses} currency={currency} />
          <PaceMetric label="Headroom" value={pace.headroom} tone={headroomTone} currency={currency} />
          <PaceMetric label="Savings target" value={pace.savingsTarget} currency={currency} />
        </div>
      )}

      <div className="mt-3 text-[10.5px] leading-relaxed text-gray-400">
        {scope?.label && <p>Based on complete bank months: {scope.label}.</p>}
        {pace?.incomeSource === 'confirmed_monthly_income' && <p>Uses your confirmed monthly income.</p>}
        {pace?.incomeSource === 'observed_bank_income' && <p>Uses average income found in your bank activity.</p>}
      </div>
    </section>
  )
}
