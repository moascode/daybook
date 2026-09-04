import { cn, formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import type { DailySpend } from './insights'

interface WeekRhythmProps {
  /** The last 7 calendar days, oldest first. */
  days: DailySpend[]
  className?: string
}

/** Bar height is capped at this many px, matching the mockup's fixed-height track. */
const MAX_BAR_HEIGHT = 160

/**
 * "Week rhythm" — a literal port of the mockup's hand-drawn bar chart: seven
 * columns for the actual last 7 calendar days (not an average), a dashed
 * line at the daily average, and the heaviest days called out in bold.
 */
export function WeekRhythm({ days, className }: WeekRhythmProps) {
  const total = days.reduce((sum, d) => sum + d.amount, 0)
  const average = total / 7
  const max = Math.max(...days.map((d) => d.amount), average, 1)
  const highThreshold = average * 1.3

  const weekendTotal = days
    .filter((d) => d.label === 'Sat' || d.label === 'Sun')
    .reduce((sum, d) => sum + d.amount, 0)
  const weekdayCount = days.filter((d) => d.label !== 'Sat' && d.label !== 'Sun').length || 1
  const weekdayAverage = (total - weekendTotal) / weekdayCount
  const weekendMultiplier = weekdayAverage > 0 ? weekendTotal / weekdayCount / weekdayAverage : 0
  const busiest = days.reduce((a, b) => (b.amount > a.amount ? b : a), days[0])

  return (
    <DashboardCard className={cn('flex flex-col', className)} title="Week rhythm" subtitle="Daily spend, last 7 days">
      <div
        className="bars"
        style={{ height: MAX_BAR_HEIGHT + 40 }}
        role="img"
        data-testid="week-rhythm"
        aria-label={`Daily spend, last 7 days. ${days.map((d) => `${d.label}: ${formatMYR(d.amount)}`).join('; ')}. Daily average: ${formatMYR(average)}.`}
      >
        {total > 0 && (
          <div className="bars-avg" style={{ bottom: (average / max) * MAX_BAR_HEIGHT + 24 }}>
            <span>Avg</span>
          </div>
        )}
        {days.map((d) => {
          const hi = d.amount >= highThreshold && d.amount > 0
          return (
            <div key={d.date} className={cn('bar', hi && 'hi')} data-testid="week-rhythm-bar">
              <span className="bar-val">{formatMYR(d.amount).replace('.00', '')}</span>
              <div className="bar-fill" style={{ height: Math.max(2, (d.amount / max) * MAX_BAR_HEIGHT) }} />
              <span className="bar-day">{d.label}</span>
            </div>
          )
        })}
      </div>

      {total > 0 && (
        <p className="mt-auto rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          Daily average <b className="text-fg">{formatMYR(average)}</b> (dashed).
          {weekendMultiplier > 1 && (
            <>
              {' '}Weekends run <b className="text-fg">{weekendMultiplier.toFixed(1)}×</b> higher —{' '}
              {busiest.label} alone was <b className="text-fg">{formatMYR(busiest.amount)}</b>.
            </>
          )}
        </p>
      )}
    </DashboardCard>
  )
}
