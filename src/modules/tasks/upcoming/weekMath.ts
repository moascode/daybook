import { addDays, format, isSameMonth, parseISO, startOfWeek } from 'date-fns'
import type { Task } from '@/types/tasks.types'

// Pure date/planning helpers for the Upcoming week board (FEAT-026/FEAT-057
// mockup parity). Kept dependency-free of React and of the page's own
// fetch/mutation plumbing so they're trivially unit-testable and reusable
// between the page and its subcomponents.

/** Monday (weekStartsOn: 1) of the week containing `dateIso`. */
export function mondayOf(dateIso: string): string {
  return format(startOfWeek(parseISO(dateIso), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

/** The 7 dates (Mon→Sun) of the week starting on `monday`. */
export function weekDatesFrom(monday: string): string[] {
  const m = parseISO(monday)
  return Array.from({ length: 7 }, (_, i) => format(addDays(m, i), 'yyyy-MM-dd'))
}

/** `dateIso` shifted by `days` (negative moves earlier). */
export function shiftDate(dateIso: string, days: number): string {
  return format(addDays(parseISO(dateIso), days), 'yyyy-MM-dd')
}

/** "12–18 Oct" within one month, "28 Sep – 4 Oct" across a month boundary. */
export function formatWeekRange(monday: string): string {
  const start = parseISO(monday)
  const end = addDays(start, 6)
  if (isSameMonth(start, end)) {
    return `${format(start, 'd')}–${format(end, 'd')} ${format(start, 'MMM')}`
  }
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`
}

/** The band card's title: "This week" / "Next week" for the adjacent cases, else the date range. */
export function bandTitle(weekOffset: number, rangeLabel: string): string {
  if (weekOffset === 0) return 'This week'
  if (weekOffset === 1) return 'Next week'
  return rangeLabel
}

export interface UsualWeek {
  /** Rounded average tasks completed per week over the previous 8 weeks. */
  avgPerWeek: number
  /** Signed % difference between `thisWeekCount` and `avgPerWeek`, or null if they're equal (nothing honest to say). */
  percentDiff: number | null
}

/**
 * "Your usual week" (FEAT-057 mockup, band-stat #3) — honest only when there's
 * actual completion history to compare against; omit the whole stat
 * (return null) rather than show "0" as if it meant something. Window is the
 * 8 full weeks immediately before `displayedMonday`, regardless of which
 * week is currently displayed, so the baseline doesn't shift as you page
 * through weeks — only the comparison (`thisWeekCount`, the caller's
 * `scheduledCount`) does.
 */
export function usualWeek(completedTasks: Task[], displayedMonday: string, thisWeekCount: number): UsualWeek | null {
  const windowEnd = shiftDate(displayedMonday, -1)
  const windowStart = shiftDate(displayedMonday, -56)
  const count = completedTasks.filter((t) => {
    if (!t.completedAt) return false
    const date = t.completedAt.slice(0, 10)
    return date >= windowStart && date <= windowEnd
  }).length
  const avg = count / 8
  if (avg < 0.5) return null // rounds to 0 — no honest baseline to show
  const avgPerWeek = Math.round(avg)
  const percentDiff = avgPerWeek === thisWeekCount ? null : Math.round(((thisWeekCount - avgPerWeek) / avgPerWeek) * 100)
  return { avgPerWeek, percentDiff }
}

export interface AutoScheduleAssignment {
  taskId: string
  date: string
}

export interface AutoScheduleResult {
  assignments: AutoScheduleAssignment[]
  /** Tasks that couldn't be placed because no day in the displayed week is today or later. */
  skipped: number
}

/**
 * "Auto-schedule into the gaps" (FEAT-057/EP-07): each undated task, in
 * creation order, goes to whichever day of the displayed week (today or
 * later only) currently holds the fewest tasks — ties keep the earliest
 * day, since `weekDates` is scanned in ascending order and a day only
 * displaces the running pick on a STRICTLY lower count. Local to this
 * planner; the caller is responsible for actually persisting each
 * assignment (grouped by date, via `rescheduleTasks`) and reporting the
 * `skipped` count rather than silently dropping those tasks (CLAUDE.md rule 10).
 */
export function planAutoSchedule(
  undatedTasks: Task[],
  weekDates: string[],
  today: string,
  currentCounts: Map<string, number>,
): AutoScheduleResult {
  const eligibleDays = weekDates.filter((d) => d >= today)
  if (eligibleDays.length === 0) return { assignments: [], skipped: undatedTasks.length }

  const counts = new Map(eligibleDays.map((d) => [d, currentCounts.get(d) ?? 0]))
  const assignments: AutoScheduleAssignment[] = []
  for (const task of undatedTasks) {
    let bestDay = eligibleDays[0]
    let bestCount = counts.get(bestDay) ?? 0
    for (const d of eligibleDays) {
      const c = counts.get(d) ?? 0
      if (c < bestCount) {
        bestCount = c
        bestDay = d
      }
    }
    assignments.push({ taskId: task.id, date: bestDay })
    counts.set(bestDay, bestCount + 1)
  }
  return { assignments, skipped: 0 }
}

/** "Tue–Sat" (or just "Tue" for a single day) — the span of days an auto-schedule run actually used. */
export function describeAssignedDays(assignments: AutoScheduleAssignment[]): string {
  if (assignments.length === 0) return ''
  const days = [...new Set(assignments.map((a) => a.date))].sort()
  const first = format(parseISO(days[0]), 'EEE')
  const last = format(parseISO(days[days.length - 1]), 'EEE')
  return first === last ? first : `${first}–${last}`
}
