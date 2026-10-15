import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { bandTitle, formatWeekRange, mondayOf, shiftDate, weekDatesFrom } from './weekMath'

// Pure helpers for Upcoming's Week / Fortnight / Month ranges. The page keeps
// one `anchor` date; every range is derived from it, so switching range keeps
// you on the same stretch of calendar.

export type UpcomingRange = 'week' | 'fortnight' | 'month'

export const UPCOMING_RANGES: UpcomingRange[] = ['week', 'fortnight', 'month']

/** Narrow the raw `?range=` value; anything unknown falls back to week. */
export function parseRange(raw: string | null): UpcomingRange {
  return raw === 'fortnight' || raw === 'month' ? raw : 'week'
}

/** The anchor after stepping `dir` (±1) ranges: 7 days, 14 days or one calendar month. */
export function stepAnchor(anchor: string, range: UpcomingRange, dir: 1 | -1): string {
  if (range === 'week') return shiftDate(anchor, dir * 7)
  if (range === 'fortnight') return shiftDate(anchor, dir * 14)
  return format(addMonths(startOfMonth(parseISO(anchor)), dir), 'yyyy-MM-dd')
}

/** Every date the board/grid draws: 7, 14, or the Monday-start month grid (leading/trailing days included). */
export function gridDates(anchor: string, range: UpcomingRange): string[] {
  if (range === 'week') return weekDatesFrom(mondayOf(anchor))
  if (range === 'fortnight') {
    const monday = mondayOf(anchor)
    return [...weekDatesFrom(monday), ...weekDatesFrom(shiftDate(monday, 7))]
  }
  const first = format(startOfMonth(parseISO(anchor)), 'yyyy-MM-dd')
  const last = format(endOfMonth(parseISO(anchor)), 'yyyy-MM-dd')
  const gridStart = mondayOf(first)
  const lastMonday = mondayOf(last)
  const weeks = Math.round((parseISO(lastMonday).getTime() - parseISO(gridStart).getTime()) / (7 * 86_400_000)) + 1
  return Array.from({ length: weeks }, (_, i) => weekDatesFrom(shiftDate(gridStart, i * 7))).flat()
}

/** The dates the range's stats describe: the grid, minus a month grid's muted neighbour days. */
export function statDates(anchor: string, range: UpcomingRange): string[] {
  const grid = gridDates(anchor, range)
  if (range !== 'month') return grid
  const month = anchor.slice(0, 7)
  return grid.filter((d) => d.startsWith(month))
}

/** "October 2026" — the month header. */
export function formatMonthLabel(anchor: string): string {
  return format(parseISO(anchor), 'MMMM yyyy')
}

/** The band card's title for the displayed range. */
export function rangeBandTitle(anchor: string, range: UpcomingRange, today: string): string {
  if (range === 'week') {
    const offset = Math.round(
      (parseISO(mondayOf(anchor)).getTime() - parseISO(mondayOf(today)).getTime()) / (7 * 86_400_000),
    )
    return bandTitle(offset, formatWeekRange(mondayOf(anchor)))
  }
  if (range === 'fortnight') {
    const here = mondayOf(anchor)
    const now = mondayOf(today)
    if (here === now) return 'This fortnight'
    if (here === shiftDate(now, 14)) return 'Next fortnight'
    return `${format(parseISO(here), 'd MMM')} – ${format(parseISO(shiftDate(here, 13)), 'd MMM')}`
  }
  const month = anchor.slice(0, 7)
  if (month === today.slice(0, 7)) return 'This month'
  if (month === stepAnchor(today, 'month', 1).slice(0, 7)) return 'Next month'
  return formatMonthLabel(anchor)
}

/** "seven days" / "fourteen days" / "31 days" — what the band's big figure spans. */
export function rangeSpanLabel(range: UpcomingRange, dayCount: number): string {
  if (range === 'week') return 'seven days'
  if (range === 'fortnight') return 'fourteen days'
  return `${dayCount} days`
}

/** Whether `today` falls inside the range containing `anchor` (drives "This …" being disabled). */
export function rangeContains(anchor: string, range: UpcomingRange, today: string): boolean {
  return statDates(anchor, range).includes(today)
}
