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
  /** Date `bestStreak`'s run ended (YYYY-MM-DD), within the 12-week stats window — null if bestStreak is 0. */
  bestStreakEnd: string | null
  /** Index 0=Sun..6=Sat — fraction of due days kept, over the last 12 weeks. */
  weekdayRates: number[]
  /** This week's kept count / targetPerWeek, capped at 1. */
  weeklyRate: number
}

/** The joint "all active habits kept" streak — `GET /habits/joint-stats`
 * (worker/routes/habits.ts), computed server-side over each habit's full
 * 84-day window (FEAT-061 review fix #6), not the client's 28-day grid. */
export interface JointHabitStats {
  currentStreak: number
  /** The longest joint run within that window — may be the still-running
   * current streak itself (its `end` is then today). */
  bestRun: { length: number; end: string } | null
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
