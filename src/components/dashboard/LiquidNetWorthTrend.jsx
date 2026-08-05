import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { buildTrendSeries, TREND_PERIODS, BUCKET_LABELS } from '../../utils/liquidNetWorth.js'
import { buildTrendModel, TREND_MODES, BAND_ORDER } from '../../utils/netWorthChartModel.js'
import { BUCKETS, TOTAL_LINE, TOTAL_FILL } from './palette.js'

const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString()

function axisLabel(v) {
  const abs = Math.abs(v)
  if (abs >= 1000) return `$${(abs / 1000).toFixed(abs < 10000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `$${Math.round(abs)}`
}

/**
 * Liquid net worth over time, as a stack of the three things it is made of.
 *
 * Its own range control, in calendar months — deliberately NOT the `PERIOD_KEYS` chips used by the
 * waterfall above it. Those anchor to the latest transaction, which is right for flows and wrong
 * here: a balance is current as of today whether or not this month's statement has landed.
 *
 * `highlight` comes from the donut beside it. Investment account types all roll up to `portfolio`,
 * so a slice can only ever light one of three bands — which is why the donut filters by parent
 * bucket rather than by slice.
 */
export default function LiquidNetWorthTrend({ history = [], highlight = null, onHighlight }) {
  const [period, setPeriod] = useState('6M')
  const [mode, setMode] = useState('stacked')
  const [hover, setHover] = useState(null)

  const points = useMemo(() => buildTrendSeries(history, period), [history, period])
  const model = useMemo(() => buildTrendModel(points, mode), [points, mode])

  const active = hover !== null ? model.columns[hover] : null
  const dimmed = key => highlight !== null && mode === 'stacked' && key !== highlight

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h2 className="text-[15px] font-semibold text-gray-900">Liquid net worth over time</h2>
        <div className="flex flex-wrap gap-1.5">
          <Segmented options={TREND_PERIODS.map(k => ({ key: k, label: k }))} value={period} onChange={setPeriod} />
          <Segmented options={TREND_MODES} value={mode} onChange={setMode} />
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-gray-400 max-w-[620px]">
        {mode === 'stacked'
          ? 'Cash, savings and investments stacked — the top edge is your liquid net worth.'
          : 'Liquid net worth alone, without the split.'}
        {' '}Calendar months, so this ends today rather than at your last statement.
      </p>

      {model.empty ? (
        <div className="flex items-center justify-center h-[220px] px-6 text-center text-sm text-gray-400">
          Your liquid net worth history will appear here as you use the app. Come back tomorrow to
          see your first data point.
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            {/* Axis labels live outside the plot so the plot itself stays a clean percentage box. */}
            <div className="relative w-11 shrink-0" style={{ height: model.height }}>
              {model.ticks.map(tick => (
                <span
                  key={tick.value}
                  className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-gray-400"
                  style={{ top: tick.y }}
                >
                  {axisLabel(tick.value)}
                </span>
              ))}
            </div>

            <div
              className="relative flex-1 min-w-0"
              style={{ height: model.height }}
              onMouseLeave={() => setHover(null)}
            >
              {model.ticks.map(tick => (
                <div
                  key={tick.value}
                  className="absolute inset-x-0 border-t border-dashed border-gray-100 pointer-events-none"
                  style={{ top: tick.y }}
                />
              ))}

              <svg
                viewBox={`0 0 100 ${model.height}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full"
                aria-hidden="true"
              >
                {model.bands.map(band => (
                  <polygon
                    key={band.key}
                    points={band.path}
                    fill={band.key === 'liquid' ? TOTAL_FILL : BUCKETS[band.key].fill}
                    className="transition-opacity duration-200"
                    opacity={dimmed(band.key) ? 0.2 : 1}
                  />
                ))}
                <polyline
                  points={model.line}
                  fill="none"
                  stroke={TOTAL_LINE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {active && (
                  <line
                    x1={active.xPct} x2={active.xPct} y1="0" y2={model.height}
                    stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>

              {/* Hit areas, one per point, spanning to the midpoint of each neighbour so hovering
                  anywhere gives you the nearest reading. Separate from the SVG because a
                  `preserveAspectRatio` of "none" distorts pointer geometry. */}
              {model.columns.map(column => (
                <div
                  key={column.date}
                  className="absolute inset-y-0"
                  style={{ left: `${column.hitFrom}%`, width: `${column.hitTo - column.hitFrom}%` }}
                  onMouseEnter={() => setHover(column.index)}
                  title={`${dayjs(column.date).format('MMM D, YYYY')} · ${money(column.liquid)}`}
                />
              ))}

              {active && (
                <div
                  className="pointer-events-none absolute z-10 w-44 rounded-lg border border-gray-200 bg-white p-2.5 shadow-lg"
                  style={{
                    left: `${active.xPct}%`,
                    top: 8,
                    // Flip the card back inside the plot near the right-hand edge rather than
                    // letting it hang off the card.
                    transform: active.xPct > 60 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
                  }}
                >
                  <p className="text-[11px] font-semibold text-gray-900">
                    {dayjs(active.date).format('MMM D, YYYY')}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-gray-900">{money(active.liquid)}</p>
                  {mode === 'stacked' && (
                    <ul className="mt-1.5 space-y-0.5">
                      {[...BAND_ORDER].reverse().map(key => (
                        <li key={key} className="flex items-center justify-between text-[11px] text-gray-500">
                          <span className="flex items-center gap-1.5">
                            <Swatch bucket={key} className="h-2 w-2 rounded-full" />
                            {BUCKET_LABELS[key]}
                          </span>
                          <span className="tabular-nums text-gray-700">{money(active[key])}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {active.basis === 'cost' && (
                    <p className="mt-1.5 text-[10px] leading-tight text-gray-400">
                      Investments valued at cost — no price was available for this date.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Labels are anchored to their point's own x, not to an even column, so each one sits
              under the reading it names. The two ends align inward so they cannot overhang the
              plot. */}
          <div className="mt-2 flex pl-[52px]">
            <div className="relative h-4 flex-1">
              {model.columns.filter(c => c.showLabel).map(column => (
                <span
                  key={column.date}
                  className="absolute whitespace-nowrap text-[10px] text-gray-400"
                  style={{
                    left: `${column.xPct}%`,
                    transform: column.index === 0
                      ? 'translateX(0)'
                      : column.index === model.columns.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                  }}
                >
                  {column.label}
                </span>
              ))}
            </div>
          </div>

          {mode === 'stacked' && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3">
              {[...BAND_ORDER].reverse().map(key => (
                <button
                  key={key}
                  onClick={() => onHighlight?.(highlight === key ? null : key)}
                  aria-pressed={highlight === key}
                  className={`flex items-center gap-1.5 text-[11.5px] transition-opacity ${
                    dimmed(key) ? 'opacity-40' : 'opacity-100'
                  } ${onHighlight ? 'hover:opacity-100' : 'cursor-default'}`}
                >
                  <Swatch bucket={key} className="h-2.5 w-2.5 rounded-sm" />
                  <span className="font-medium text-gray-600">{BUCKET_LABELS[key]}</span>
                </button>
              ))}
              <span className="flex items-center gap-1.5 text-[11.5px]">
                <span className="h-0.5 w-4 rounded-full" style={{ background: TOTAL_LINE }} />
                <span className="font-medium text-gray-600">Liquid net worth</span>
              </span>
              {highlight && (
                <button
                  onClick={() => onHighlight?.(null)}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                >
                  Show all
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A colour key for one band.
 *
 * Fill on the inside, stroke as a hairline ring. A key has one job — to match the ink it names —
 * so it takes the band's own fill; the ring is what keeps a pale fill visible against white,
 * without inventing a second colour for the same series.
 */
function Swatch({ bucket, className }) {
  return (
    <span
      className={`shrink-0 ${className}`}
      style={{ background: BUCKETS[bucket].fill, border: `1px solid ${BUCKETS[bucket].stroke}` }}
    />
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5">
      {options.map(option => (
        <button
          key={option.key}
          onClick={() => onChange(option.key)}
          aria-pressed={option.key === value}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            option.key === value
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
