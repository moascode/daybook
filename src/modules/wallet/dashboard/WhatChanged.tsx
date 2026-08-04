import { Link } from 'react-router-dom'
import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { transactionsLink } from './links'
import { useDashboardChartColors } from './chartColors'
import { UNCATEGORISED, type CategoryDelta } from './insights'

interface WhatChangedProps {
  rows: CategoryDelta[]
  /** Total movement — the rows sum to this. */
  netDelta: number
  baselineMonths: number
  dateFrom: string
  dateTo: string
  dayLabel: string
}

/**
 * Every category against its own baseline, biggest overspend first.
 *
 * Drawn with plain elements rather than a chart library on purpose: the value
 * label sits outside the bar end, and a charting library measures neither the
 * label nor the container, so the longest bar's label is the one that gets
 * clipped. Here the bar is capped at half the track and the label lives in its
 * own column, so it cannot collide at any width.
 */
export function WhatChanged({
  rows,
  netDelta,
  baselineMonths,
  dateFrom,
  dateTo,
  dayLabel,
}: WhatChangedProps) {
  const colors = useDashboardChartColors()
  const scale = Math.max(...rows.map((r) => Math.abs(r.delta)), 1)

  const movers = rows.filter((r) => Math.abs(r.delta) >= 0.005)
  if (movers.length === 0) {
    return (
      <DashboardCard
        title="What changed"
        subtitle={`Every category against its own average for the same point in the month.`}
      >
        <p className="py-6 text-center text-sm text-fg-subtle">
          Nothing has moved against your usual pattern this period.
        </p>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard
      title="What changed"
      subtitle={`Each category against its own ${baselineMonths}-month average ${dayLabel}. The bars add up to ${
        netDelta >= 0 ? '+' : '−'
      }${formatMYR(Math.abs(netDelta))}.`}
    >
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full" style={{ background: colors.over }} />
          Over your usual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full" style={{ background: colors.under }} />
          Under your usual
        </span>
      </div>

      <ul className="flex flex-col gap-0.5" data-testid="what-changed">
        {movers.map((row) => {
          const over = row.delta >= 0
          const width = `${(Math.abs(row.delta) / scale) * 100}%`
          const label = `${over ? '▲ +' : '▼ −'}${formatMYR(Math.abs(row.delta)).replace('RM', '').trim()}`

          return (
            <li key={row.id}>
              <Link
                to={transactionsLink({
                  categoryId: row.id === UNCATEGORISED ? undefined : row.id,
                  dateFrom,
                  dateTo,
                })}
                className="grid min-h-[2.25rem] grid-cols-[minmax(5.5rem,7.5rem)_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:gap-3"
                aria-label={`${row.name}: ${over ? 'over' : 'under'} your usual by ${formatMYR(
                  Math.abs(row.delta),
                )}. Spent ${formatMYR(row.amount)} against a usual ${formatMYR(row.usual)}. Open transactions.`}
              >
                <span className="truncate text-xs text-fg sm:text-[13px]">{row.name}</span>

                {/* Two mirrored halves with a hairline between them: the bar
                    grows away from the centre, so sign is carried by direction
                    as well as by colour. */}
                <span className="flex h-3 items-stretch">
                  <span className="flex w-1/2 justify-end">
                    {!over && (
                      <span
                        className="rounded-l"
                        style={{ width, background: colors.under }}
                      />
                    )}
                  </span>
                  <span className="w-px shrink-0 bg-line-strong" aria-hidden="true" />
                  <span className="flex w-1/2 justify-start">
                    {over && (
                      <span
                        className="rounded-r"
                        style={{ width, background: colors.over }}
                      />
                    )}
                  </span>
                </span>

                <span
                  className="text-right text-xs font-semibold tabular-nums"
                  style={{ color: over ? colors.over : colors.under }}
                >
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t border-line-subtle pt-3 text-center text-[11px] text-fg-faint">
        your usual
      </p>
    </DashboardCard>
  )
}
