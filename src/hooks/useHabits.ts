import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import type { Habit, HabitDayEntry, HabitLinkedKind, HabitStats, JointHabitStats } from '@/types/habits.types'

/** DB row shape (+ server-computed `stats`) returned by the habits endpoints. */
interface HabitRow {
  id: string
  user_id: string
  name: string
  color: string
  icon: string | null
  target_per_week: number
  schedule: string | null
  interval_days: number | null
  linked_kind: HabitLinkedKind | null
  archived: number
  created_at: string
  updated_at: string
  stats: {
    entries: { date: string; done: boolean; due: boolean }[]
    currentStreak: number
    bestStreak: number
    bestStreakEnd: string | null
    weekdayRates: number[]
    weeklyRate: number
  }
}

function rowToHabit(row: HabitRow): Habit {
  const stats: HabitStats = {
    entries: row.stats.entries as HabitDayEntry[],
    currentStreak: row.stats.currentStreak,
    bestStreak: row.stats.bestStreak,
    bestStreakEnd: row.stats.bestStreakEnd,
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
    intervalDays: row.interval_days,
    linkedKind: row.linked_kind,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats,
  }
}

/** Toggle-in-flight key — one per habit+date, since two different dates on
 * the same habit (or the same date on two habits) are independent races. */
function toggleKey(id: string, date: string | undefined): string {
  return `${id}:${date ?? 'today'}`
}

export function useHabits() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [loaded, setLoaded] = useState(false)
  // Habit+date keys with a toggle currently in flight — HabitCard reads this
  // to aria-disable a dot and ignore further clicks on it while waiting.
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set())
  // Per-key monotonic request counter, so a slow, now-stale response can
  // never clobber the state a newer request for the SAME habit+date already
  // wrote. Ref, not state: it's bookkeeping read/written synchronously
  // around each request, never rendered.
  const toggleGenRef = useRef<Map<string, number>>(new Map())

  const loadHabits = useCallback(async (includeArchived = false): Promise<Habit[]> => {
    const rows = await api.get<HabitRow[]>(`/habits${includeArchived ? '?archived=1' : ''}`)
    const mapped = rows.map(rowToHabit)
    setHabits(mapped)
    setLoaded(true)
    return mapped
  }, [])

  /** The joint "all habits kept" streak, computed server-side over each
   * habit's full 84-day window (FEAT-061 review fix #6) — a sibling GET,
   * not folded into `loadHabits`'s response, so that endpoint's existing
   * plain-array shape doesn't change. */
  const loadJointStats = useCallback(async (): Promise<JointHabitStats> => {
    return api.get<JointHabitStats>('/habits/joint-stats')
  }, [])

  const createHabit = useCallback(
    async (input: {
      name: string
      color?: string
      icon?: string | null
      targetPerWeek?: number
      schedule?: number[] | null
      intervalDays?: number | null
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
        intervalDays: number | null
        archived: boolean
      }>,
    ): Promise<void> => {
      let row: HabitRow
      try {
        row = await api.patch<HabitRow>(`/habits/${id}`, updates)
      } catch (err) {
        useToastStore.getState().addToast({ message: errorMessage(err, 'Could not save your change — please try again.') })
        throw err
      }
      const habit = rowToHabit(row)
      // Always update the row in place rather than dropping it from state on
      // archive. Dropping it meant an already-open "Archived" section (which
      // reads this same `habits` array, filtered by `.archived`) lost the
      // habit it should have just gained, and had to be reopened/refetched
      // to show it. Mapping in place keeps both the active list and the
      // archived list correct from a single response, for both directions
      // (archive AND restore).
      setHabits((prev) => prev.map((h) => (h.id === id ? habit : h)))
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
      throw err
    }
  }, [habits])

  /** Toggle a manually-tracked habit's entry for `date` (defaults to today,
   * server-derived). Race-safe: while a toggle for this exact habit+date is
   * in flight, `pendingToggles` carries its key so the caller can ignore
   * further clicks, and if a second toggle is issued anyway (e.g. a toggle
   * fired just before this guard existed), only the response to the LATEST
   * request for that key is ever applied — an older, now-stale response
   * arriving after a newer one can't overwrite it. */
  const toggleHabitEntry = useCallback(async (id: string, date?: string): Promise<void> => {
    const key = toggleKey(id, date)
    const gen = (toggleGenRef.current.get(key) ?? 0) + 1
    toggleGenRef.current.set(key, gen)
    setPendingToggles((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    try {
      const row = await api.post<HabitRow>(`/habits/${id}/toggle`, date ? { date } : {})
      if (toggleGenRef.current.get(key) === gen) {
        const habit = rowToHabit(row)
        setHabits((prev) => prev.map((h) => (h.id === id ? habit : h)))
      }
    } catch (err) {
      useToastStore.getState().addToast({ message: errorMessage(err, 'Could not save that — please try again.') })
    } finally {
      // Only this request's own completion may clear the pending flag for
      // `key` — if a newer request for the same key is still outstanding,
      // clearing here would re-enable the dot while that newer request is
      // still in flight.
      if (toggleGenRef.current.get(key) === gen) {
        setPendingToggles((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    }
  }, [])

  return {
    habits,
    loaded,
    pendingToggles,
    loadHabits,
    loadJointStats,
    createHabit,
    updateHabit,
    deleteHabit,
    toggleHabitEntry,
  }
}
