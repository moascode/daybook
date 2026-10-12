import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Search } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useCompletedAnalytics } from '@/hooks/useCompletedAnalytics'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage, todayISO, dateMinusDays } from '@/lib/utils'
import { dayDiff } from '@/modules/tasks/taskRowFormat'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { CompletedAnalytics, CompletedByListCards } from '@/modules/tasks/CompletedAnalytics'
import type { Task } from '@/types/tasks.types'

type CompletedRange = '30d' | '6m' | 'all'

/** Oldest `completedAt` day (inclusive) to show for a range, or null for "All". */
function rangeStart(range: CompletedRange, today: string): string | null {
  if (range === '30d') return dateMinusDays(today, 29)
  if (range === '6m') return dateMinusDays(today, 182)
  return null
}

/** Day-group header text — "Today" / "Yesterday · Sat 11 Oct" / "Fri 10 Oct". */
function dayGroupLabel(dateStr: string): string {
  const d = parseISO(dateStr)
  const diff = dayDiff(dateStr, todayISO())
  if (diff === 0) return 'Today'
  if (diff === 1) return `Yesterday · ${format(d, 'EEE d MMM')}`
  return format(d, 'EEE d MMM')
}

/**
 * Builds and downloads a CSV of the currently-filtered completed tasks —
 * content, list name, completed date — as a one-click export (no modal;
 * Wallet's `ExportModal` multi-step picker is deliberately not reused here,
 * same pattern as `triggerDownload` in useWallet.ts).
 */
function downloadCompletedCsv(
  tasks: Task[],
  listById: Map<string, { name: string }>,
  addToast: (toast: { message: string }) => void,
) {
  // CSV-formula-injection guard: a field starting with =, +, - or @ is a
  // formula to a spreadsheet app, so a leading apostrophe forces it back to
  // plain text. Only content/list-name need this — the date field is always
  // a YYYY-MM-DD string and can never start with one of those characters.
  const escapeFormula = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s)
  const quote = (s: string) => `"${escapeFormula(s).replace(/"/g, '""')}"`
  const header = 'content,list,completed date'
  const rows = tasks.map((t) => {
    const listName = t.listId ? listById.get(t.listId)?.name ?? 'Deleted list' : 'Unsorted'
    const completedDate = t.completedAt ? t.completedAt.slice(0, 10) : ''
    return [quote(t.content), quote(listName), completedDate].join(',')
  })
  try {
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `completed-tasks-${todayISO()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    addToast({ message: errorMessage(err, 'Could not export the CSV — please try again.') })
  }
}

/**
 * Completed — `/tasks/completed` (R5 PR-4, final PR of R5,
 * docs/roadmap/design-adoption/.flow/R5-completed/flow-plan.md), plus the
 * analytics panel FEAT-030
 * (docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md)
 * added on top: a year heatmap, by-list time-to-finish, and the overall
 * average, all aggregated server-side (`GET /tasks/completed/analytics`).
 * Below that, the day-grouped list of every completed task, newest day
 * first, unchanged since R5. Un-completing a row via `TaskListRow`'s
 * checkbox removes it from the page immediately, same optimistic pattern as
 * TasksAllPage/TasksListDetailPage's `handleToggleComplete`.
 *
 * FEAT-060 (docs/backlog/EP-07-tasks-depth/FEAT-060-tasks-completed-design-adoption.md)
 * added the 30d/6m/All range toggle and Export button to the page head, the
 * streak/busiest-day stats to the heatmap card, and split the old combined
 * by-list card into "What you finish" (share) and "Time to finish" (speed).
 * The range toggle filters ONLY the day-grouped list below — the heatmap and
 * the two by-list cards stay on their own full-year/all-time aggregation,
 * per the acceptance criteria ("a year of finishing things" is constant).
 */
export function TasksCompletedPage() {
  const { loadTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const { analytics, loadAnalytics } = useCompletedAnalytics()
  const addToast = useToastStore((s) => s.addToast)

  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<CompletedRange>('6m')
  // "Filter completed…" (tasks-lists-parity) — client-side only, same as
  // every other client-side filter in this app (e.g. TasksPage.tsx's own
  // search); the completed list is already fully loaded for the heatmap/
  // by-list cards, so there's no server round trip to make.
  const [filterQuery, setFilterQuery] = useState('')
  // Client paging (tasks-lists-parity): 25 rows per page, "Load more" adds
  // another 25. Naturally caps at however many rows actually exist
  // (`pagedDayGroups` below stops once it runs out) — a narrower range or
  // filter, or a row leaving via un-complete, just shows fewer rows under
  // whatever budget "Load more" has already raised, rather than needing a
  // separate reset.
  const [visibleCount, setVisibleCount] = useState(25)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasks('completed'), loadTaskLists(), loadAnalytics()])
      .then(([done]) => {
        if (cancelled) return
        setCompletedTasks(done)
      })
      .catch((err) => {
        if (cancelled) return
        addToast({ message: errorMessage(err, 'Could not load your completed tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadTasks, loadTaskLists, loadAnalytics, addToast])

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])

  // FEAT-060's 30d/6m/All range toggle — filters only this day-grouped list
  // (and the Export CSV, which exports whatever this list is currently
  // showing). The heatmap and by-list cards above/below stay on the server's
  // own full-year/all-time aggregation regardless of this toggle.
  const rangeFilteredTasks = useMemo(() => {
    const start = rangeStart(range, todayISO())
    if (start === null) return completedTasks
    return completedTasks.filter((t) => !!t.completedAt && t.completedAt.slice(0, 10) >= start)
  }, [completedTasks, range])

  // "Filter completed…" narrows the day-grouped list (and the Export CSV,
  // same "export whatever is currently showing" convention the range
  // toggle already follows) by content, case-insensitively.
  const filteredTasks = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return rangeFilteredTasks
    return rangeFilteredTasks.filter((t) => t.content.toLowerCase().includes(q))
  }, [rangeFilteredTasks, filterQuery])

  // Group by day from `completedAt`, already a business-timezone value (PR-1's
  // `nowStr()` fix) — `.slice(0, 10)` only, never `toISOString()` (CLAUDE.md
  // §16 trap 1). Newest day first, matching the plan's "newest day first"
  // ordering (the opposite of TasksAllPage's due-date groups, which sort
  // soonest-first); most-recent-first WITHIN a day too, by the full
  // `completedAt` timestamp, not insertion order.
  const dayGroups = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const t of filteredTasks) {
      if (!t.completedAt) continue
      const day = t.completedAt.slice(0, 10)
      const existing = grouped.get(day)
      if (existing) existing.push(t)
      else grouped.set(day, [t])
    }
    return Array.from(grouped.entries())
      .map(([date, tasks]) => ({ date, tasks: [...tasks].sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)) }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [filteredTasks])

  // Client paging: 25 rows per page across the whole day-grouped list, cut
  // at a row boundary rather than a day boundary — a day's own header
  // always shows its TRUE total (`tasks.length`), even when the page cuts
  // off partway through its rows (same as the mockup's own worked example).
  const pagedDayGroups = useMemo(() => {
    let remaining = visibleCount
    const out: { date: string; tasks: Task[]; totalInDay: number }[] = []
    for (const group of dayGroups) {
      if (remaining <= 0) break
      const visible = group.tasks.slice(0, remaining)
      if (visible.length === 0) break
      out.push({ date: group.date, tasks: visible, totalInDay: group.tasks.length })
      remaining -= visible.length
    }
    return out
  }, [dayGroups, visibleCount])

  const shownCount = pagedDayGroups.reduce((sum, g) => sum + g.tasks.length, 0)

  const pageSub =
    range === '30d'
      ? `${rangeFilteredTasks.length} in the last 30 days`
      : range === '6m'
        ? `${rangeFilteredTasks.length} in the last 6 months`
        : `${rangeFilteredTasks.length} completed`

  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (!updated.isCompleted) {
        setCompletedTasks((prev) => prev.filter((t) => t.id !== id))
        // Tasks-lists-parity: un-completing removes a row from this page's
        // whole dataset, which changes the heatmap/streak/by-list analytics
        // too (they're server-aggregated from the same `completed_at`
        // column) — reload them so the cards above don't keep counting a
        // task that's no longer completed.
        loadAnalytics().catch((err) => {
          addToast({ message: errorMessage(err, 'Updated, but the analytics above could not refresh.') })
        })
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update that task — please try again.') })
    }
  }

  // FEAT-052: TaskListRow persists the edit itself; this keeps the display
  // in step, same story as handleToggleComplete's own `setCompletedTasks`
  // above — the row renders `task.content` from this array, not a draft.
  const handleContentChange = (id: string, content: string) => {
    setCompletedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
  }
  const handleDueDateChange = (id: string, dueDate: string | null) => {
    setCompletedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate } : t)))
  }
  const handleListChange = (id: string, listId: string | null) => {
    setCompletedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, listId } : t)))
  }

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Completed</h1>
          <p className="page-sub">{pageSub}</p>
        </div>
        <div className="page-actions items-center">
          <div className="segment" role="tablist" aria-label="Show completed from">
            <button
              type="button"
              role="tab"
              aria-selected={range === '30d'}
              onClick={() => setRange('30d')}
              data-testid="completed-range-30d"
            >
              30d
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={range === '6m'}
              onClick={() => setRange('6m')}
              data-testid="completed-range-6m"
            >
              6m
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={range === 'all'}
              onClick={() => setRange('all')}
              data-testid="completed-range-all"
            >
              All
            </button>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => downloadCompletedCsv(filteredTasks, listById, addToast)}
            disabled={filteredTasks.length === 0}
            data-testid="completed-export-btn"
          >
            Export
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your completed tasks…</p>
      ) : (
        <div className="dash">
          <CompletedAnalytics data={analytics} />

          <section className="card card-pad c8">
            <div className="card-head">
              <span className="card-title">Recently finished</span>
              <div className="filters" style={{ marginLeft: 'auto' }}>
                <label className="filter-field" style={{ maxWidth: 220 }}>
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Filter completed…"
                    aria-label="Filter completed tasks"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    data-testid="completed-filter-input"
                  />
                </label>
              </div>
            </div>
            {dayGroups.length === 0 && completedTasks.length === 0 ? (
              <p className="py-3 text-sm text-fg-subtle" data-testid="completed-empty">
                You haven't completed any tasks yet.
              </p>
            ) : dayGroups.length === 0 ? (
              <p className="py-3 text-sm text-fg-subtle" data-testid="completed-empty-range">
                {filterQuery.trim()
                  ? `Nothing completed matches "${filterQuery.trim()}".`
                  : range === '30d'
                    ? 'Nothing completed in the last 30 days — try a wider range.'
                    : range === '6m'
                      ? 'Nothing completed in the last 6 months — try a wider range.'
                      : 'Nothing completed in this range — try a wider range.'}
              </p>
            ) : (
              <div>
                {pagedDayGroups.map((group) => (
                  <div key={group.date}>
                    <div className="tgroup" data-testid="completed-day-header">
                      <span>{dayGroupLabel(group.date)}</span>
                      <span className="n">{group.totalInDay}</span>
                      <span className="line" />
                    </div>
                    {group.tasks.map((t) => (
                      <TaskListRow
                        key={t.id}
                        task={t}
                        list={t.listId ? listById.get(t.listId) : undefined}
                        onToggleComplete={handleToggleComplete}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                        availableLists={taskLists}
                        onListChange={handleListChange}
                      />
                    ))}
                  </div>
                ))}
                <div className="divider" />
                <div className="flex items-center gap-3">
                  <span className="text-sm text-fg-subtle" data-testid="completed-showing-count">
                    Showing {shownCount} of {filteredTasks.length}
                  </span>
                  {shownCount < filteredTasks.length && (
                    <button
                      type="button"
                      className="btn btn-secondary ml-auto"
                      onClick={() => setVisibleCount((prev) => prev + 25)}
                      data-testid="completed-load-more"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <CompletedByListCards data={analytics} listById={listById} />
        </div>
      )}
    </div>
  )
}
