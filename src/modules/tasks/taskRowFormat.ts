import { format, parseISO } from 'date-fns'
import { localDateOfUtc, todayISO } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

// Shared by every task row on the fixed-column `.task--cols` grid
// (tasks.css): the date columns, the age chip, the recurrence label and the
// row menu's classes. One definition, so Today, All tasks, Assigned,
// Completed and a list's page all read a task's dates the same way.

export const MENU_ITEM =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken'
export const MENU_CONTENT =
  'z-50 min-w-[180px] overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-xl shadow-line/60 animate-in fade-in-0 zoom-in-95'

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

/** "Added 4 months ago" — the mockup's chip for an undated task, so its age is visible. */
export function addedLabel(createdAt: string): string {
  const days = dayDiff(localDateOfUtc(createdAt), todayISO())
  if (days <= 0) return 'Added today'
  if (days === 1) return 'Added yesterday'
  if (days < 30) return `Added ${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `Added ${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `Added ${years} year${years === 1 ? '' : 's'} ago`
}

/**
 * The two trailing date columns, as in tasks-all.html: an exact column
 * ("Thu 14" when late, otherwise the due time) and a relative one
 * ("3 days late", "Today", "Mon 18"). Undated rows show a dash in both.
 * Used by AllTasksRow.tsx and every other non-Today row — TaskRow.tsx (the
 * Today page) uses the narrower `todayDueColumns` below instead, since its
 * groups only ever hold tasks due before today, due today, or completed
 * today, with their own amber/neutral rules for a due-today time.
 */
export function dateColumns(task: Task): { exact: string; relative: string; state: 'late' | 'soon' | 'ok' } {
  if (task.isCompleted) {
    const done = task.completedAt ? format(parseISO(task.completedAt.slice(0, 10)), 'd MMM') : ''
    return { exact: '', relative: done ? `Done ${done}` : 'Done', state: 'ok' }
  }
  if (!task.dueDate) return { exact: '—', relative: '—', state: 'ok' }
  const d = parseISO(task.dueDate)
  const diff = dayDiff(todayISO(), task.dueDate)
  // Untimed reads "Anytime" only on today's rows, where the question is live;
  // repeated down a whole week of rows it is just noise.
  const time = task.dueTime ? task.dueTime.slice(0, 5) : diff === 0 ? 'Anytime' : ''
  if (diff < 0) {
    const late = -diff
    return { exact: format(d, 'EEE d'), relative: late === 1 ? 'Yesterday' : `${late} days late`, state: 'late' }
  }
  // Amber marks a time that's actually coming up today; an untimed task due
  // today is ordinary, and tinting a whole day's worth of rows buries the one
  // that matters.
  if (diff === 0) return { exact: time, relative: 'Today', state: task.dueTime ? 'soon' : 'ok' }
  if (diff === 1) return { exact: time, relative: 'Tomorrow', state: 'ok' }
  return { exact: time, relative: format(d, diff < 7 ? 'EEE d' : 'd MMM'), state: 'ok' }
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
  if (task.recurrence === 'custom') return 'Repeats weekly'
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[task.recurrence]
  return interval > 1 ? `Repeats every ${interval} ${unit}s` : `Repeats ${task.recurrence}`
}
