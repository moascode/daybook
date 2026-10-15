// FEAT-029 / FEAT-061 (docs/backlog/EP-07-tasks-depth/) — pure constants and
// math shared across the Habits page's cards. Split out of the former
// monolithic TasksHabitsPage.tsx so each card file can import only what it
// needs (CLAUDE.md §2 rule 6: one concern per file).
import { todayISO } from '@/lib/utils'
import type { Habit, HabitDayEntry } from '@/types/habits.types'

export const COLOR_PRESETS = [
  '#10b981', '#059669', '#3b82f6', '#6366f1',
  '#8b5cf6', '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6',
]

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Mon..Sun display order for the weekday chart/band, independent of the
 * 0=Sun..6=Sat index the server's `weekdayRates` uses. */
export const WEEK_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
/** Ring stroke colour fallback, cycled by position — used only for a habit
 * that somehow has no `color` of its own (every habit created through this
 * page's form always gets one; see review fix #9: `habit.color` already
 * exists on the data model and now drives the ring directly, rather than
 * the fixed cycle silently overriding a control the create-habit modal
 * still shows). */
export const RING_COLORS = ['rgb(var(--calm))', 'rgb(var(--info))', 'rgb(var(--alt))', 'rgb(var(--warn))']

export const RING_RADIUS = 40
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** `.bars`/`.bar-fill` (charts.css) size their bars by an explicit pixel
 * height, not a CSS percentage — `.bars` itself declares no height for a
 * percentage to resolve against. This is the 0-100% → px scale `.bar-fill`
 * uses. */
export const BAR_MAX_PX = 100
/** `.bars-avg`'s `bottom` and `.bar-fill`'s `height` are NOT the same
 * coordinate space: `.bars` aligns each `.bar` to its own bottom
 * (`align-items: flex-end`), but a `.bar`'s own bottom edge is the bottom of
 * its `.bar-day` label, not the bottom of `.bar-fill` — the label (and the
 * gap above it) sits below the fill inside that box. Left unaccounted for,
 * the dashed average line reads ~24px too low against the bars it's
 * supposed to mark. `WeekRhythm.tsx`'s identical `.bars`/`.bars-avg` chart
 * already carries this exact +24 correction — reused here rather than
 * re-deriving it. */
export const BAR_FOOT_OFFSET_PX = 24

/** Whether `weekday` (0=Sun..6=Sat) is a day `schedule` is due at all — the
 * same rule `worker/routes/habits.ts`'s `isDueOn` uses server-side. */
export function isDueOn(schedule: number[] | null, weekday: number): boolean {
  return schedule === null || schedule.includes(weekday)
}

/** 0=Sun..6=Sat for a YYYY-MM-DD date string, pure calendar-date arithmetic —
 * same approach as `worker/routes/habits.ts`'s `weekdayOf`. Deliberately NOT
 * `parseISO(date).getUTCDay()`: `parseISO` parses a date-only string at local
 * midnight, so `.getUTCDay()` on it reads the PREVIOUS day's weekday for
 * anyone west of UTC — this stays entirely in Y/M/D integers instead. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Kept/due counts over a habit's 28-day grid window (`habit.stats.entries`). */
/** A due day that counts toward a rate: kept, or already over. Today, not
 *  yet ticked, isn't a miss — the day isn't finished — so it stays out of
 *  every kept-rate until it's ticked or tomorrow arrives. */
export function countsAsDue(e: HabitDayEntry): boolean {
  return e.due && (e.done || e.date !== todayISO())
}

export function keptAndDue(entries: HabitDayEntry[]): { kept: number; due: number } {
  let kept = 0
  let due = 0
  for (const e of entries) {
    if (countsAsDue(e)) {
      due++
      if (e.done) kept++
    }
  }
  return { kept, due }
}

/** 28-day kept-rate (kept due days ÷ due days), 0 when the habit was never due. */
export function keptRate28(habit: Habit): number {
  const { kept, due } = keptAndDue(habit.stats.entries)
  return due > 0 ? kept / due : 0
}

/** "Every day" / "Weekdays" / "Mon, Wed, Fri" — see FEAT-061's "does NOT
 * build" note: no every-N-days cadence, the data model only has a
 * day-of-week schedule or none. The "· Wallet" suffix is the ONLY category
 * chip this page shows, because it is the only one backed by real data
 * (`linkedKind`) — there is no general "list"/"category" concept on a habit
 * to fabricate one for every other row. */
export function scheduleDescription(habit: Habit): string {
  const base = (() => {
    if (habit.schedule === null) return 'Every day'
    const sorted = [...habit.schedule].sort()
    if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'Weekdays'
    return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ')
  })()
  return habit.linkedKind === 'wallet:no-spend' ? `${base} · Wallet` : base
}

/** Pooled kept/due per weekday (0=Sun..6=Sat) across every active habit's
 * 28-day `entries` — the SINGLE aggregation both the Consistency card's
 * "Weakest day" stat and the "Kept by weekday" chart read (FEAT-061 review
 * fix #2: these previously used two different windows — this one pools the
 * per-habit 12-week `weekdayRates` — and disagreed about which day was
 * weakest). */
export function pooledWeekdayStats(habits: Habit[]): { due: number[]; kept: number[]; rates: number[] } {
  const due = new Array(7).fill(0)
  const kept = new Array(7).fill(0)
  for (const h of habits) {
    for (const e of h.stats.entries) {
      if (!countsAsDue(e)) continue
      const weekday = weekdayOf(e.date)
      due[weekday]++
      if (e.done) kept[weekday]++
    }
  }
  const rates = due.map((d, i) => (d > 0 ? kept[i] / d : 0))
  return { due, kept, rates }
}
