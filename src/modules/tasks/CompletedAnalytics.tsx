import { useMemo } from 'react'
import { cn, todayISO } from '@/lib/utils'
import type { CompletedAnalytics as CompletedAnalyticsData } from '@/hooks/useCompletedAnalytics'
import type { TaskList } from '@/hooks/useTaskLists'

function dateMinusDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Bucket a day's completion count into one of 4 shading intensities. */
function intensityClass(count: number): string {
  if (count === 0) return 'bg-surface-sunken'
  if (count === 1) return 'bg-emerald-200'
  if (count <= 3) return 'bg-emerald-400'
  return 'bg-emerald-600'
}

/**
 * Year heatmap + by-list time-to-finish breakdown for the Completed page
 * (FEAT-030, docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md).
 * All the aggregation happens server-side (`GET /tasks/completed/analytics`,
 * worker/routes/tasks.ts) — this component only lays the numbers out.
 */
export function CompletedAnalytics({
  data,
  listById,
}: {
  data: CompletedAnalyticsData
  listById: Map<string, TaskList>
}) {
  const countByDate = useMemo(() => new Map(data.heatmap.map((h) => [h.date, h.count])), [data.heatmap])

  // 53 columns (Sun..Sat rows) ending today, starting from the most recent
  // Sunday on/before 364 days ago so the grid is always whole weeks.
  const weeks = useMemo(() => {
    const today = todayISO()
    const start = dateMinusDays(today, 364 + weekdayOf(dateMinusDays(today, 364)))
    const cols: string[][] = []
    let cursor = start
    while (cursor <= today) {
      const col: string[] = []
      for (let d = 0; d < 7; d++) {
        col.push(cursor)
        cursor = dateMinusDays(cursor, -1)
      }
      cols.push(col)
    }
    return cols
  }, [])

  const byListSorted = useMemo(
    () => [...data.byList].sort((a, b) => b.avgDays - a.avgDays),
    [data.byList],
  )
  const graveyard = byListSorted.find((r) => data.overallAvgDays > 0 && r.avgDays > data.overallAvgDays * 3 && r.count >= 3)

  if (data.totalCompleted === 0) return null

  return (
    <div className="card card-pad mb-4" data-testid="completed-analytics">
      <div className="card-head">
        <span className="card-title">Analytics</span>
        <span className="text-sm text-fg-subtle">
          {data.totalCompleted} completed · avg {data.overallAvgDays.toFixed(1)} days to finish
        </span>
      </div>

      <div className="mb-4 overflow-x-auto">
        <div className="inline-flex gap-[3px]" data-testid="completed-heatmap">
          {weeks.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((date) => (
                <div
                  key={date}
                  data-testid={`heatmap-day-${date}`}
                  title={`${date} — ${countByDate.get(date) ?? 0} completed`}
                  className={cn('h-2.5 w-2.5 rounded-sm', date > todayISO() ? 'opacity-0' : intensityClass(countByDate.get(date) ?? 0))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5" data-testid="completed-by-list">
        {byListSorted.map((row) => {
          const list = row.listId ? listById.get(row.listId) : undefined
          const name = row.listId ? (list?.name ?? 'Deleted list') : 'Unsorted'
          return (
            <div key={row.listId ?? 'unsorted'} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-fg-muted">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: list?.color ?? '#6b7280' }}
                  aria-hidden="true"
                />
                {name}
                <span className="text-fg-faint">({row.count})</span>
              </span>
              <span className="text-fg-subtle">{row.avgDays.toFixed(1)} days</span>
            </div>
          )
        })}
      </div>

      {graveyard && (
        <p className="mt-2 text-xs text-fg-subtle" data-testid="completed-insight">
          {(graveyard.listId ? listById.get(graveyard.listId)?.name : 'Unsorted') ?? 'That list'} is a graveyard,
          not a backlog — tasks there take {(graveyard.avgDays / data.overallAvgDays).toFixed(1)}x longer to
          finish than average.
        </p>
      )}
    </div>
  )
}
