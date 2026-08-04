const PACE_STYLES = {
  on_track: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    card: 'border-emerald-100 bg-emerald-50/35',
  },
  little_room: {
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
    card: 'border-amber-100 bg-amber-50/35',
  },
  over_pace: {
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
    card: 'border-rose-100 bg-rose-50/35',
  },
  not_enough_data: {
    badge: 'border-gray-200 bg-gray-50 text-gray-600',
    dot: 'bg-gray-400',
    card: 'border-gray-200 bg-gray-50/50',
  },
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function moneyValue(value) {
  return value == null ? '—' : money.format(value)
}

function PaceMetric({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-2">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-[12.5px] font-bold ${tone ?? 'text-gray-800'}`}>{moneyValue(value)}</p>
    </div>
  )
}

export default function FinancialPaceCard({ pace, scope }) {
  const styles = PACE_STYLES[pace?.status] ?? PACE_STYLES.not_enough_data
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
          <PaceMetric label="Monthly income" value={pace.income} />
          <PaceMetric label="Monthly expenses" value={pace.expenses} />
          <PaceMetric label="Headroom" value={pace.headroom} tone={headroomTone} />
          <PaceMetric label="Savings target" value={pace.savingsTarget} />
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
