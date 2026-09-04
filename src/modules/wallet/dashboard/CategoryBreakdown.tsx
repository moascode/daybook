import { useState } from 'react'
import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { categoryDonutSlices, EVERYTHING_ELSE_ID, type CategorySpend } from './insights'

interface CategoryBreakdownProps {
  rows: CategorySpend[]
  total: number
  className?: string
}

const RADIUS = 70
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Cycles the mockup's donut hue sequence for slices with no user-chosen colour. */
const FALLBACK_HUES = [
  'rgb(var(--info))',
  'rgb(var(--calm))',
  'rgb(var(--alt))',
  'rgb(var(--b-400))',
  'rgb(var(--warn))',
  'rgb(var(--t-400))',
]

/**
 * A literal port of the mockup's hand-drawn donut: concentric `<circle>`
 * elements with `stroke-dasharray`/`stroke-dashoffset`, not a charting
 * library. The centre carries the period total; the legend below ranks each
 * slice and still links into its transactions.
 */
export function CategoryBreakdown({ rows, total, className }: CategoryBreakdownProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const slices = categoryDonutSlices(rows, total)

  let fallbackIndex = 0
  const colorFor = (slice: (typeof slices)[number]) => {
    if (slice.color) return slice.color
    if (slice.id === EVERYTHING_ELSE_ID) return 'rgb(var(--fg-faint) / .55)'
    return FALLBACK_HUES[fallbackIndex++ % FALLBACK_HUES.length]
  }

  const ariaLabel = `Spending by category: ${slices
    .map((s) => `${s.name} ${s.share.toFixed(1)}%`)
    .join(', ')}.`

  let offset = 0

  return (
    <DashboardCard
      className={className}
      title="Where it goes"
      subtitle="Share of everything spent this period."
      action={{ label: 'Full report', to: '/wallet/reports' }}
    >
      <div data-testid="category-breakdown">
        {slices.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-subtle">No spending in this period yet.</p>
        ) : (
          <div className="donut-wrap">
            <div className="donut" data-testid="category-donut">
              <svg viewBox="0 0 176 176" role="img" aria-label={ariaLabel}>
                <circle cx="88" cy="88" r={RADIUS} stroke="rgb(var(--track))" />
                {slices.map((slice) => {
                  const len = (slice.share / 100) * CIRCUMFERENCE
                  const dashoffset = -offset
                  offset += len
                  const isHovered = hoveredId === slice.id
                  const faded = hoveredId !== null && !isHovered
                  return (
                    <circle
                      key={slice.id}
                      cx="88"
                      cy="88"
                      r={RADIUS}
                      stroke={colorFor(slice)}
                      strokeDasharray={`${len} ${CIRCUMFERENCE}`}
                      strokeDashoffset={dashoffset}
                      opacity={faded ? 0.5 : 1}
                      onMouseEnter={() => setHoveredId(slice.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    />
                  )
                })}
              </svg>
              <div className="donut-center">
                <span className="k">THIS PERIOD</span>
                <span className="v">{formatMYR(total)}</span>
              </div>
            </div>
            <div className="donut-legend">
              {slices.map((slice) => (
                <div
                  key={slice.id}
                  className="dl-row"
                  data-testid="category-donut-legend-row"
                  onMouseEnter={() => setHoveredId(slice.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ opacity: hoveredId !== null && hoveredId !== slice.id ? 0.5 : 1 }}
                >
                  <i style={{ background: colorFor(slice) }} />
                  <span className="n">{slice.name}</span>
                  <span className="a">{formatMYR(slice.amount)}</span>
                  <span className="p">{slice.share.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  )
}
