import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import type { Habit, HabitDayEntry, HabitLinkedKind, HabitStats } from '@/types/habits.types'

/** DB row shape (+ server-computed `stats`) returned by the habits endpoints. */
interface HabitRow {
  id: string
  user_id: string
  name: string
  color: string
  icon: string | null
  target_per_week: number
  schedule: string | null
  linked_kind: HabitLinkedKind | null
  archived: number
  created_at: string
  updated_at: string
  stats: {
    entries: { date: string; done: boolean; due: boolean }[]
    currentStreak: number
    bestStreak: number
    weekdayRates: number[]
    weeklyRate: number
  }
}

function rowToHabit(row: HabitRow): Habit {
  const stats: HabitStats = {
    entries: row.stats.entries as HabitDayEntry[],
    currentStreak: row.stats.currentStreak,
    bestStreak: row.stats.bestStreak,
    weekdayRates: row.stats.weekdayRates,
    weeklyRate: row.stats.weeklyRate,
  }
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    targetPerWeek: row.target_per_week,
    schedule: row.schedule ? (JSON.parse(row.schedule) as number[]) : null,
    linkedKind: row.linked_kind,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats,
  }
}

export function useHabits() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [loaded, setLoaded] = useState(false)

  const loadHabits = useCallback(async (includeArchived = false): Promise<Habit[]> => {
    const rows = await api.get<HabitRow[]>(`/habits${includeArchived ? '?archived=1' : ''}`)
    const mapped = rows.map(rowToHabit)
    setHabits(mapped)
    setLoaded(true)
    return mapped
  }, [])

  const createHabit = useCallback(
    async (input: {
      name: string
      color?: string
      icon?: string | null
      targetPerWeek?: number
      schedule?: number[] | null
      linkedKind?: HabitLinkedKind | null
    }): Promise<Habit> => {
      let row: HabitRow
      try {
        row = await api.post<HabitRow>('/habits', input)
      } catch (err) {
        useToastStore.getState().addToast({ message: errorMessage(err, 'Could not create that habit — please try again.') })
        throw err
      }
      const habit = rowToHabit(row)
      setHabits((prev) => [...prev, habit])
      return habit
    },
    [],
  )

  const updateHabit = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string
        color: string
        icon: string | null
        targetPerWeek: number
        schedule: number[] | null
        archived: boolean
      }>,
    ): Promise<void> => {
      let row: HabitRow
      try {
        row = await api.patch<HabitRow>(`/habits/${id}`, updates)
      } catch (err) {
        useToastStore.getState().addToast({ message: errorMessage(err, 'Could not save your change — please try again.') })
        return
      }
      const habit = rowToHabit(row)
      setHabits((prev) => (updates.archived ? prev.filter((h) => h.id !== id) : prev.map((h) => (h.id === id ? habit : h))))
    },
    [],
  )

  const deleteHabit = useCallback(async (id: string): Promise<void> => {
    const previous = habits
    setHabits((prev) => prev.filter((h) => h.id !== id))
    try {
      await api.delete(`/habits/${id}`)
    } catch (err) {
      setHabits(previous)
      useToastStore.getState().addToast({ message: errorMessage(err, 'Could not delete that habit — please try again.') })
    }
  }, [habits])

  /** Toggle a manually-tracked habit's entry for `date` (defaults to today, server-derived). */
  const toggleHabitEntry = useCallback(async (id: string, date?: string): Promise<void> => {
    let row: HabitRow
    try {
      row = await api.post<HabitRow>(`/habits/${id}/toggle`, date ? { date } : {})
    } catch (err) {
      useToastStore.getState().addToast({ message: errorMessage(err, 'Could not save that — please try again.') })
      return
    }
    const habit = rowToHabit(row)
    setHabits((prev) => prev.map((h) => (h.id === id ? habit : h)))
  }, [])

  return { habits, loaded, loadHabits, createHabit, updateHabit, deleteHabit, toggleHabitEntry }
}
