import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { cn, formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { transactionsLink } from './links'
import { useDashboardChartColors } from './chartColors'
import { categoryDonutSlices, EVERYTHING_ELSE_ID, type CategorySpend } from './insights'

interface CategoryBreakdownProps {
  rows: CategorySpend[]
  total: number
  dateFrom: string
  dateTo: string
  className?: string
}

// Percentages, not fixed pixels — Recharts scales these against the
// container's own min(width, height)/2, so the donut actually shrinks on a
// narrow card instead of clipping past a hardcoded pixel radius.
const OUTER_RADIUS = '80%'
const INNER_RADIUS = '54%'

/**
 * A donut, not the ranked bar list this card used to be — the owner's call,
 * overriding that file's prior design note. The centre carries the month
 * total; the direct-labelled legend below does the ranking work the bars used
 * to do, and still links each row into its transactions.
 */
export function CategoryBreakdown({
  rows,
  total,
  dateFrom,
  dateTo,
  className,
}: CategoryBreakdownProps) {
  const colors = useDashboardChartColors()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const slices = categoryDonutSlices(rows, total)

  // The synthetic "Everything else" slice and the real "Uncategorised" row
  // both have no user-chosen colour (`slice.color === null`) — give them
  // DIFFERENT neutrals so two unrelated slices never render identically.
  const colorFor = (slice: (typeof slices)[number]) => {
    if (slice.color) return slice.color
    return slice.id === EVERYTHING_ELSE_ID ? colors.usual : colors.ghost
  }

  const ariaLabel = `Where it goes. Total ${formatMYR(total)}. ${slices
    .map((s) => `${s.name}: ${formatMYR(s.amount)}, ${s.share.toFixed(0)} percent`)
    .join('; ')}.`

  return (
    <DashboardCard
      className={cn('flex flex-col', className)}
      title="Where it goes"
      subtitle="Spending by category this period."
      action={{ label: 'Transactions', to: transactionsLink({ dateFrom, dateTo }) }}
    >
      <div data-testid="category-breakdown">
        {slices.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-subtle">No spending in this period yet.</p>
        ) : (
          <>
            <div
              className="relative mx-auto h-[200px] w-full max-w-[220px]"
              role="img"
              aria-label={ariaLabel}
              data-testid="category-donut"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={INNER_RADIUS}
                    outerRadius={OUTER_RADIUS}
                    paddingAngle={1}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {slices.map((slice) => {
                      const isHovered = hoveredId === slice.id
                      const faded = hoveredId !== null && !isHovered
                      return (
                        <Cell
                          key={slice.id}
                          fill={colorFor(slice)}
                          fillOpacity={faded ? 0.5 : 1}
                          stroke={isHovered ? colorFor(slice) : 'none'}
                          strokeWidth={isHovered ? 6 : 0}
                          onMouseEnter={() => setHoveredId(slice.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        />
                      )
                    })}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] text-fg-subtle">Total</span>
                <span className="text-sm font-semibold tabular-nums text-fg">{formatMYR(total)}</span>
              </div>
            </div>

            <ul className="mt-4 flex flex-col gap-0.5">
              {slices.map((slice) => {
                const isEverythingElse = slice.id === EVERYTHING_ELSE_ID
                const isHovered = hoveredId === slice.id
                const faded = hoveredId !== null && !isHovered
                const rowClassName =
                  'grid min-h-[2.25rem] grid-cols-[minmax(0,1fr)_minmax(4.5rem,auto)_minmax(3rem,auto)] items-center gap-2 rounded-lg px-1.5 py-1 transition-opacity sm:gap-3'
                const rowStyle = { opacity: faded ? 0.5 : 1 }

                const swatchAndName = (
                  <span className="flex min-w-0 items-center gap-2">
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: colorFor(slice) }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-xs text-fg sm:text-[13px]">{slice.name}</span>
                  </span>
                )

                const amountAndShare = (
                  <>
                    <span className="text-right text-xs font-semibold tabular-nums text-fg">
                      {formatMYR(slice.amount)}
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-fg-subtle">
                      {slice.share.toFixed(0)}%
                    </span>
                  </>
                )

                return (
                  <li
                    key={slice.id}
                    data-testid="category-donut-legend-row"
                    onMouseEnter={() => setHoveredId(slice.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {isEverythingElse ? (
                      <div className={rowClassName} style={rowStyle}>
                        {swatchAndName}
                        {amountAndShare}
                      </div>
                    ) : (
                      <Link
                        to={transactionsLink({ categoryId: slice.id, dateFrom, dateTo })}
                        className={`${rowClassName} hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500`}
                        style={rowStyle}
                        aria-label={`${slice.name}: ${formatMYR(slice.amount)}, ${slice.share.toFixed(
                          0,
                        )} percent. Open transactions.`}
                      >
                        {swatchAndName}
                        {amountAndShare}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <p className="mt-auto border-t border-line-subtle pt-3 text-xs text-fg-subtle">
        Totals to <span className="font-semibold text-fg">{formatMYR(total)}</span> — the same
        figure as the headline, uncategorised included.
      </p>
    </DashboardCard>
  )
}
