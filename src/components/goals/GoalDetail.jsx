import dayjs from 'dayjs'
import { goalCardModel, money, timelineText } from '../../utils/goalsModel.js'
import { TONES } from './palette.js'

/**
 * Everything about the one selected goal, in a fixed place below the grid.
 *
 * The whole point of the 7c layout: a card stays a card, and expanding one opens here instead of
 * growing in place. `linksSlot` and `aiPanel` are passed in rather than rendered here so the page
 * stays in charge of composition — this component owns only the progress card and the header.
 */
export default function GoalDetail({
  goal, onEdit, onDelete, onClose,
  addFunds, onAddFundsChange, onAddFunds, addFundsPending,
  readOnly, readOnlyTitle, linksSlot, aiPanel,
}) {
  const model = goalCardModel(goal)
  const tone = TONES[model.tone]
  const timeline = timelineText(goal)

  return (
    <div className="mt-6 border-t border-dashed border-gray-200 pt-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-gray-800">{goal.name}</h2>
          <p className="mt-0.5 text-xs text-gray-400">Target: {dayjs(goal.targetDate).format('MMM D, YYYY')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3.5 text-xs font-medium">
          <button onClick={onEdit} disabled={readOnly} title={readOnly ? readOnlyTitle : undefined} className="text-blue-600 transition-colors hover:text-blue-700 disabled:text-gray-300">
            Edit
          </button>
          <button onClick={onDelete} disabled={readOnly} title={readOnly ? readOnlyTitle : undefined} className="text-gray-400 transition-colors hover:text-red-500 disabled:text-gray-300">
            Delete
          </button>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">Close ✕</button>
        </div>
      </div>

      {/* The AI panel matches the left column's height by default grid stretch, which is what lets
          its chat thread scroll inside the card rather than running past it. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-1.5 flex justify-between text-xs text-gray-500">
              <span>${money(goal.currentAmount)}</span>
              <span>{model.pctLabel}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-gray-100">
              <div className={`h-2.5 rounded-full transition-all ${tone.bar}`} style={{ width: `${model.pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-400">of ${money(goal.targetAmount)}</p>

            {model.reached && (
              <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-600">Goal reached!</p>
            )}
            {!model.reached && timeline && (
              <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600">{timeline}</p>
            )}
            {/* Optimistic growth projection — additive, clearly labeled as an assumption. */}
            {!model.reached && goal.growthVerdict && (
              <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                📈 {goal.growthVerdict}
              </p>
            )}

            {/* Add funds — only for unlinked goals; a linked goal's amount comes from its accounts,
                so typing one in would be overwritten on the next read. */}
            {!model.reached && !goal.isLinked && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  type="number" min="0" step="0.01" placeholder="Add amount…"
                  value={addFunds}
                  disabled={readOnly}
                  title={readOnly ? readOnlyTitle : undefined}
                  onChange={onAddFundsChange}
                  onKeyDown={(e) => e.key === 'Enter' && onAddFunds()}
                />
                <button
                  onClick={onAddFunds}
                  disabled={addFundsPending || readOnly}
                  title={readOnly ? readOnlyTitle : undefined}
                  className="whitespace-nowrap rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
                >
                  Add Funds
                </button>
              </div>
            )}
            {goal.monthlySavings > 0 && (
              <p className="mt-2.5 text-xs text-gray-400">Saving ${money(goal.monthlySavings)} / mo</p>
            )}
          </div>

          {linksSlot}
        </div>

        {aiPanel}
      </div>
    </div>
  )
}
