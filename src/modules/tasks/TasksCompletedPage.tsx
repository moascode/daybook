import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import type { Task } from '@/types/tasks.types'

/**
 * Completed — `/tasks/completed` (R5 PR-4, final PR of R5,
 * docs/v2/.flow/R5-completed/flow-plan.md). A day-grouped list of every
 * completed task, newest day first. Deliberately minimal per the plan and
 * the design spec's own words ("the year heatmap, by-list breakdown and
 * time-to-finish analysis are R11 — they need more history than the
 * backfill provides to be worth reading") — no chart, no breakdown, just
 * the list. Un-completing a row via `TaskListRow`'s checkbox removes it
 * from the page immediately, same optimistic pattern as
 * TasksAllPage/TasksListDetailPage's `handleToggleComplete`.
 */
export function TasksCompletedPage() {
  const { loadTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const addToast = useToastStore((s) => s.addToast)

  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasks('completed'), loadTaskLists()])
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
  }, [loadTasks, loadTaskLists, addToast])

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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Completed</h1>
          <p className="page-sub">Everything you've finished, grouped by the day you finished it.</p>
        </div>
      </div>

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
