import InlineAmountInput from './InlineAmountInput.jsx'
import { money, pctOfIncome } from './format.js'

/**
 * Spending caps against what actually gets spent.
 *
 * Spending only. This table used to also carry savings-category rows, one row per active goal, and
 * the general savings target, under a divider that had to explain the rows below it were "counted
 * in Savings Planned" — four different kinds of thing in one grid, three of which were not caps on
 * spending at all. Those now live in `SavingsGoalsCard`.
 *
 * The average is card-side. A cap on a category the user has never charged shows an em dash rather
 * than $0, because zero average and no data are different claims.
 */
export default function SpendingCapsTable({
  rows, income, windowLabel, editing, editValue,
  onStartEdit, onEditValue, onCommit, onCancel, readOnly, error,
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-gray-900">Spending caps</h2>
        <p className="mt-1 text-[12.5px] text-gray-400">
          {windowLabel ? `Average monthly card spend, ${windowLabel}` : 'Average monthly card spend'}
          {!readOnly && ' · click a cap to edit'}
        </p>
      </div>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-gray-400">
          No spending data yet. Import credit card transactions on the Spend Analyzer tab.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="px-5 py-2.5">Category</th>
                <th className="px-5 py-2.5 text-right">Cap</th>
                <th className="px-5 py-2.5 text-right">Avg</th>
                <th className="w-36 px-5 py-2.5 text-right">Cap vs avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => {
                const isEditing = editing === row.name
                const barColor = row.over ? 'bg-red-400' : row.near ? 'bg-yellow-400' : 'bg-green-400'
                const capPct = pctOfIncome(row.cap, income)
                const avgPct = pctOfIncome(row.avg, income)
                return (
                  <tr key={row.name} className={row.over ? 'bg-red-50' : 'bg-white'}>
                    <td className="px-5 py-3 font-medium text-gray-800">{row.name}</td>
                    <td className="px-5 py-3 text-right">
                      {isEditing ? (
                        <InlineAmountInput
                          ariaLabel={`Cap for ${row.name}`}
                          value={editValue}
                          onChange={onEditValue}
                          onCommit={onCommit}
                          onCancel={onCancel}
                        />
                      ) : row.cap != null ? (
                        <button
                          onClick={() => onStartEdit(row.name, row.cap)}
                          disabled={readOnly}
                          title={readOnly ? 'Unavailable in Demo Mode' : 'Click to edit'}
                          className={`font-semibold transition-colors disabled:cursor-default disabled:no-underline enabled:hover:text-violet-600 enabled:hover:underline ${
                            row.isPending ? 'text-violet-700' : 'text-gray-900'
                          }`}
                        >
                          {money(row.cap)}
                          {capPct != null && <span className="ml-1 font-normal text-gray-400">({capPct}%)</span>}
                          {row.isPending && (
                            <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[9.5px] font-semibold text-violet-700">AI</span>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => onStartEdit(row.name, '')}
                          disabled={readOnly}
                          className="text-xs text-gray-400 underline transition-colors disabled:no-underline enabled:hover:text-violet-600"
                        >
                          {readOnly ? '—' : 'Set cap'}
                        </button>
                      )}
                    </td>
                    <td className={`px-5 py-3 text-right ${row.over ? 'text-red-600' : 'text-gray-500'}`}>
                      {row.avg > 0 ? (
                        <>
                          {money(row.avg)}
                          {avgPct != null && <span className="ml-1 text-gray-400">({avgPct}%)</span>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {row.pct != null ? (
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-2 max-w-[70px] flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${Math.min(100, row.pct)}%` }}
                            />
                          </div>
                          <span className={`w-9 text-right text-[11px] ${row.over ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                            {row.pct}%
                          </span>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-gray-300">—</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
