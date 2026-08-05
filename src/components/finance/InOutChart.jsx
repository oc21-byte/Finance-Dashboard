import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { buildInOutModel, IN_OUT_MODES, PLOT_H, SERIES_COLORS } from '../../utils/financeChartModel.js'

const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString()

// Bar labels sit two-to-a-column in the in/out view, so they get a compact form. Everything else on
// the page — legend totals, tooltips, KPIs — stays exact; this is only the value written on a bar.
function compact(n) {
  const abs = Math.abs(n)
  if (abs < 1000) return (n < 0 ? '−$' : '$') + Math.round(abs)
  const thousands = abs / 1000
  const digits = thousands < 10 ? 1 : 0
  return (n < 0 ? '−$' : '$') + thousands.toFixed(digits).replace(/\.0$/, '') + 'k'
}

// Below this a month column gets too narrow to read, so the plot scrolls instead of compressing.
const MIN_MONTH_W = 52

// The flow values `applyFinanceFilters` matches on. `bankFlowOf` returns the singular forms, so a
// chip written here has to use them verbatim or it would filter every row away.
const SERIES_FLOW = { income: 'income', expenses: 'expense' }

/**
 * Income above the line, spending below it, net cash as a line across the top.
 *
 * All geometry comes from `buildInOutModel`; this file positions and labels it. Hand-built rather
 * than charted so it matches the rest of the app's visuals — nothing under `components/spend/` or
 * `components/finance/` uses a chart library.
 *
 * Interaction mirrors `SpendOverTime`: hovering a bar or a legend row lifts that series and fades
 * the rest, and clicking either one filters the whole page. Only the in/out view is clickable — in
 * the other two views a bar is a net figure, which is not a row property and so cannot be filtered.
 */
export default function InOutChart({ bankRows, cardCredits, countCredits, range, subtitle, filters, onFilter }) {
  const [mode, setMode] = useState('in_out')
  const [hovered, setHovered] = useState(null)

  const model = useMemo(
    () => buildInOutModel(bankRows, range.months, { mode, cardCredits, countCredits }),
    [bankRows, range.months, mode, cardCredits, countCredits],
  )

  const months = range.months
  const plotMinWidth = months.length * MIN_MONTH_W
  const singleSeries = mode !== 'in_out'
  const interactive = !singleSeries && typeof onFilter === 'function'

  const activeFlows = filters?.flows ?? []
  const isOn = series => activeFlows.includes(SERIES_FLOW[series])

  // Dim everything that isn't the series under the cursor. With nothing hovered but one flow
  // filtered, that flow stays lifted so the chart and the page tell the same story.
  const onlyActive = ['income', 'expenses'].filter(isOn)
  const focus = hovered ?? (interactive && onlyActive.length === 1 ? onlyActive[0] : null)
  const dimmed = series => focus !== null && series !== focus

  const hoverProps = series => (interactive
    ? {
        onMouseEnter: () => setHovered(series),
        onMouseLeave: () => setHovered(h => (h === series ? null : h)),
      }
    : {})

  // In/out totals come straight off the model. The single-value views stack a signed figure, so
  // "above the line" there totals the surplus months and "below" the shortfall ones — and in the
  // cumulative view neither sum means anything, since the bars are already running totals.
  const legendAmount = series => {
    if (mode === 'cumulative') return null
    if (mode === 'net_only') {
      const side = series === 'income' ? 'up' : 'down'
      if (series === 'net') return null
      return model.bars.reduce((s, b) => s + b[side], 0)
    }
    return model.totals[series === 'net' ? 'net' : series]
  }

  const ending = model.bars.length ? model.bars[model.bars.length - 1].cumulative : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-5 mb-1 flex-wrap">
        <h2 className="text-[15px] font-semibold text-gray-900">Money in vs money out</h2>
        <div className="flex gap-1.5">
          {IN_OUT_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setHovered(null) }}
              aria-pressed={m.key === mode}
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
        {mode === 'in_out' && 'Income above the line, spending below it. The dark line is net cash each month.'}
        {mode === 'net_only' && 'What each month kept — income minus expenses, with shortfalls below the line.'}
        {mode === 'cumulative' && 'Net cash added up across the period, so you can see where the trend turned.'}
        {interactive && (
          <span className="text-gray-500 font-medium">
            {' '}Click a bar or a legend row to filter the whole page to money in or money out.
          </span>
        )}
        {subtitle ? ` ${subtitle}` : ''}
      </p>

      {model.empty ? (
        <div className="py-14 text-center">
          <p className="text-sm text-gray-400">No bank activity in this scope.</p>
          <p className="mt-1 text-xs text-gray-300">
            {months.length} month{months.length === 1 ? '' : 's'} selected — widen the period, or clear a filter.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div style={{ minWidth: plotMinWidth }}>
              <div className="isolate relative px-2.5 border-l border-r border-gray-200" style={{ height: PLOT_H }}>
                <div className="absolute inset-0 -z-10 flex flex-col justify-between pointer-events-none">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="border-t border-dashed border-gray-100" />
                  ))}
                </div>

                {/* The zero line. Every bar and every net point is positioned against this. */}
                <div
                  className="absolute left-0 right-0 border-t border-gray-300 pointer-events-none"
                  style={{ top: model.baselineY }}
                />

                <div className="absolute inset-0 flex px-2.5">
                  {model.bars.map(bar => (
                    <div
                      key={bar.month}
                      className="group flex-1 relative min-w-0"
                      title={tooltip(bar, mode, interactive)}
                    >
                      {/* Column hover tint, behind the bars so it reads as a highlighted month. */}
                      <div className="absolute inset-0 bg-gray-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                      {/* Above the baseline, grown upward from it. */}
                      <Bar
                        series="income"
                        // Green above the line reads as income in the paired view and as a surplus
                        // in the single-value views — same meaning either way.
                        color={SERIES_COLORS.income}
                        height={bar.upHeight}
                        style={{ top: model.baselineY - bar.upHeight, borderRadius: '4px 4px 0 0' }}
                        value={bar.up}
                        labelStyle={{ top: model.baselineY - bar.upHeight - 15 }}
                        interactive={interactive}
                        dimmed={dimmed('income')}
                        selected={isOn('income')}
                        onFilter={onFilter}
                        hoverProps={hoverProps('income')}
                      />
                      {/* Below it, grown downward. */}
                      <Bar
                        series="expenses"
                        color={SERIES_COLORS.expenses}
                        height={bar.downHeight}
                        style={{ top: model.baselineY, borderRadius: '0 0 4px 4px' }}
                        value={bar.down}
                        labelStyle={{ top: model.baselineY + bar.downHeight + 2 }}
                        interactive={interactive}
                        dimmed={dimmed('expenses')}
                        selected={isOn('expenses')}
                        onFilter={onFilter}
                        hoverProps={hoverProps('expenses')}
                      />
                    </div>
                  ))}
                </div>

                {/* Net line. Percentage x-coords track the flex columns under any width. */}
                {model.netPoints.length > 1 && (
                  <svg
                    viewBox={`0 0 100 ${PLOT_H}`}
                    preserveAspectRatio="none"
                    className={`absolute inset-0 w-full h-full pointer-events-none z-[2] transition-opacity ${
                      focus ? 'opacity-25' : 'opacity-100'
                    }`}
                  >
                    <polyline
                      points={model.netPoints.map(p => `${p.xPct},${p.y}`).join(' ')}
                      fill="none"
                      stroke={SERIES_COLORS.net}
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
              </div>

              {/* Inside the scroll container so a label stays under its own bar. */}
              <div className="flex px-2.5 pt-2 border-t border-gray-200">
                {model.bars.map(bar => (
                  <div key={bar.month} className="flex-1 text-center text-xs text-gray-500 min-w-0">
                    {dayjs(bar.month + '-01').format('MMM')}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-4 pt-3.5 border-t border-gray-100">
            {model.legend
              .filter(item => !(singleSeries && item.key === 'net'))
              .map(item => {
                const amount = legendAmount(item.key)
                const selected = interactive && isOn(item.key)
                const clickable = interactive && item.key !== 'net'
                return (
                  <button
                    key={item.key}
                    disabled={!clickable}
                    onClick={() => onFilter('flows', SERIES_FLOW[item.key])}
                    {...(clickable ? hoverProps(item.key) : {})}
                    title={
                      clickable
                        ? `${selected ? 'Remove the' : 'Filter the page to'} money ${item.key === 'income' ? 'in' : 'out'}`
                        : undefined
                    }
                    className={`flex items-center gap-2 rounded-md border px-2 py-1 transition-all ${
                      clickable ? 'cursor-pointer' : 'cursor-default'
                    } ${
                      selected
                        ? 'bg-blue-50 border-blue-200'
                        : focus === item.key
                          ? 'bg-gray-100 border-gray-200'
                          : 'bg-white border-transparent'
                    } ${dimmed(item.key) && item.key !== 'net' ? 'opacity-40' : 'opacity-100'}`}
                  >
                    <span
                      className={item.line ? 'w-5 h-[3px] rounded' : 'rounded-sm'}
                      style={
                        item.line
                          ? { background: item.color }
                          : {
                              background: item.color,
                              width: focus === item.key || selected ? 12 : 10,
                              height: focus === item.key || selected ? 12 : 10,
                            }
                      }
                    />
                    <span className={`text-[12.5px] font-medium ${selected ? 'text-blue-800' : 'text-gray-700'}`}>
                      {singleSeries ? (item.key === 'income' ? 'Surplus' : 'Shortfall') : item.label}
                    </span>
                    {amount !== null && (
                      <span className={`text-[12.5px] tabular-nums ${selected ? 'text-blue-600' : 'text-gray-500'}`}>
                        {money(amount)}
                      </span>
                    )}
                  </button>
                )
              })}
            <div className="hidden lg:block text-[12.5px] text-gray-400 ml-auto">
              {mode === 'cumulative'
                ? `Ends at ${money(ending)} across ${months.length} month${months.length === 1 ? '' : 's'}`
                : 'One scale above and below the line'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One half of a month column, plus the value written just outside it.
 *
 * Rendered as a button only when the page can act on the click; otherwise it stays a div so the
 * keyboard doesn't collect a tab stop per month that does nothing.
 */
function Bar({
  series, color, height, style, value, labelStyle, interactive, dimmed, selected, onFilter, hoverProps,
}) {
  const Tag = interactive ? 'button' : 'div'
  return (
    <>
      <Tag
        {...(interactive ? { onClick: () => onFilter('flows', SERIES_FLOW[series]), ...hoverProps } : {})}
        className={`absolute w-[46%] max-w-[56px] left-1/2 -translate-x-1/2 transition-opacity ${
          interactive ? 'cursor-pointer' : ''
        } ${dimmed ? 'opacity-25' : 'opacity-100'}`}
        style={{
          height,
          background: color,
          // An outline rather than a border: a border would change the bar's height and so
          // misreport the month.
          outline: selected ? '2px solid #1d4ed8' : 'none',
          outlineOffset: '-1px',
          ...style,
        }}
      />
      {value > 0 && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 text-[10.5px] font-semibold tabular-nums whitespace-nowrap pointer-events-none transition-opacity ${
            dimmed ? 'opacity-0' : 'opacity-100'
          } text-gray-500`}
          style={labelStyle}
        >
          {compact(value)}
        </div>
      )}
    </>
  )
}

function tooltip(bar, mode, interactive) {
  const month = dayjs(bar.month + '-01').format('MMMM YYYY')
  if (!bar.hasActivity) return `${month} — no bank activity`
  const suffix = interactive ? ' · click a bar to filter' : ''
  if (mode === 'cumulative') return `${month} — ${money(bar.cumulative)} cumulative net`
  if (mode === 'net_only') return `${month} — ${money(bar.net)} net`
  return `${month} — ${money(bar.income)} in, ${money(bar.expenses)} out, ${money(bar.net)} net${suffix}`
}
