import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { useDashboardChartColors } from './chartColors'
import { WEEKDAY_LABELS } from './insights'

interface WeekRhythmProps {
  /** Seven averages, Monday first. */
  averages: number[]
  months: number
}

/**
 * Average spend by weekday — the timing axis nothing else in the app touches.
 *
 * Columns rather than a coloured calendar grid: seven values are a magnitude
 * comparison, and length reads more precisely than shade. It also sidesteps the
 * contrast problem a filled cell has, where the label sitting inside the fill
 * has to flip colour as the fill darkens.
 */
export function WeekRhythm({ averages, months }: WeekRhythmProps) {
  const colors = useDashboardChartColors()
  const max = Math.max(...averages, 1)
  const total = averages.reduce((a, b) => a + b, 0)
  const weekend = averages[4] + averages[5] + averages[6]
  const weekendShare = total > 0 ? (weekend / total) * 100 : 0
  const busiest = averages.indexOf(Math.max(...averages))

  return (
    <DashboardCard
      title="Your week"
      subtitle={`Average spend per weekday over the last ${months} month${months === 1 ? '' : 's'}.`}
    >
      <div
        className="flex h-40 items-end gap-1.5 sm:gap-2"
        role="img"
        aria-label={`Average spend by weekday. ${WEEKDAY_LABELS.map(
          (d, i) => `${d}: ${formatMYR(averages[i])}`,
        ).join('; ')}.`}
        data-testid="week-rhythm"
      >
        {averages.map((value, i) => (
          <div key={WEEKDAY_LABELS[i]} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium tabular-nums text-fg-subtle">
              {Math.round(value)}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(2, (value / max) * 100)}%`,
                  background: colors.magnitude,
                  opacity: i === busiest ? 1 : 0.55,
                }}
              />
            </div>
            <span className="text-[11px] font-medium text-fg-muted">{WEEKDAY_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {total > 0 && (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          <span className="font-semibold">
            Fri–Sun is {weekendShare.toFixed(0)}%
          </span>{' '}
          of your weekly spending in 43% of the days.{' '}
          {WEEKDAY_LABELS[busiest]} is your heaviest day at {formatMYR(averages[busiest])} on average.
        </p>
      )}
    </DashboardCard>
  )
}
