import PeriodChips from '../shared/PeriodChips.jsx'
import FilterBar from '../shared/FilterBar.jsx'
import PinnedScopeBar from '../shared/PinnedScopeBar.jsx'
import KpiRow from './KpiRow.jsx'

const money = n => '$' + Math.round(n).toLocaleString()

// Re-exported so `SpendAnalyzer.jsx` keeps importing its scope constants from one place.
export { PINNED_BAR_H } from '../shared/PinnedScopeBar.jsx'

/**
 * The scope header: the full period selector and KPI grid in normal flow, plus the condensed row
 * `shared/PinnedScopeBar` pins to the top once you scroll past them. The pin mechanism and its
 * constraints live there; this file owns only what the condensed row says about card spending.
 *
 * `offsetTop` is for anything else pinned above the bar — currently Layout's demo-mode banner.
 */
export default function ScopeHeader({
  period, onPeriodChange, range, txCount, monthsAvailable,
  chips, filterSummary, onClearAll,
  kpis, recurring, recurringOpen, onRecurringClick,
  offsetTop = 0,
}) {
  const months = range.monthCount || 1

  return (
    <>
      <div className="flex flex-col gap-4 mb-5">
        <PeriodChips
          value={period}
          onChange={onPeriodChange}
          range={range}
          txCount={txCount}
          monthsAvailable={monthsAvailable}
        />
        <FilterBar chips={chips} summary={filterSummary} onClearAll={onClearAll} />
        <KpiRow
          kpis={kpis}
          range={range}
          recurring={recurring}
          recurringOpen={recurringOpen}
          onRecurringClick={onRecurringClick}
        />
      </div>

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
            <strong className="font-semibold text-gray-900">{money(kpis.total)}</strong> total
          </span>
          <span className="text-gray-300">·</span>
          <span>
            <strong className="font-semibold text-gray-900">{money(kpis.avgPerMonth)}</strong>/mo
            <span className="hidden lg:inline text-gray-400"> over {months}</span>
          </span>
          <span className="hidden md:inline text-gray-300">·</span>
          <span className="hidden md:inline">
            <strong className="font-semibold text-gray-900">
              {kpis.txCount ? '$' + kpis.avgTransaction.toFixed(2) : '—'}
            </strong> avg
            <span className="hidden xl:inline text-gray-400"> of {kpis.txCount}</span>
          </span>
          {kpis.topCategory && (
            <>
              <span className="hidden lg:inline text-gray-300">·</span>
              <span className="hidden lg:inline truncate max-w-[200px]">
                <strong className="font-semibold text-gray-900">{kpis.topCategory}</strong>
                <span className="text-gray-400"> {Math.round(kpis.topCategoryShare * 100)}%</span>
              </span>
            </>
          )}
        </div>

        {recurring.count > 0 && (
          <button
            onClick={onRecurringClick}
            aria-expanded={recurringOpen}
            title={`${recurring.count} recurring charge${recurring.count === 1 ? '' : 's'} detected`}
            className={`hidden sm:block shrink-0 text-[13px] px-2.5 py-1 rounded-lg border transition-colors ${
              recurringOpen
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <strong className="font-semibold">{money(recurring.monthlyTotal)}</strong>/mo recurring
          </button>
        )}

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
    </>
  )
}
