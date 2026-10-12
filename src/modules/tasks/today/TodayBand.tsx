import { cn } from '@/lib/utils'

interface LoadDay {
  date: string
  label: string
  count: number
}

interface TodayBandProps {
  todayLabel: string
  todayDueCount: number
  overdueCount: number
  lateOfDueTodayCount: number
  isHeaviestDay: boolean
  doneCount: number
  totalToday: number
  donePct: number
  oldestOverdueDays: number | null
  assignedCount: number
  finishedThisWeekCount: number
  loadStrip: LoadDay[]
  maxLoad: number
}

/**
 * The Today band: done-today progress, the overdue/assigned/finished-this-week
 * stat row, and the 7-day load strip (mockup: proposal-v2/tasks.html
 * `.band`/`.load`). The load strip's first bar is the SAME number the band's
 * "N of M done today" figure uses (overdue + due today + done today), not a
 * separate due-today-only count — see useTodayTasks.ts's `totalToday`.
 */
export function TodayBand({
  todayLabel,
  todayDueCount,
  overdueCount,
  lateOfDueTodayCount,
  isHeaviestDay,
  doneCount,
  totalToday,
  donePct,
  oldestOverdueDays,
  assignedCount,
  finishedThisWeekCount,
  loadStrip,
  maxLoad,
}: TodayBandProps) {
  return (
    <section className="card card-pad c12" data-testid="today-band">
      <div className="card-head">
        <div>
          <span className="card-title">{todayLabel}</span>
          <div className="card-sub">
            {todayDueCount + overdueCount === 0
              ? "Nothing due today — you're all caught up."
              : `${todayDueCount + overdueCount} due today · ${lateOfDueTodayCount} of them are already late`}
          </div>
        </div>
        {isHeaviestDay && (
          <span className="chip chip-warn ml-auto" data-testid="today-heaviest-chip">
            Heaviest day this week
          </span>
        )}
      </div>

      <div className="band">
        <div className="band-main">
          <div className="band-fig">
            <span className="v">
              {doneCount} of {totalToday}
            </span>
            <span className="k">done today</span>
          </div>
          <div className="track mt-3">
            <i className="bg-pos" style={{ width: `${donePct}%` }} />
          </div>
        </div>
        <div className="band-stats">
          <div className="band-stat">
            <p className="k">Overdue</p>
            <p className="v">{overdueCount}</p>
            {oldestOverdueDays !== null && <p className="s">oldest is {oldestOverdueDays} days</p>}
          </div>
          <div className="band-stat">
            <p className="k">Assigned to me</p>
            <p className="v">{assignedCount}</p>
          </div>
          <div className="band-stat">
            <p className="k">Finished this week</p>
            <p className="v">{finishedThisWeekCount}</p>
          </div>
        </div>
      </div>

      <div className="divider" />

      <div className="load mt-4">
        {loadStrip.map((d, i) => (
          <div key={d.date} className={cn('load-day', i === 0 && 'today')} data-testid="load-day">
            <div className="load-d">{d.label}</div>
            <div className="load-n">{d.count}</div>
            <div className="load-bar">
              <i style={{ width: `${(d.count / maxLoad) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
