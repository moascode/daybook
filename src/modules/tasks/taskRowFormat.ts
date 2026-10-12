import { format, parseISO } from 'date-fns'
import { todayISO } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

/** Whole days between two YYYY-MM-DD strings, UTC-anchored so DST never skews it. */
export function dayDiff(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number)
  const [y2, m2, d2] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** How many days ago `dateIso` was, relative to today. Positive = in the past. */
export function daysLate(dateIso: string): number {
  return dayDiff(dateIso, todayISO())
}

// completedAt is a space-separated SQLite datetime ("YYYY-MM-DD HH:MM:SS");
// parseISO needs the 'T' separator.
function formatClock(datetime: string): string {
  return format(parseISO(datetime.replace(' ', 'T')), 'HH:mm')
}

/** "09:48" — the exact time a task was completed (today's Done group only shows today's completions). */
export function formatCompletedTime(completedAt: string): string {
  return formatClock(completedAt)
}

/** Is `timeStr` ("HH:MM[:SS]") still ahead of `now`? Used to decide the amber/neutral tint for a due-today time. */
export function isTimeAhead(timeStr: string, now: Date = new Date()): boolean {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m >= nowMinutes
}

export type DueColumnState = 'late' | 'soon' | 'ok'

export interface DueColumns {
  /** The contextual, coloured column — "3 days late" / "by 18:00" / "Anytime" / a completion clock time. */
  relative: string
  /** The plain anchor column — "Thu 14" when late, otherwise "Today". */
  exact: string
  state: DueColumnState
}

/**
 * Today page due-column semantics (product-owner review of the v2 mockup
 * adoption): overdue rows get the days-late phrasing in red; a due-today row
 * with a time shows "by HH:MM" in amber only while that time is still ahead
 * of now, falling to neutral once it's passed; an untimed due-today row
 * reads "Anytime", never tinted; a completed row shows the exact clock time
 * it was finished. This row's groups (Overdue/Today/Done today) only ever
 * hold tasks due before today, due today, or completed today — "in N days"
 * phrasing is out of scope here on purpose.
 */
export function todayDueColumns(task: Task, now: Date = new Date()): DueColumns {
  if (task.isCompleted && task.completedAt) {
    return { relative: formatCompletedTime(task.completedAt), exact: 'Today', state: 'ok' }
  }
  if (!task.dueDate) return { relative: '—', exact: '—', state: 'ok' }

  const today = todayISO()
  if (task.dueDate < today) {
    const late = daysLate(task.dueDate)
    return {
      relative: late === 1 ? 'Yesterday' : `${late} days late`,
      exact: format(parseISO(task.dueDate), 'EEE d'),
      state: 'late',
    }
  }

  if (!task.dueTime) return { relative: 'Anytime', exact: 'Today', state: 'ok' }
  return {
    relative: `by ${task.dueTime.slice(0, 5)}`,
    exact: 'Today',
    state: isTimeAhead(task.dueTime, now) ? 'soon' : 'ok',
  }
}

export function recurrenceLabel(task: Task): string | null {
  if (!task.recurrence) return null
  const interval = task.recurrenceData?.interval ?? 1
  if (task.recurrence === 'custom') return 'Repeats on a custom schedule'
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[task.recurrence]
  return interval > 1 ? `Repeats every ${interval} ${unit}s` : `Repeats ${task.recurrence}`
}
