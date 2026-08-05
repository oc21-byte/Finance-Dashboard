import { useMemo, useState } from 'react'
import { buildComposition, BUCKET_LABELS } from '../../utils/liquidNetWorth.js'
import { buildDonutModel } from '../../utils/netWorthChartModel.js'
import { BUCKETS, buildAccountTypeColors, UNKNOWN_ACCOUNT } from './palette.js'

const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString()

/**
 * What liquid net worth is made of, today.
 *
 * Cash and Savings are one slice each; investments split by account type, because that is the only
 * finer grain the data actually has. Clicking a slice highlights its PARENT BUCKET in the trend —
 * the stored history has three bands and no memory of account types, so a TFSA slice can only
 * light the portfolio band. Promising more than that would mean inventing history.
 *
 * Colours come from `buildAccountTypeColors` over the FULL list of account types, never the
 * filtered one, so selecting a slice cannot recolour its neighbours.
 */
export default function CompositionDonut({
  cash = 0,
  savings = 0,
  holdings = [],
  prices = {},
  pricesFetching = false,
  highlight = null,
  onHighlight,
}) {
  const [hover, setHover] = useState(null)

  const rows = useMemo(
    () => buildComposition({ cash, savings, holdings, prices }),
    [cash, savings, holdings, prices],
  )

  const accountColors = useMemo(
    () => buildAccountTypeColors(holdings.map(h => h.accountType ?? 'Non-Registered')),
    [holdings],
  )

  const colorOf = row => (row.bucket === 'portfolio'
    ? accountColors[row.name] ?? UNKNOWN_ACCOUNT
    : BUCKETS[row.bucket].fill)

  const model = useMemo(() => buildDonutModel(rows), [rows])
  const active = hover ?? (highlight ? rows.find(r => r.bucket === highlight)?.key ?? null : null)

  // Dim by parent bucket, not by slice: with three investment account types selected, "Portfolio"
  // means all three, and fading two of them would contradict the trend band it just lit.
  const dimmed = row => highlight !== null && row.bucket !== highlight

  if (model.empty) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 className="text-[15px] font-semibold text-gray-900">What it&apos;s made of</h2>
        <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
          No balances yet
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 className="text-[15px] font-semibold text-gray-900">What it&apos;s made of</h2>
      <p className="text-[12.5px] leading-relaxed text-gray-400">
        Today{onHighlight ? ' · click a slice to filter the trend' : ''}
      </p>

      <div className="mt-4 flex flex-col items-center gap-5">
        <div className="relative w-full max-w-[200px]">
          <svg viewBox="0 0 200 200" className="block w-full" role="img" aria-label="Composition of liquid net worth">
            {model.segments.map(segment => {
              const on = active === segment.key
              return (
                <path
                  key={segment.key}
                  d={segment.path}
                  fill={colorOf(segment)}
                  className={`transition-opacity duration-200 ${onHighlight ? 'cursor-pointer' : ''}`}
                  opacity={dimmed(segment) ? 0.25 : 1}
                  stroke={on ? '#1f2937' : 'none'}
                  strokeWidth={on ? 1.5 : 0}
                  onMouseEnter={() => setHover(segment.key)}
                  onMouseLeave={() => setHover(h => (h === segment.key ? null : h))}
                  onClick={() => onHighlight?.(highlight === segment.bucket ? null : segment.bucket)}
                />
              )
            })}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[19px] font-semibold leading-tight text-gray-900">{money(model.total)}</p>
            <p className="text-[11px] text-gray-400">liquid</p>
          </div>
        </div>

        <ul className="w-full space-y-2.5">
          {rows.map(row => (
            <li key={row.key}>
              <button
                onClick={() => onHighlight?.(highlight === row.bucket ? null : row.bucket)}
                onMouseEnter={() => setHover(row.key)}
                onMouseLeave={() => setHover(h => (h === row.key ? null : h))}
                aria-pressed={highlight === row.bucket}
                className={`w-full text-left transition-opacity ${dimmed(row) ? 'opacity-40' : 'opacity-100'} ${
                  onHighlight ? 'hover:opacity-100' : 'cursor-default'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(row) }} />
                    <span className="truncate font-medium text-gray-700">{row.name}</span>
                    {row.bucket === 'portfolio' && (
                      <span className="shrink-0 text-[10px] text-gray-300">{BUCKET_LABELS.portfolio}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-medium text-gray-900">{money(row.value)}</span>
                    <span className="ml-1.5 text-[11px] text-gray-400">{row.pct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${row.pct}%`, background: colorOf(row) }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>

        {pricesFetching && <p className="w-full text-[11px] text-gray-400">Fetching live prices…</p>}
      </div>
    </div>
  )
}
