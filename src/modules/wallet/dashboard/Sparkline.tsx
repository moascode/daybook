interface SparklineProps {
  values: number[]
  color: string
  width?: number
  height?: number
}

/**
 * A trend line small enough to sit inside a table cell or a stat tile.
 *
 * Decorative by design: it carries shape, not values, so it is aria-hidden and
 * every figure it hints at is also present as text next to it.
 */
export function Sparkline({ values, color, width = 84, height = 22 }: SparklineProps) {
  if (values.length < 2) return <span className="text-xs text-fg-faint">—</span>

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 6) + 3
    const y = height - 4 - ((v - min) / span) * (height - 9)
    return [x, y] as const
  })
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  )
}
