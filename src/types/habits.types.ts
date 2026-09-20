// FEAT-029 (docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md).

export type HabitLinkedKind = 'wallet:no-spend'

export interface HabitDayEntry {
  date: string
  done: boolean
  due: boolean
}

export interface HabitStats {
  /** Last 28 days, oldest first. */
  entries: HabitDayEntry[]
  currentStreak: number
  bestStreak: number
  /** Index 0=Sun..6=Sat — fraction of due days kept, over the last 12 weeks. */
  weekdayRates: number[]
  /** This week's kept count / targetPerWeek, capped at 1. */
  weeklyRate: number
}

export interface Habit {
  id: string
  name: string
  color: string
  icon: string | null
  targetPerWeek: number
  /** 0=Sun..6=Sat; null = due every day. */
  schedule: number[] | null
  linkedKind: HabitLinkedKind | null
  archived: boolean
  createdAt: string
  updatedAt: string
  stats: HabitStats
}
