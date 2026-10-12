import { cn } from '@/lib/utils'
import { BAR_FOOT_OFFSET_PX, BAR_MAX_PX, WEEKDAY_FULL, WEEKDAY_SHORT, WEEK_DISPLAY_ORDER } from './habitMath'

/** "Kept by weekday" (c8) — the pooled kept/due per weekday computed once in
 * `TasksHabitsPage` (`pooledWeekdayStats`, review fix #2) and shared with the
 * Consistency card's "Weakest day" stat, so the two can't disagree. Window:
 * the same 28-day `entries` every habit card's own ring reads — "last 4
 * weeks" below names that window honestly rather than the 12-week streak
 * window the Consistency card's "Longest" stat uses. */
export function WeekdayCard({ pooled }: { pooled: { due: number[]; kept: number[]; rates: number[] } }) {
  const { due: dueByWeekday, kept: keptByWeekday, rates } = pooled
  if (dueByWeekday.every((d) => d === 0)) return null

  const totalDue = dueByWeekday.reduce((s, n) => s + n, 0)
  const totalKept = keptByWeekday.reduce((s, n) => s + n, 0)
  const avgPct = totalDue > 0 ? (totalKept / totalDue) * 100 : 0
  // Review fix #8: only weekdays with at least one due day are candidates
  // for "highest" — otherwise, when every pooled rate is a tied 0 (no data
  // yet, or everything missed), `rates[weekday] >= maxRate` (0 >= 0) would
  // be true for every bar and highlight all of them at once.
  const ratesWithDue = WEEK_DISPLAY_ORDER.filter((wd) => dueByWeekday[wd] > 0).map((wd) => rates[wd])
  const maxRate = ratesWithDue.length > 0 ? Math.max(...ratesWithDue) : 0

  const below70 = WEEK_DISPLAY_ORDER.filter((weekday) => dueByWeekday[weekday] > 0 && rates[weekday] < 0.7)
  const insight =
    below70.length === 0
      ? 'Every day is holding at 70% or higher.'
      : below70.length === 1
        ? `${WEEKDAY_FULL[below70[0]]} is the only day below 70%.`
        : below70.length === 2
          ? `${WEEKDAY_FULL[below70[0]]} and ${WEEKDAY_FULL[below70[1]]} are below 70%.`
          : `${below70.map((d) => WEEKDAY_FULL[d]).join(', ')} are below 70%.`

  return (
    <section className="card card-pad c8" data-testid="habits-weekday-card">
      <div className="card-head">
        <div>
          <span className="card-title">Kept by weekday</span>
          <div className="card-sub">All habits, last 4 weeks</div>
        </div>
      </div>
      <div className="bars" data-testid="habits-weekday-bars">
        <div className="bars-avg" style={{ bottom: `${(avgPct / 100) * BAR_MAX_PX + BAR_FOOT_OFFSET_PX}px` }}>
          <span>{Math.round(avgPct)}% avg</span>
        </div>
        {WEEK_DISPLAY_ORDER.map((weekday) => {
          const hasDue = dueByWeekday[weekday] > 0
          const pct = hasDue ? Math.round(rates[weekday] * 100) : null
          // Review fix #8: "0% kept" and "nothing due" are different facts —
          // a weekday nothing is due on renders as an honest empty bar, not
          // a misleading 0%, and can never qualify for the `.hi` highlight.
          return (
            <div key={weekday} className={cn('bar', hasDue && maxRate > 0 && rates[weekday] >= maxRate && 'hi')}>
              <span className="bar-val">{hasDue ? `${pct}%` : '—'}</span>
              <div className="bar-fill" style={{ height: hasDue ? `${(pct! / 100) * BAR_MAX_PX}px` : '0px' }} />
              <span className="bar-day">{WEEKDAY_SHORT[weekday]}</span>
            </div>
          )
        })}
      </div>
      <div className="divider" />
      <p className="text-sm text-fg-subtle" data-testid="habits-weekday-insight">
        {insight}
      </p>
    </section>
  )
}
