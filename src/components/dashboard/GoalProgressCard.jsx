import { useMemo } from 'react'
import dayjs from 'dayjs'
import { goalProgress } from '../../utils/liquidNetWorth.js'

const SHOWN = 3

const money = n => '$' + Math.round(Math.abs(n ?? 0)).toLocaleString()

function barColor(pct, late) {
  if (pct >= 100) return 'bg-emerald-500'
  if (late) return 'bg-amber-400'
  return 'bg-blue-500'
}

/**
 * The ETA line, in the phrasing the Goals tab already uses.
 *
 * Deliberately the same sentence shape as `timelineText` in `src/pages/Goals.jsx`, so a goal does
 * not describe itself one way here and another way one tab over. The difference is the rate: Goals
 * quotes the user's STATED `monthlySavings`, while this quotes `goalPace`, which prefers the rate
 * actually visible in the ledger. `pace.source` says which, because "at $500/mo" means something
 * different when it is a plan than when it is six months of observed transfers.
 */
function timelineText(progress) {
  if (progress.reached) return 'Reached'
  const { pace, monthsToGo, eta } = progress
  if (!(pace.perMonth > 0) || !monthsToGo) return 'No funding rate yet — set one in Goals'
  const basis = pace.source === 'derived'
    ? `your last ${pace.months} months of transfers`
    : 'your plan'
  return `${money(pace.perMonth)}/mo from ${basis} — ~${monthsToGo} month${monthsToGo === 1 ? '' : 's'} to go (est. ${dayjs(eta).format('MMM YYYY')})`
}

function slipText(progress, targetDate) {
  if (progress.reached || progress.slipMonths === null) return null
  if (progress.slipMonths > 0) {
    return `${progress.slipMonths} month${progress.slipMonths === 1 ? '' : 's'} past your ${dayjs(targetDate).format('MMM YYYY')} target`
  }
  return `Ahead of your ${dayjs(targetDate).format('MMM YYYY')} target`
}

/**
 * The nearest three goals, and whether they will actually land on time.
 *
 * Sorted by target date rather than by size or completeness: the question this card answers is
 * "what is due next", and a 90%-complete goal three years out is not that. The full list lives one
 * click away, so this never tries to be the Goals tab.
 */
export default function GoalProgressCard({ goals = [], transactions = [], onOpenGoals }) {
  const rows = useMemo(() => {
    const dated = [...goals].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
    return dated.slice(0, SHOWN).map(goal => ({ goal, progress: goalProgress(goal, transactions) }))
  }, [goals, transactions])

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Goal progress</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-400">
            {rows.length === 1
              ? 'Your next goal due, at the rate it is actually being funded.'
              : `The next ${rows.length} goals due, at the rate they are actually being funded.`}
          </p>
        </div>
        {goals.length > 0 && onOpenGoals && (
          <button
            onClick={onOpenGoals}
            className="shrink-0 text-[11.5px] font-semibold text-blue-600 hover:text-blue-800"
          >
            View all {goals.length} →
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-sm text-gray-400">
          No goals yet — add one in the Goals tab
        </div>
      ) : (
        <div className="mt-3">
          {rows.map(({ goal, progress }) => {
            const late = progress.slipMonths !== null && progress.slipMonths > 0
            const slip = slipText(progress, goal.targetDate)
            return (
              <div key={goal.id} className="border-b border-gray-100 py-3.5 last:border-0 last:pb-0">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13.5px] font-medium text-gray-800">{goal.name}</span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-gray-400">
                    {money(goal.currentAmount)} / {money(goal.targetAmount)}
                  </span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor(progress.pct, late)}`}
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[11px] text-gray-400">{timelineText(progress)}</span>
                  {slip && (
                    <span className={`text-[11px] font-medium ${late ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {slip}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
