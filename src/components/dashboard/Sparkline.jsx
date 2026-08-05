/**
 * A bare trend line for the KPI strip.
 *
 * Hand-rolled SVG rather than Recharts: this is decoration for a single number, with no axes,
 * tooltip or interaction, and a ResponsiveContainer per KPI tile costs a resize observer for
 * nothing. It scales to its own min/max, so it shows SHAPE, not magnitude — the value beside it
 * carries the magnitude.
 */
export default function Sparkline({ points = [], stroke = '#2563eb', height = 26 }) {
  if (points.length < 2) return <div style={{ height }} aria-hidden="true" />

  const values = points.map(p => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = 100 / (points.length - 1)

  // Inset vertically so a peak or trough is not clipped by the stroke's own width.
  const coords = values.map((v, i) => {
    const x = i * stepX
    const y = 2 + (1 - (v - min) / span) * (height - 4)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
