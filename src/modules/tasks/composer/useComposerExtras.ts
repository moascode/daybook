import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useTasks, type TaskRow } from '@/hooks/useTasks'
import type { Task } from '@/types/tasks.types'

export interface ReminderResult {
  task: Task
  /** False when the task was created but the follow-up PATCH setting `remindAt` failed. */
  reminderSaved: boolean
  /** The PATCH's error, when `reminderSaved` is false — the caller reports it. */
  error?: unknown
}

export interface ChecklistResult {
  /** The parent, carrying the subtask counts as they stand after this run. */
  parent: Task
  /** Items that did not save, in their original order, for the composer to keep. */
  failedItems: string[]
  /** Items that saved on THIS run. */
  createdCount: number
  /** False when the page's list/date could not be applied to the parent (it may not show on this page). */
  listSaved: boolean
}

/**
 * The write side of the composer's Reminder and Checklist acts (FEAT-055/056),
 * kept out of TaskComposer.tsx so that file stays about input. Both are
 * server-write-first: nothing is reported as created until the API said so.
 * `useTasks().addTask` already toasts its own failures (reportAndReconcile),
 * so a throw from here for the PARENT means the user has already been told.
 */
export function useComposerExtras() {
  const { addTask } = useTasks()

  /** A task with `remindAt` and — deliberately — no due date, so missing it never makes it overdue. */
  const createReminder = useCallback(
    async (content: string, remindAt: string, listId: string | null): Promise<ReminderResult> => {
      const task = await addTask(content, null)
      try {
        const row = await api.patch<TaskRow>(`/tasks/${task.id}`, listId ? { remindAt, listId } : { remindAt })
        return { task: { ...task, remindAt: row.remind_at ?? remindAt }, reminderSaved: true }
      } catch (err) {
        return { task, reminderSaved: false, error: err }
      }
    },
    [addTask],
  )

  /**
   * Creates the parent (unless retrying onto one that already exists), then
   * each item as a child in order. A failing item does not stop the rest;
   * every failure is returned so none can be dropped silently.
   */
  const createChecklist = useCallback(
    async (
      title: string,
      items: string[],
      existing: Task | null,
      defaults: { listId: string | null; dueDate: string | null },
    ): Promise<ChecklistResult> => {
      let parent = existing ?? (await addTask(title, null))
      let listSaved = true
      const patch: Record<string, unknown> = {}
      if (defaults.listId) patch.listId = defaults.listId
      if (defaults.dueDate) patch.dueDate = defaults.dueDate
      if (!existing && Object.keys(patch).length > 0) {
        try {
          await api.patch(`/tasks/${parent.id}`, patch)
          parent = { ...parent, listId: defaults.listId ?? parent.listId, dueDate: defaults.dueDate ?? parent.dueDate }
        } catch {
          // Reported via `listSaved`; the items still go in so nothing is lost.
          listSaved = false
        }
      }
      const failedItems: string[] = []
      let createdCount = 0
      const base = parent.subtaskTotal
      for (const [i, content] of items.entries()) {
        try {
          const row = await api.post<TaskRow | null>('/tasks', {
            parentId: parent.id,
            content,
            sortOrder: base + i + 1,
          })
          if (!row) throw new Error('Failed to create item')
          createdCount++
        } catch {
          // Not swallowed: the item goes back to the composer and the caller
          // toasts how many failed.
          failedItems.push(content)
        }
      }
      return {
        parent: { ...parent, subtaskTotal: parent.subtaskTotal + createdCount },
        failedItems,
        createdCount,
        listSaved,
      }
    },
    [addTask],
  )

  return { createReminder, createChecklist }
}
