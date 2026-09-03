import { Link } from 'react-router-dom'
import { cn, formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { transactionsLink } from './links'
import { useDashboardChartColors } from './chartColors'
import type { CategoryDelta } from './insights'

interface WhatChangedProps {
  rows: CategoryDelta[]
  /** Total movement — the rows sum to this. */
  netDelta: number
  /** Full clause naming what each row is compared against, e.g. "its own 3-month average for the first 18 days of a month" or "the same length immediately before it". */
  comparisonDescription: string
  /**
   * The FULL window behind every number on this panel — from the start of the
   * earliest comparison period through the end of the current one. Deliberately
   * wider than the current period alone: a row's delta is computed against a
   * baseline outside that period, so a link scoped to only the current period
   * would land on a total that matches neither the delta nor the baseline it
   * was compared against, and reads as "the amount is wrong."
   */
  dateFrom: string
  dateTo: string
  className?: string
}

/** Biggest same-direction movers to name in the callout, before falling back to "N categories." */
const MAX_NAMED_MOVERS = 2

/** Below this, a leftover remainder reads as rounding noise, not a real "everything else." */
const REMAINDER_NOISE_FLOOR = 1

function buildCallout(rows: CategoryDelta[], netDelta: number): string | null {
  if (Math.abs(netDelta) < 0.005) return null

  const direction = netDelta > 0 ? 'over' : 'under'
  const verb = direction === 'over' ? 'overspend' : 'drop in spending'
  const sign = (n: number) => (n >= 0 ? '+' : '−')

  const sameDirection = rows
    .filter((r) => Math.sign(r.delta) === Math.sign(netDelta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  if (sameDirection.length === 0) return null

  const named = sameDirection.slice(0, MAX_NAMED_MOVERS)
  const namedSum = named.reduce((sum, r) => sum + r.delta, 0)
  const remainder = netDelta - namedSum

  const names =
    named.length === 1
      ? `${named[0].name} alone`
      : named
          .map((r) => `${r.name} (${sign(r.delta)}${formatMYR(Math.abs(r.delta)).replace('RM', '').trim()})`)
          .join(' and ')

  const whole = Math.abs(remainder) < REMAINDER_NOISE_FLOOR
  const lead =
    named.length === 1
      ? `${names} explains ${whole ? 'the whole' : 'most of the'} ${verb}: ${formatMYR(Math.abs(named[0].delta))}.`
      : `${named.length} categories ${whole ? 'explain the whole' : 'are driving the'} ${verb}: ${names}.`

  if (whole) return lead
  return `${lead} Everything else nets out to ${sign(remainder)}${formatMYR(Math.abs(remainder))}.`
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
  comparisonDescription,
  dateFrom,
  dateTo,
  className,
}: WhatChangedProps) {
  const colors = useDashboardChartColors()
  const scale = Math.max(...rows.map((r) => Math.abs(r.delta)), 1)

  const movers = rows.filter((r) => Math.abs(r.delta) >= 0.005)
  if (movers.length === 0) {
    return (
      <DashboardCard title="What changed" subtitle={`Each category against ${comparisonDescription}.`} className={className}>
        <p className="py-6 text-center text-sm text-fg-subtle">
          Nothing has moved against your usual pattern this period.
        </p>
      </DashboardCard>
    )
  }

  const callout = buildCallout(movers, netDelta)

  return (
    <DashboardCard
      title="What changed"
      subtitle={`Each category against ${comparisonDescription}. The bars add up to ${
        netDelta >= 0 ? '+' : '−'
      }${formatMYR(Math.abs(netDelta))}.`}
      className={cn('flex flex-col', className)}
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

      <ul className="flex flex-col gap-1" data-testid="what-changed">
        {movers.map((row) => {
          const over = row.delta >= 0
          const width = `${(Math.abs(row.delta) / scale) * 100}%`
          const label = `${over ? '▲ +' : '▼ −'}${formatMYR(Math.abs(row.delta)).replace('RM', '').trim()}`

          return (
            <li key={row.id} data-testid="what-changed-row">
              <Link
                to={transactionsLink({ categoryId: row.id, dateFrom, dateTo })}
                className="block rounded-lg px-1.5 py-1 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                aria-label={`${row.name}: ${over ? 'over' : 'under'} your usual by ${formatMYR(
                  Math.abs(row.delta),
                )}. Spent ${formatMYR(row.amount)} against a usual ${formatMYR(row.usual)}. Open transactions.`}
              >
                <div className="grid min-h-[1.5rem] grid-cols-[minmax(5.5rem,7.5rem)_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-2 sm:gap-3">
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
                </div>
                {/* The delta chip alone invited "is this the right number?" —
                    naming both figures it's built from makes it checkable at a glance. */}
                <p className="pl-0.5 text-right text-[11px] text-fg-faint">
                  {formatMYR(row.amount)} spent vs {formatMYR(row.usual)} usual
                </p>
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Pushed down as one unit — the caption and the optional callout must
          move together so the callout (when present) never lands past the
          card's own bottom edge. */}
      <div className="mt-auto">
        <p className="border-t border-line-subtle pt-3 text-center text-[11px] text-fg-faint">
          your usual
        </p>

        {callout && (
          <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
            {callout}
          </p>
        )}
      </div>
    </DashboardCard>
  )
}
