import { useEffect, useRef, useState } from 'react'
import PeriodChips from './PeriodChips.jsx'
import FilterBar from './FilterBar.jsx'
import KpiRow from './KpiRow.jsx'

const money = n => '$' + Math.round(n).toLocaleString()

/**
 * Height of the pinned bar, in px. A hard constant on purpose — see below.
 * Anything that has to clear the bar imports this rather than measuring.
 */
export const PINNED_BAR_H = 56

/**
 * The scope header: the full period selector and KPI grid in normal flow, plus a condensed bar
 * that pins to the top once you scroll past them.
 *
 * **The condensed bar is `fixed`, not `sticky`, and its height is a constant.** Both of those are
 * load-bearing. A sticky element that changes height changes the document's height with it, which
 * moves the scroll position, which moves the sentinel that decides whether to condense — so the
 * header condenses, the page shortens, the sentinel comes back into view, the header expands, and
 * it thrashes on every frame. Taking the bar out of flow means toggling it cannot move anything,
 * and fixing its height means nothing downstream has to measure it and re-render mid-scroll.
 *
 * So: don't make this bar `sticky`, don't let its content wrap, and don't replace the constant
 * with a measurement.
 *
 * `offsetTop` is for anything else pinned above it — currently Layout's demo-mode banner, which is
 * `sticky top-0 z-40` and would otherwise sit on top of the period chips.
 */
export default function ScopeHeader({
  period, onPeriodChange, range, txCount, monthsAvailable,
  chips, filterSummary, onClearAll,
  kpis, recurring, recurringOpen, onRecurringClick,
  offsetTop = 0,
}) {
  const sentinelRef = useRef(null)
  const [pinned, setPinned] = useState(false)

  // A sentinel below the full block, rather than a scroll listener: the browser reports the
  // crossing itself, so this costs nothing per frame.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

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

      <div ref={sentinelRef} className="h-px -mt-px" aria-hidden />

      {pinned && (
        <div
          // Opaque, not translucent-with-blur: a backdrop-filter spanning the viewport has to
          // recomposite the charts underneath it on every scroll frame.
          className="fixed inset-x-0 z-30 bg-gray-50 border-b border-gray-200 shadow-[0_4px_10px_-8px_rgba(0,0,0,0.3)]"
          style={{ top: offsetTop, height: PINNED_BAR_H, animation: 'scope-condense 140ms ease-out' }}
        >
          {/* Matches <main>'s max-w-7xl and the page's own padding, so the bar lines up with the
              content underneath it. `overflow-hidden` + `whitespace-nowrap` keep this to exactly
              one line at any width — wrapping would break the constant height. */}
          <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center gap-x-4 overflow-hidden whitespace-nowrap">
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
          </div>
        </div>
      )}
    </>
  )
}
