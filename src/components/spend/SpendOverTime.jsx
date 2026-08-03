import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { buildSpendOverTime, PLOT_H } from '../../utils/spendChartModel.js'
import { ABOVE_AVG } from './palette.js'

const MODES = [
  { key: 'category', label: 'By category' },
  { key: 'card', label: 'By card' },
]

const money = n => '$' + Math.round(n).toLocaleString()

/**
 * The unified "Spend over time" card: a donut for the period's share and stacked bars for each
 * month, drawn from one legend so a colour means the same thing in both.
 *
 * Hovering any coloured thing — ring slice, legend row, bar segment — lifts that series everywhere
 * and fades the rest, which is what makes the two charts read as one. Clicking filters the page.
 * All the maths lives in `spendChartModel.js`; this file is layout and interaction.
 */
export default function SpendOverTime({
  spendTxs, range, categoryColors, cardColors, filters, onFilter,
}) {
  const [mode, setMode] = useState('category')
  const [hovered, setHovered] = useState(null)
  const months = range.months

  const view = useMemo(
    () => buildSpendOverTime(spendTxs, months, mode, categoryColors, cardColors),
    [spendTxs, months, mode, categoryColors, cardColors],
  )

  const active = filters[view.kind] ?? []
  const noun = mode === 'card' ? 'card' : 'category'
  const hasSpend = view.total > 0

  // Below this the bars stop being readable, so the plot scrolls sideways instead of compressing.
  // A twelve-month `All` view is 624px wide, which is wider than a phone and narrower than the
  // card at any desktop size — so the scrollbar only appears where it's actually needed.
  const plotMinWidth = Math.max(months.length * 52, 280)

  // Dim everything that isn't the series under the cursor. When nothing is hovered but a filter is
  // active, the filtered series stays lifted so the page and the chart tell the same story.
  const focus = hovered ?? (active.length === 1 ? active[0] : null)
  const dimmed = name => focus !== null && name !== focus

  const hoverProps = name => ({
    onMouseEnter: () => setHovered(name),
    onMouseLeave: () => setHovered(h => (h === name ? null : h)),
  })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-5 mb-1 flex-wrap">
        <h2 className="text-[15px] font-semibold text-gray-900">Spend over time</h2>
        <div className="flex gap-1.5">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setHovered(null) }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                m.key === mode
                  ? 'bg-gray-100 border-gray-300 text-gray-900'
                  : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-gray-400 max-w-[760px] mb-5">
        The ring is each {noun}'s share of the whole period; the bars are the same {noun}s month by
        month, in the same colours.{' '}
        <span className="text-gray-500 font-medium">
          Click any colour — slice, legend row or bar segment — to filter the whole page to that {noun}.
        </span>
      </p>

      {!hasSpend ? (
        <div className="py-14 text-center">
          <p className="text-sm text-gray-400">No spending in this scope.</p>
          <p className="mt-1 text-xs text-gray-300">
            {months.length} month{months.length === 1 ? '' : 's'} selected — widen the period, or clear a filter.
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] gap-7 items-center">
        {/* Ring + legend */}
        <div className="flex flex-col items-center gap-3.5">
          <div
            className="w-[168px] h-[168px] rounded-full flex items-center justify-center shrink-0"
            style={{ background: view.donutGradient }}
          >
            <div className="w-[108px] h-[108px] rounded-full bg-white flex flex-col items-center justify-center">
              <div className="text-xl font-semibold tracking-tight text-gray-900">
                {money(view.total)}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                total, {months.length} month{months.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 w-full">
            {view.legend.map(row => {
              const isOn = row.kind && active.includes(row.name)
              return (
                <button
                  key={row.name}
                  disabled={!row.kind}
                  onClick={() => onFilter(row.kind, row.name)}
                  {...hoverProps(row.name)}
                  title={
                    row.kind
                      ? `${isOn ? 'Remove the' : 'Filter the page to'} ${row.name} ${noun} — ${money(row.amount)}`
                      : `${row.name} — ${money(row.amount)}`
                  }
                  className={`flex items-center gap-2 w-full text-left text-xs rounded-md px-2 -mx-2 py-1.5 border transition-all ${
                    row.kind ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isOn
                      ? 'bg-blue-50 border-blue-200 text-blue-800 font-semibold'
                      : focus === row.name
                        ? 'bg-gray-100 border-gray-200 text-gray-900 font-semibold'
                        : 'bg-white border-transparent text-gray-700 font-medium'
                  } ${dimmed(row.name) ? 'opacity-40' : 'opacity-100'}`}
                >
                  <span
                    className="rounded-sm shrink-0 transition-all"
                    style={{
                      background: row.color,
                      width: focus === row.name || isOn ? 12 : 9,
                      height: focus === row.name || isOn ? 12 : 9,
                    }}
                  />
                  <span className="flex-1 truncate">{row.name}</span>
                  <span className={isOn ? 'text-blue-600' : 'text-gray-500'}>
                    {money(row.amount)}
                  </span>
                  <span className={`w-8 text-right tabular-nums ${isOn ? 'text-blue-500' : 'text-gray-400'}`}>
                    {Math.round(row.share * 100)}%
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Stacked bars */}
        <div className="min-w-0">
          <div className="overflow-x-auto">
          <div style={{ minWidth: plotMinWidth }}>
          <div
            className="isolate relative flex items-end px-2.5 border-l border-r border-b border-gray-200"
            style={{ height: PLOT_H }}
          >
            <div className="absolute inset-0 -z-10 flex flex-col justify-between pointer-events-none">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="border-t border-dashed border-gray-100" />
              ))}
            </div>

            {view.bars.map(bar => (
              <div key={bar.month} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5">
                <div
                  className={`relative z-[3] px-[5px] py-px rounded bg-white text-[11.5px] font-semibold ${
                    bar.aboveAvg ? '' : 'text-gray-500'
                  }`}
                  style={bar.aboveAvg ? { color: ABOVE_AVG } : undefined}
                >
                  {money(bar.total)}
                </div>
                <div className="w-[46%] max-w-[56px] flex flex-col-reverse">
                  {bar.segs.map(seg => {
                    const isOn = seg.kind && active.includes(seg.name)
                    const lifted = focus === seg.name
                    return (
                      <button
                        key={seg.name}
                        disabled={!seg.kind}
                        onClick={() => onFilter(seg.kind, seg.name)}
                        {...hoverProps(seg.name)}
                        title={`${seg.name} · ${dayjs(bar.month + '-01').format('MMMM YYYY')} — ${money(seg.value)} (${Math.round(seg.share * 100)}% of the month)${seg.kind ? ' · click to filter' : ''}`}
                        className={`w-full block transition-all ${seg.kind ? 'cursor-pointer' : 'cursor-default'} ${
                          dimmed(seg.name) ? 'opacity-25' : 'opacity-100'
                        }`}
                        style={{
                          height: seg.height.toFixed(1) + 'px',
                          background: seg.color,
                          borderBottom: seg.divider ? '1px solid #fff' : undefined,
                          borderRadius: seg.top ? '4px 4px 0 0' : undefined,
                          // An outline rather than a border: a border would change the segment's
                          // height and so misreport the month's split.
                          outline: isOn ? '2px solid #1d4ed8' : lifted ? '2px solid rgba(17,24,39,.55)' : 'none',
                          outlineOffset: '-1px',
                          zIndex: isOn || lifted ? 2 : undefined,
                          position: 'relative',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Average reference. A plain dashed rule — there is no second axis to explain. */}
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{ bottom: view.avgOffset, borderTop: `1.5px dashed ${ABOVE_AVG}` }}
            />
          </div>

          {/* Inside the scroll container so a label stays under its own bar. */}
          <div className="flex px-2.5 pt-2">
            {months.map(m => (
              <div key={m} className="flex-1 text-center text-xs text-gray-500">
                {dayjs(m + '-01').format('MMM')}
              </div>
            ))}
          </div>
          </div>
          </div>

          <div className="flex items-center gap-5 flex-wrap mt-4 pt-3.5 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <span className="w-5 h-0 border-t-[1.5px] border-dashed" style={{ borderColor: ABOVE_AVG }} />
              <span className="text-[12.5px] font-medium text-gray-700">Avg / month</span>
              <span className="text-[12.5px] text-gray-400">{money(view.avgMonth)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px]" style={{ color: ABOVE_AVG }}>●</span>
              <span className="text-[12.5px] text-gray-400">
                An amber month total is more than 15% above that average
              </span>
            </div>
            <div className="hidden lg:block text-[12.5px] text-gray-400 ml-auto">
              Bars are stacked by {noun}, tallest series at the bottom
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
