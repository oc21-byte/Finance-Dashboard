import { paceStyle } from '../shared/paceStyles.js'
import { money } from './format.js'

const STATUS_LABEL = {
  on_track: 'On track',
  little_room: 'Below target',
  over_pace: 'Over budget',
  not_enough_data: 'No income yet',
}

/**
 * The plan's savings rate against its own target.
 *
 * **Planned, not achieved.** Spend's Financial Pace shows `savingsContributions / income` — what
 * the ledger says actually happened. This shows `totalSavingsPlanned / income` — what the plan
 * intends. They are routinely far apart, and a rail that called either one "your savings rate"
 * would have the user reading two different numbers under one name on two tabs.
 *
 * The track is a **share of income, zero-based**, with the target as a tick along it — not a
 * progress bar of planned-against-target. A ratio bar pegs at full the moment the plan clears its
 * target and then encodes nothing: a plan at 20% and a plan at 66% against a 15% target would draw
 * identically. Against a 0–100% income track they read as what they are.
 */
export default function PlannedRateCard({ plan }) {
  const { savingsRate, totalSavingsPlanned, income, capPressure } = plan
  const style = paceStyle(savingsRate.status)
  const { plannedPct, targetPct, shortfall } = savingsRate

  const detail = income.display <= 0
    ? 'Add income to see how the plan divides it.'
    : shortfall > 0
      ? `${money(shortfall)}/mo short of the ${targetPct}% target`
      : `${money(-shortfall)}/mo ahead of the ${targetPct}% target`

  return (
    <div className={`rounded-xl border p-4 ${style.card}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
          Planned savings rate
        </span>
        <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${style.badge}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {STATUS_LABEL[savingsRate.status]}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-tight tracking-tight text-teal-700">
          {plannedPct}%
        </span>
        <span className="truncate text-xs text-gray-500">{money(totalSavingsPlanned)}/mo of income</span>
      </div>

      <div className="relative mt-3 h-2 rounded-full bg-white/70 ring-1 ring-inset ring-gray-200">
        <div
          className="h-full rounded-full bg-teal-500 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, plannedPct))}%` }}
        />
        {/* The target, in place along the same 0–100% income track the bar is drawn on. */}
        <div
          className="absolute -top-1 -bottom-1 w-[1.5px] rounded bg-amber-600"
          style={{ left: `${Math.min(100, Math.max(0, targetPct))}%` }}
          title={`Target ${targetPct}% of income`}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-gray-500">{detail}</span>
        <span className="shrink-0 text-gray-400">0–100% of income</span>
      </div>

      {capPressure.overCount > 0 && (
        <p className="mt-3 border-t border-black/5 pt-2.5 text-[11.5px] leading-relaxed text-gray-600">
          {capPressure.overCount} of {capPressure.capped} capped
          {capPressure.capped === 1 ? ' category is' : ' categories are'} over on average, by{' '}
          <span className="font-semibold text-gray-800">{money(capPressure.overBy)}/mo</span> combined
          {capPressure.worst && <> — {capPressure.worst.name} is the widest gap</>}.
        </p>
      )}
    </div>
  )
}
