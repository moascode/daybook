import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useCompletedAnalytics } from '@/hooks/useCompletedAnalytics'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { CompletedAnalytics } from '@/modules/tasks/CompletedAnalytics'
import type { Task } from '@/types/tasks.types'

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
 */
export function TasksCompletedPage() {
  const { loadTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const { analytics, loadAnalytics } = useCompletedAnalytics()
  const addToast = useToastStore((s) => s.addToast)

  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

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

  // Group by day from `completedAt`, already a business-timezone value (PR-1's
  // `nowStr()` fix) — `.slice(0, 10)` only, never `toISOString()` (CLAUDE.md
  // §16 trap 1). Newest day first, matching the plan's "newest day first"
  // ordering (the opposite of TasksAllPage's due-date groups, which sort
  // soonest-first).
  const dayGroups = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const t of completedTasks) {
      if (!t.completedAt) continue
      const day = t.completedAt.slice(0, 10)
      const existing = grouped.get(day)
      if (existing) existing.push(t)
      else grouped.set(day, [t])
    }
    return Array.from(grouped.entries())
      .map(([date, tasks]) => ({ date, tasks }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [completedTasks])

  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (!updated.isCompleted) {
        setCompletedTasks((prev) => prev.filter((t) => t.id !== id))
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
          <p className="page-sub">Everything you've finished, grouped by the day you finished it.</p>
        </div>
      </div>

      {!loading && <CompletedAnalytics data={analytics} listById={listById} />}

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your completed tasks…</p>
      ) : dayGroups.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle" data-testid="completed-empty">
          You haven't completed any tasks yet.
        </p>
      ) : (
        <div>
          {dayGroups.map((group) => {
            const d = parseISO(group.date)
            return (
              <div key={group.date}>
                <div className="tgroup-head" data-testid="completed-day-header">
                  <span className="tg-date">
                    <b>{format(d, 'EEE')}</b>, {format(d, 'dd MMM yyyy')}
                  </span>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
