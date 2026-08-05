import PeriodChips from '../shared/PeriodChips.jsx'
import PinnedScopeBar from '../shared/PinnedScopeBar.jsx'

const money = n => '$' + Math.round(Math.abs(n)).toLocaleString()
const signedMoney = n => (n < 0 ? '−' : '+') + money(n)

/**
 * The condensed scope row for Finances — the same pinned bar the Spend Analyzer uses, carrying this
 * tab's headline numbers instead of card ones.
 *
 * It mirrors `FinanceKpiRow` in both order and meaning: net cash leads, then the workings behind it.
 * Saved and Invested are allocation, never subtracted from net cash, so they read as their own
 * figures rather than as part of the outflow. Tiles drop off from the right as the viewport
 * narrows, keeping the bar to the single line its fixed height depends on.
 *
 * Render this immediately after the KPI row: `PinnedScopeBar`'s sentinel is where it pins from.
 */
export default function FinanceScopeBar({
  period, onPeriodChange, range, txCount, monthsAvailable,
  kpis, chips, onClearAll, offsetTop = 0,
}) {
  const { netCash, income, expenses, saved, invested, months } = kpis

  return (
    <PinnedScopeBar offsetTop={offsetTop}>
      <PeriodChips
        compact
        value={period}
        onChange={onPeriodChange}
        range={range}
        txCount={txCount}
        monthsAvailable={monthsAvailable}
      />

      <div className="flex items-center gap-x-2.5 text-[13px] text-gray-500 min-w-0 overflow-hidden">
        <span>
          <strong className={`font-semibold ${netCash >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {signedMoney(netCash)}
          </strong> net
          <span className="hidden lg:inline text-gray-400"> over {months || 1}</span>
        </span>
        <span className="text-gray-300">·</span>
        <span>
          <strong className="font-semibold text-gray-900">{money(income)}</strong> in
        </span>
        <span className="text-gray-300">·</span>
        <span>
          <strong className="font-semibold text-gray-900">{money(expenses)}</strong> out
        </span>
        <span className="hidden md:inline text-gray-300">·</span>
        <span className="hidden md:inline">
          <strong className="font-semibold text-gray-900">{money(saved)}</strong> saved
        </span>
        <span className="hidden xl:inline text-gray-300">·</span>
        <span className="hidden xl:inline">
          <strong className="font-semibold text-gray-900">{money(invested)}</strong> invested
        </span>
      </div>

      {chips.length > 0 && (
        <button
          onClick={onClearAll}
          title={chips.map(c => c.label).join(' · ')}
          className="ml-auto shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
        >
          {chips.length} filter{chips.length === 1 ? '' : 's'} · clear all ✕
        </button>
      )}
    </PinnedScopeBar>
  )
}
