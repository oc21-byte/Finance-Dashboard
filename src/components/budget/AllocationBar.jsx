/**
 * Where every dollar of income is committed, as one bar.
 *
 * Geometry comes from `plan.allocation` in `budgetModel.js`, already clamped: the segments always
 * sum to the full track, and an over-committed plan re-labels the residual rather than shrinking
 * it to nothing. A bar that renders 40% "unallocated" for a plan that is $800 short would say the
 * exact opposite of the truth, which is why the clamp and the label move together.
 */
export default function AllocationBar({ plan }) {
  const { allocation, income } = plan
  if (!income.display) return null

  const { spendPct, savePct, freePct, overBudget } = allocation
  const residualLabel = overBudget ? 'Over budget' : 'Unallocated'
  const residualFill = overBudget ? 'bg-red-400' : 'bg-green-300'

  const legend = [
    { fill: 'bg-blue-300', label: 'Spending caps', pct: spendPct, tone: 'text-gray-500' },
    { fill: 'bg-teal-400', label: 'Savings planned', pct: savePct, tone: 'text-gray-500' },
    {
      fill: residualFill,
      label: residualLabel,
      pct: allocation.unallocatedPct,
      tone: overBudget ? 'font-medium text-red-600' : 'text-gray-500',
    },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {spendPct > 0 && <div className="h-full bg-blue-300 transition-all" style={{ width: `${spendPct}%` }} />}
        {savePct > 0 && <div className="h-full bg-teal-400 transition-all" style={{ width: `${savePct}%` }} />}
        {freePct > 0 && <div className={`h-full transition-all ${residualFill}`} style={{ width: `${freePct}%` }} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {legend.map(item => (
          <span key={item.label} className={`flex items-center gap-1.5 text-xs ${item.tone}`}>
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${item.fill}`} />
            {item.label} ({Math.round(item.pct)}%)
          </span>
        ))}
      </div>
    </div>
  )
}
