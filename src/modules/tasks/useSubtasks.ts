import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { rowToTask, type TaskRow } from '@/hooks/useTasks'
import { useToastStore } from '@/stores/toast.store'
import type { Task } from '@/types/tasks.types'

/**
 * A task's checklist items for the detail modal (FEAT-056): loaded when the
 * modal opens on a task, and mutated server-write-first. `onCounts` reports
 * the new total/done after every change so the opening page's row badge
 * ("1 of 3") follows along instead of waiting for a reload.
 *
 * Failures are never swallowed: a failed load leaves `loadError` for the
 * section to show (with the items it could not fetch not pretended empty), and
 * a failed add/toggle toasts and changes nothing.
 */
export function useSubtasks(
  parentId: string | null,
  open: boolean,
  onCounts: (total: number, done: number) => void,
) {
  const addToast = useToastStore((s) => s.addToast)
  // The last fetch's result, tagged with the task it belongs to — "loading"
  // is simply "the open task has no result yet", so no setState runs
  // synchronously inside the effect.
  const [loaded, setLoaded] = useState<{ id: string; items: Task[]; error: string | null } | null>(null)
  const key = open ? parentId : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    api
      .get<TaskRow[]>(`/tasks/${key}/children`)
      .then((rows) => {
        if (!cancelled) setLoaded({ id: key, items: rows.map(rowToTask), error: null })
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: key, items: [], error: errorMessage(err, 'Could not load this checklist.') })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const current = loaded && loaded.id === key ? loaded : null
  const items = current?.items ?? []
  const loading = key !== null && current === null
  const loadError = current?.error ?? null
  const setItems = (next: Task[]) => setLoaded((prev) => (prev && key ? { ...prev, id: key, items: next } : prev))

  const report = useCallback(
    (next: Task[]) => onCounts(next.length, next.filter((t) => t.isCompleted).length),
    [onCounts],
  )

  const addItem = useCallback(
    async (content: string): Promise<boolean> => {
      if (!parentId) return false
      try {
        const sortOrder = items.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1
        const row = await api.post<TaskRow | null>('/tasks', { parentId, content, sortOrder })
        if (!row) throw new Error('Failed to add that item')
        const next = [...items, rowToTask(row)]
        setItems(next)
        report(next)
        return true
      } catch (err) {
        addToast({ message: errorMessage(err, 'Could not add that item — please try again.') })
        return false
      }
    },
    [parentId, items, report, addToast],
  )

  const toggleItem = useCallback(
    async (id: string) => {
      try {
        const row = await api.post<TaskRow>(`/tasks/${id}/complete`, {})
        const updated = rowToTask(row)
        const next = items.map((t) => (t.id === id ? { ...t, isCompleted: updated.isCompleted, completedAt: updated.completedAt } : t))
        setItems(next)
        report(next)
      } catch (err) {
        addToast({ message: errorMessage(err, 'Could not update that item — please try again.') })
      }
    },
    [items, report, addToast],
  )

  return { items, loading, loadError, addItem, toggleItem }
}
