import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatMYR, formatAxisMYR } from '@/lib/utils'
import { useChartTheme } from '@/hooks/useChartTheme'
import { useDashboardChartColors } from './chartColors'

interface SpendPaceProps {
  /** Spend so far in the selected period. */
  spent: number
  /** The same measurement over the comparison window. */
  usual: number
  /** Cumulative spend per day, index 0 first. Length = days elapsed. */
  curve: number[]
  /** The comparison curve, aligned to the same day offsets. */
  baseline: number[]
  /** Where the period lands at the current rate. Only meaningful for an in-progress month. */
  projected?: number
  /** The comparison window's own full total (a full month's average, or a full range's total). */
  comparisonTotal: number
  /** Days elapsed (equals the period length once it's complete or isn't "in progress"). */
  elapsedDays: number
  periodLabel: string
  /** False whenever there is nothing left to project: a finished month, or any range period (a trailing window has no "end" to race toward). */
  inProgress: boolean
  /** How many windows the comparison averages. 0 = no history yet. */
  comparisonCount: number
  /** e.g. "3-month average" or "same length before" — inserted into "Usual ({...})". */
  comparisonDescription: string
  /**
   * Continuous month count behind `spent`/`usual` (days spanned ÷ 30, see
   * `monthsSpanned` in insights.ts) — undefined when the period is too short
   * for "per month" to mean anything (see MIN_AVERAGE_DAYS). A single prop
   * on purpose: `spent` and `usual` cover equal-length windows, so deriving
   * both averages from the one number here — rather than accepting two
   * pre-divided averages from the caller — makes it impossible for them to
   * end up divided by different spans.
   */
  monthsSpanned?: number
  /** Full text for the delta chip and the "usual by ..." aria clause, e.g. "usual by day 18" or "your usual for this period". */
  comparisonClause: string
  /** Maps a 0-based day offset to its axis/tooltip label. Defaults to 1-based day-of-period numbering. */
  formatDay?: (offset: number) => string | number
  /** Wraps the axis label into the tooltip's header line, e.g. "Day 18". Defaults to that exact wording. */
  formatDayTooltipLabel?: (label: string | number) => string
}

export function SpendPace({
  spent,
  usual,
  curve,
  baseline,
  projected,
  comparisonTotal,
  elapsedDays,
  periodLabel,
  inProgress,
  comparisonCount,
  comparisonDescription,
  comparisonClause,
  monthsSpanned,
  formatDay = (offset) => offset + 1,
  formatDayTooltipLabel = (label) => `Day ${label}`,
}: SpendPaceProps) {
  const chart = useChartTheme()
  const colors = useDashboardChartColors()

  const data = useMemo(() => {
    const length = Math.max(baseline.length, curve.length)
    return Array.from({ length }, (_, i) => ({
      day: formatDay(i),
      // The actual series stops at today; Recharts breaks the line on null
      // rather than dragging it down to zero for days that have not happened.
      actual: i < curve.length ? curve[i] : null,
      usual: baseline[i] ?? null,
      // The projection starts ON today's point so the dashed segment joins the
      // solid line instead of floating away from it.
      projected:
        inProgress && projected !== undefined && i >= curve.length - 1
          ? spent + ((projected - spent) * (i + 1 - elapsedDays)) / Math.max(1, length - elapsedDays)
          : null,
    }))
  }, [curve, baseline, projected, spent, elapsedDays, inProgress, formatDay])

  const delta = spent - usual
  const pct = usual > 0 ? (delta / usual) * 100 : 0
  const hasComparison = comparisonCount > 0 && usual > 0
  const over = delta >= 0
  // Both derived from the SAME monthsSpanned, so they can never disagree on
  // what a "month" was for this period — see the prop doc comment.
  const spentAverage = monthsSpanned !== undefined ? spent / monthsSpanned : undefined
  const usualAverage = monthsSpanned !== undefined ? usual / monthsSpanned : undefined

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div>
          <p className="text-sm font-medium text-fg-muted">
            {inProgress ? `Spent so far in ${periodLabel}` : `Spent in ${periodLabel}`}
          </p>
          <p
            data-testid="spend-hero"
            className="mt-1 text-4xl font-bold tracking-tight text-fg"
          >
            {formatMYR(spent)}
          </p>
          {spentAverage !== undefined && (
            <p className="mt-0.5 text-xs text-fg-subtle" data-testid="spend-monthly-average">
              {formatMYR(spentAverage)}/mo average
            </p>
          )}

          {hasComparison ? (
            <>
              <span
                data-testid="spend-delta"
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  over
                    ? 'bg-red-50 text-red-700'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                {over ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {formatMYR(Math.abs(delta))} {over ? 'more' : 'less'} than {comparisonClause}
              </span>
              <p className="mt-2 text-xs text-fg-subtle">
                Usual by this point: {formatMYR(usual)}
                {usualAverage !== undefined && ` (${formatMYR(usualAverage)}/mo)`} · that’s{' '}
                {over ? '+' : '−'}
                {Math.abs(pct).toFixed(1)}%
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs text-fg-subtle">
              No earlier period to compare against yet — the comparison appears
              once you have history before this one.
            </p>
          )}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-0.5 w-3.5 rounded" style={{ background: colors.actual }} />
              This period
            </span>
            {hasComparison && (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-0.5 w-3.5 rounded" style={{ background: colors.usual }} />
                Usual ({comparisonDescription})
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
              `Cumulative spending through ${periodLabel}. ` +
              `${formatMYR(spent)} so far` +
              (hasComparison ? `, against ${comparisonClause} of ${formatMYR(usual)}` : '') +
              (inProgress && projected !== undefined
                ? `. On the current rate the period ends near ${formatMYR(projected)}`
                : '') +
              (comparisonTotal > 0 ? `, versus a ${formatMYR(comparisonTotal)} usual total.` : '.')
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
                  labelFormatter={formatDayTooltipLabel}
                  formatter={(value: number) => formatMYR(value)}
                />
                {hasComparison && (
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
                  name="This period"
                  stroke={colors.actual}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {inProgress && projected !== undefined && comparisonTotal > 0 && (
            <p className="mt-2 text-xs text-fg-subtle" data-testid="pace-projection">
              Keep this up and {periodLabel} closes at about{' '}
              <span className="font-semibold text-fg">{formatMYR(projected)}</span> —{' '}
              {formatMYR(Math.abs(projected - comparisonTotal))}{' '}
              {projected >= comparisonTotal ? 'above' : 'below'} your{' '}
              {formatMYR(comparisonTotal)} monthly average.
            </p>
          )}

          {inProgress && projected === undefined && (
            <p className="mt-2 text-xs text-fg-subtle" data-testid="pace-too-early">
              Too early in {periodLabel} to project a total — a few days of
              spending multiplied out says more about one purchase than about
              the month.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
