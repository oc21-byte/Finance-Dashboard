import { useMemo, useState } from 'react'
import { buildDonutModel } from '../../utils/netWorthChartModel.js'
import { exact } from './format.js'
import { buildHoldingColors, UNKNOWN_HOLDING } from './palette.js'

/**
 * Portfolio share of each holding, as a donut.
 *
 * The centre shows the largest holding by default and swaps to whichever slice is under the
 * cursor — weight and ticker only, so the hole stays readable. No legend: the ranked table
 * beside this card already lists every position, and repeating it here would just fill the
 * column the mockup leaves empty with the ring.
 *
 * Drawn from the unfiltered portfolio, matching Allocation above it. Account chips rescope the
 * table; both donuts keep the whole picture.
 */
export default function HoldingsWeightDonut({ rows = [] }) {
  const [hover, setHover] = useState(null)

  const colors = useMemo(
    () => buildHoldingColors(rows.map(r => r.ticker)),
    [rows],
  )

  // Rows arrive ranked by value from `buildInvestmentsModel`, so the largest holding starts at
  // twelve o'clock and is also the idle centre label — one sort, two readers.
  const slices = useMemo(
    () => rows.map(r => ({
      key: r.id,
      name: r.ticker,
      value: r.value,
      pct: r.weight,
    })),
    [rows],
  )

  const model = useMemo(() => buildDonutModel(slices), [slices])
  const active = (hover && slices.find(s => s.key === hover)) || slices[0] || null
  const colorOf = row => colors[row.name] ?? UNKNOWN_HOLDING

  if (model.empty) return null

  return (
    <div className="flex flex-col items-center">
      <div className="w-full">
        <h2 className="text-[15px] font-semibold text-gray-900">Holdings by weight</h2>
        <p className="text-[12.5px] leading-relaxed text-gray-400">Top positions · all holdings</p>
      </div>

      <div className="relative mt-4 w-full max-w-[190px]">
        <svg viewBox="0 0 200 200" className="block w-full" role="img" aria-label="Holdings by portfolio weight">
          {model.segments.map(segment => (
            <path
              key={segment.key}
              d={segment.path}
              fill={colorOf(segment)}
              className="cursor-default transition-opacity duration-200"
              opacity={hover && hover !== segment.key ? 0.35 : 1}
              stroke={hover === segment.key ? '#1f2937' : 'none'}
              strokeWidth={hover === segment.key ? 1.5 : 0}
              onMouseEnter={() => setHover(segment.key)}
              onMouseLeave={() => setHover(h => (h === segment.key ? null : h))}
            />
          ))}
        </svg>
        {active && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[19px] font-semibold leading-tight text-gray-900">
              {exact(active.pct, 1)}%
            </p>
            <p className="text-[11px] font-medium text-gray-400">{active.name}</p>
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-[11px] text-gray-400">
        Hover a slice for its ticker and weight
      </p>
    </div>
  )
}
