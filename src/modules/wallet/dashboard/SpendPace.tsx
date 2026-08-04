import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatMYR, formatAxisMYR } from '@/lib/utils'
import { useChartTheme } from '@/hooks/useChartTheme'
import { useDashboardChartColors } from './chartColors'

interface SpendPaceProps {
  /** Spend so far in the selected period. */
  spent: number
  /** The same measurement averaged over the baseline months. */
  usual: number
  /** Cumulative spend per day, day 1 first. Length = days elapsed. */
  curve: number[]
  /** The averaged baseline curve across the whole month. */
  baseline: number[]
  /** Where the month lands at the current rate. Omitted for a finished month. */
  projected?: number
  /** Average of the baseline months' full-month totals. */
  usualMonthTotal: number
  /** Days elapsed (equals the month length once the month is over). */
  day: number
  monthLabel: string
  /** False for a complete past month, where there is nothing left to project. */
  inProgress: boolean
  /** How many prior months the baseline averages. 0 = no history yet. */
  baselineMonths: number
}

export function SpendPace({
  spent,
  usual,
  curve,
  baseline,
  projected,
  usualMonthTotal,
  day,
  monthLabel,
  inProgress,
  baselineMonths,
}: SpendPaceProps) {
  const chart = useChartTheme()
  const colors = useDashboardChartColors()

  const data = useMemo(() => {
    const length = Math.max(baseline.length, curve.length)
    return Array.from({ length }, (_, i) => ({
      day: i + 1,
      // The actual series stops at today; Recharts breaks the line on null
      // rather than dragging it down to zero for days that have not happened.
      actual: i < curve.length ? curve[i] : null,
      usual: baseline[i] ?? null,
      // The projection starts ON today's point so the dashed segment joins the
      // solid line instead of floating away from it.
      projected:
        inProgress && projected !== undefined && i >= curve.length - 1
          ? spent + ((projected - spent) * (i + 1 - day)) / Math.max(1, length - day)
          : null,
    }))
  }, [curve, baseline, projected, spent, day, inProgress])

  const delta = spent - usual
  const pct = usual > 0 ? (delta / usual) * 100 : 0
  const hasBaseline = baselineMonths > 0 && usual > 0
  const over = delta >= 0

  const comparisonLabel = inProgress ? `usual by day ${day}` : 'your usual month'

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div>
          <p className="text-sm font-medium text-fg-muted">
            {inProgress ? `Spent so far in ${monthLabel}` : `Spent in ${monthLabel}`}
          </p>
          <p
            data-testid="spend-hero"
            className="mt-1 text-4xl font-bold tracking-tight text-fg"
          >
            {formatMYR(spent)}
          </p>

          {hasBaseline ? (
            <>
              <span
                data-testid="spend-delta"
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  over
                    ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                }`}
              >
                {over ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {formatMYR(Math.abs(delta))} {over ? 'more' : 'less'} than {comparisonLabel}
              </span>
              <p className="mt-2 text-xs text-fg-subtle">
                Usual by this point: {formatMYR(usual)} · that’s {over ? '+' : '−'}
                {Math.abs(pct).toFixed(1)}%
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs text-fg-subtle">
              No earlier months to compare against yet — the baseline appears once
              you have a full month of history.
            </p>
          )}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-0.5 w-3.5 rounded" style={{ background: colors.actual }} />
              This month
            </span>
            {hasBaseline && (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-0.5 w-3.5 rounded" style={{ background: colors.usual }} />
                Usual ({baselineMonths}-month average)
              </span>
            )}
            {inProgress && projected !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="h-0 w-3.5"
                  style={{ borderTop: `2px dashed ${colors.actual}` }}
                />
                On current pace
              </span>
            )}
          </div>

          <div
            role="img"
            aria-label={
              `Cumulative spending through ${monthLabel}. ` +
              `${formatMYR(spent)} by day ${day}` +
              (hasBaseline ? `, against a usual ${formatMYR(usual)}` : '') +
              (inProgress && projected !== undefined
                ? `. On the current rate the month ends near ${formatMYR(projected)}`
                : '') +
              (usualMonthTotal > 0 ? `, versus a ${formatMYR(usualMonthTotal)} monthly average.` : '.')
            }
          >
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke={chart.axis}
                  tick={{ fill: chart.axis }}
                  fontSize={11}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  stroke={chart.axis}
                  tick={{ fill: chart.axis }}
                  fontSize={11}
                  tickLine={false}
                  width={48}
                  tickFormatter={formatAxisMYR}
                />
                <Tooltip
                  contentStyle={chart.tooltip.contentStyle}
                  labelStyle={chart.tooltip.labelStyle}
                  itemStyle={chart.tooltip.itemStyle}
                  labelFormatter={(d) => `Day ${d}`}
                  formatter={(value: number) => formatMYR(value)}
                />
                {hasBaseline && (
                  <Line
                    type="monotone"
                    dataKey="usual"
                    name="Usual"
                    stroke={colors.usual}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {inProgress && projected !== undefined && (
                  <Line
                    type="linear"
                    dataKey="projected"
                    name="On current pace"
                    stroke={colors.actual}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="This month"
                  stroke={colors.actual}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {inProgress && projected !== undefined && usualMonthTotal > 0 && (
            <p className="mt-2 text-xs text-fg-subtle" data-testid="pace-projection">
              Keep this up and {monthLabel} closes at about{' '}
              <span className="font-semibold text-fg">{formatMYR(projected)}</span> —{' '}
              {formatMYR(Math.abs(projected - usualMonthTotal))}{' '}
              {projected >= usualMonthTotal ? 'above' : 'below'} your{' '}
              {formatMYR(usualMonthTotal)} monthly average.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
