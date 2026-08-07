import InfoTip from '../dashboard/InfoTip.jsx'
import { money } from '../../utils/goalsModel.js'

const MONTHS = [3, 6, 9, 12]

/**
 * The emergency fund, as one row above the grid.
 *
 * It is not an ordinary goal and does not sit in the grid with them: its target is *derived* from
 * average spend rather than chosen, and it counts cash you have not earmarked toward anything. So
 * it gets a banner, and the coverage toggle is the only control on this tab that changes a figure
 * without saving anything.
 *
 * Every figure comes from `emergencyFund()` in `goalsModel.js`, including the fix for cash being
 * counted twice when the goal links the cash source directly.
 */
export default function EmergencyFundBanner({
  ef, months, onMonthsChange, cashBalance, onSync, onCreate, pending, readOnly, readOnlyTitle,
}) {
  const { efGoal, hasBasis, target, current, pct, gap, goalAmount, cashCounted, basisLabel } = ef
  // Cash the goal already earmarks is inside `goalAmount`, so it is not added again on top.
  const cashInsideGoal = Math.max(0, (cashBalance ?? 0) - cashCounted)

  return (
    <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50/40 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <h2 className="text-sm font-semibold text-gray-700">Emergency Fund</h2>
          <InfoTip label="Emergency Fund">
            <span className="block">
              Your target is average monthly spending times the coverage you pick. That average uses
              your <strong>bank</strong> transactions over complete calendar months only — a partial
              month is left out rather than dragging the average down. Credit-card bill payments are
              counted there, so card purchases are not added a second time, and transfers to savings
              or investments are excluded: that is money set aside, not spent.
            </span>
            <span className="mt-2 block">
              Progress counts the Emergency Fund goal’s balance plus any cash not already earmarked
              by it — cash is available in an emergency whether or not a goal names it, but a dollar
              is only ever counted once.
            </span>
          </InfoTip>
        </div>

        <div className="flex gap-0.5 rounded-lg border border-teal-200 bg-white p-0.5">
          {MONTHS.map(m => (
            <button
              key={m}
              onClick={() => onMonthsChange(m)}
              aria-pressed={months === m}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                months === m ? 'bg-teal-600 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m}mo
            </button>
          ))}
        </div>

        {!hasBasis ? (
          <p className="text-xs text-gray-500">
            Add transactions and this works out your target from what you actually spend.
          </p>
        ) : efGoal ? (
          <>
            <div className="min-w-[200px] max-w-[420px] flex-1">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="text-[13px] font-semibold text-teal-700">
              ${money(current)} of ${money(target)} · {pct.toFixed(1)}%
            </span>
            <span className="ml-auto text-[11.5px] text-gray-500">
              {gap > 0 ? `Gap $${money(gap)}` : 'Fully funded'} · ${money(goalAmount)} goal
              {cashCounted > 0 && ` + $${money(cashCounted)} cash`}
              {cashInsideGoal > 0 && ` (the goal already links $${money(cashInsideGoal)} of it)`}
            </span>
            {ef.targetMismatch && (
              <button
                onClick={onSync}
                disabled={pending || readOnly}
                title={readOnly ? readOnlyTitle : undefined}
                className="rounded-lg border border-teal-300 px-3 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:opacity-50"
              >
                Sync target → ${money(target)}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-[13px] font-semibold text-teal-700">Target ${money(target)}</span>
            {/* Button and its note travel together to the end of the row, so the call to action
                sits where the Sync button does once the goal exists. */}
            <div className="ml-auto flex flex-col items-end gap-1">
              <button
                onClick={onCreate}
                disabled={pending || readOnly}
                title={readOnly ? readOnlyTitle : undefined}
                className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                {pending ? 'Creating…' : 'Create Emergency Fund Goal'}
              </button>
              {cashBalance > 0 && (
                <span className="text-[11.5px] text-gray-500">
                  Starts from your ${money(cashBalance)} cash balance
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* The target is derived, so it says what from. A figure with no stated basis is a figure
          nobody can check. */}
      {basisLabel && <p className="mt-2 text-[11px] text-gray-400">{basisLabel}</p>}
    </div>
  )
}
