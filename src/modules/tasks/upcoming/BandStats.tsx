import { format, parseISO } from 'date-fns'
import type { UsualWeek } from '@/modules/tasks/upcoming/weekMath'
import type { Task } from '@/types/tasks.types'

interface BandStatsProps {
  bandTitleText: string
  scheduledCount: number
  undatedCount: number
  isHeaviestDayGenuine: boolean
  heaviestDayDate: string
  hardDeadlineTasks: Task[]
  recurringTasks: Task[]
  usual: UsualWeek | null
}

function summarizeTaskNames(list: Task[], max = 3): string {
  const names = list.map((t) => t.content || 'Untitled task').filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')}…`
}

/**
 * The "This week" / "Next week" / date-range summary band (FEAT-057 mockup):
 * hard deadlines, recurring, and — only when there's honest history to
 * compare against — "Your usual week". `.band-stat` is capped to a fixed
 * width and its `.s` sub-line ellipsises to one line (layout.css) so a long
 * task-name list never blows out the card's layout.
 */
export function BandStats({
  bandTitleText,
  scheduledCount,
  undatedCount,
  isHeaviestDayGenuine,
  heaviestDayDate,
  hardDeadlineTasks,
  recurringTasks,
  usual,
}: BandStatsProps) {
  const hardDeadlineNames = summarizeTaskNames(hardDeadlineTasks)
  const recurringNames = summarizeTaskNames(recurringTasks)

  return (
    <section className="card card-pad mb-4" data-testid="upcoming-band-stats">
      <div className="card-head">
        <div>
          <span className="card-title">{bandTitleText}</span>
          <div className="card-sub" data-testid="upcoming-summary-line">
            {scheduledCount} scheduled, {undatedCount} waiting for a date
          </div>
        </div>
        {isHeaviestDayGenuine && (
          <span className="chip chip-warn ml-auto" data-testid="upcoming-heaviest-chip">
            {format(parseISO(heaviestDayDate), 'EEEE')} is doing too much
          </span>
        )}
      </div>
      <div className="band">
        <div className="band-main">
          <div className="band-fig">
            <span className="v">{scheduledCount}</span>
            <span className="k">tasks across seven days</span>
          </div>
        </div>
        <div className="band-stats">
          <div className="band-stat" data-testid="upcoming-stat-hard-deadlines">
            <p className="k">Hard deadlines</p>
            <p className="v">{hardDeadlineTasks.length}</p>
            {hardDeadlineNames && <p className="s">{hardDeadlineNames}</p>}
          </div>
          <div className="band-stat" data-testid="upcoming-stat-recurring">
            <p className="k">Recurring</p>
            <p className="v">{recurringTasks.length}</p>
            {recurringNames && <p className="s">{recurringNames}</p>}
          </div>
          {usual && (
            <div className="band-stat" data-testid="upcoming-stat-usual-week">
              <p className="k">Your usual week</p>
              <p className="v">{usual.avgPerWeek}</p>
              {usual.percentDiff !== null && (
                <p className="s">
                  this week is {Math.abs(usual.percentDiff)}% {usual.percentDiff > 0 ? 'heavier' : 'lighter'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
