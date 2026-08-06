import { useMemo, useState } from 'react'
import { buildDonutModel } from '../../utils/netWorthChartModel.js'
import { buildAccountTypeColors, UNKNOWN_ACCOUNT } from '../dashboard/palette.js'
import { money } from './format.js'

/**
 * How the portfolio divides across account types.
 *
 * Hand-built SVG through the shared `buildDonutModel`, and coloured through the Dashboard's
 * `buildAccountTypeColors`, so a TFSA slice here is the same colour as the TFSA slice on the
 * Dashboard's composition donut. Two donuts of the same accounts in different colours on adjacent
 * tabs would read as two different breakdowns.
 *
 * Colours are assigned over the FULL type list, never a filtered one, so selecting an account chip
 * cannot recolour the slices.
 */
export default function AllocationDonut({ rollup, totalValue }) {
  const [hover, setHover] = useState(null)

  const colors = useMemo(() => buildAccountTypeColors(rollup.map(r => r.name)), [rollup])
  const model = useMemo(() => buildDonutModel(rollup), [rollup])

  const colorOf = row => colors[row.name] ?? UNKNOWN_ACCOUNT

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-[15px] font-semibold text-gray-900">Allocation</h2>
      <p className="text-[12.5px] leading-relaxed text-gray-400">By account type · all holdings</p>

      {model.empty ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-gray-400">
          No holdings yet
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5">
          <div className="relative w-full max-w-[190px]">
            <svg viewBox="0 0 200 200" className="block w-full" role="img" aria-label="Portfolio allocation by account type">
              {model.segments.map(segment => (
                <path
                  key={segment.key}
                  d={segment.path}
                  fill={colorOf(segment)}
                  className="transition-opacity duration-200"
                  opacity={hover && hover !== segment.key ? 0.35 : 1}
                  stroke={hover === segment.key ? '#1f2937' : 'none'}
                  strokeWidth={hover === segment.key ? 1.5 : 0}
                  onMouseEnter={() => setHover(segment.key)}
                  onMouseLeave={() => setHover(h => (h === segment.key ? null : h))}
                />
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[19px] font-semibold leading-tight text-gray-900">{money(totalValue)}</p>
              <p className="text-[11px] text-gray-400">portfolio</p>
            </div>
          </div>

          <ul className="w-full space-y-2.5">
            {rollup.map(row => (
              <li
                key={row.key}
                onMouseEnter={() => setHover(row.key)}
                onMouseLeave={() => setHover(h => (h === row.key ? null : h))}
                className={`transition-opacity ${hover && hover !== row.key ? 'opacity-40' : 'opacity-100'}`}
              >
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(row) }} />
                    <span className="truncate font-medium text-gray-700">{row.name}</span>
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
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
