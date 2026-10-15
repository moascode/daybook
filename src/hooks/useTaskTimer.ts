import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useTasksStore } from '@/stores/tasks.store'
import type { Task } from '@/types/tasks.types'

/** The slice of a task row the timer endpoints change. */
export type TrackedTimeFields = Pick<Task, 'trackedMinutes' | 'timerStartedAt'>

interface TimerRow {
  tracked_minutes: number
  timer_started_at: string | null
  updated_at?: string
  /** Present on start only: other tasks whose running timer this start stopped. */
  stoppedTimers?: { id: string; content: string }[]
}

function toFields(row: TimerRow): TrackedTimeFields {
  return { trackedMinutes: row.tracked_minutes, timerStartedAt: row.timer_started_at }
}

/**
 * Timer + manual-edit writes for a task's tracked time. Like `assignTask`,
 * these are guard-free direct calls (the task may have come from a
 * store-bypassing `loadTasks(view)`); every one rejects on failure so the
 * caller can toast, and the outliner store is only touched opportunistically.
 * Callers own the error toast — nothing here swallows a failure.
 */
export function useTaskTimer() {
  const syncStore = (id: string, fields: TrackedTimeFields) => {
    if (useTasksStore.getState().tasks.some((t) => t.id === id)) {
      useTasksStore.getState().updateTask(id, fields)
    }
  }

  const startTimer = useCallback(async (id: string) => {
    const row = await api.post<TimerRow>(`/tasks/${id}/timer/start`, {})
    const fields = toFields(row)
    syncStore(id, fields)
    return { fields, stoppedTimers: row.stoppedTimers ?? [] }
  }, [])

  const stopTimer = useCallback(async (id: string) => {
    const row = await api.post<TimerRow>(`/tasks/${id}/timer/stop`, {})
    const fields = toFields(row)
    syncStore(id, fields)
    return fields
  }, [])

  const setTrackedMinutes = useCallback(async (id: string, trackedMinutes: number) => {
    const row = await api.patch<TimerRow>(`/tasks/${id}`, { trackedMinutes })
    const fields = toFields(row)
    syncStore(id, fields)
    return fields
  }, [])

  return { startTimer, stopTimer, setTrackedMinutes }
}
