import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { updateRow, todayStr } from '../lib.ts'

// FEAT-029 (docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md) — Habits.
// A habit is a repeated commitment tracked by day (habit_entries), a
// different shape from a task: there is no due-dated instance, only whether
// today (or any given day) counts as kept. Mounted behind requireAuth
// (worker/index.ts).
export const habits = new Hono<AppEnv>()

const HABIT_COLS: Record<string, string> = {
  name: 'name',
  color: 'color',
  icon: 'icon',
  targetPerWeek: 'target_per_week',
  schedule: 'schedule',
  archived: 'archived',
  // linkedKind is deliberately NOT here — it is set once at creation and
  // never changed by PATCH (changing what a habit is linked to after the
  // fact would silently rewrite its whole history's meaning).
}

interface HabitRow {
  id: string
  user_id: string
  name: string
  color: string
  icon: string | null
  target_per_week: number
  schedule: string | null
  linked_kind: string | null
  archived: number
  created_at: string
  updated_at: string
}

function parseSchedule(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as number[]) : null
  } catch {
    return null
  }
}

/** Whether `weekday` (0=Sun..6=Sat) is a day this habit is due at all. */
function isDueOn(schedule: number[] | null, weekday: number): boolean {
  return schedule === null || schedule.includes(weekday)
}

// "No spend day" (design.md) — done derives from there being no expense
// transaction that day, rather than an explicit habit_entries row. Fetched
// once per computeStats call (a single query for the whole window) rather
// than per day — the window is up to 84 days, and a per-day query would mean
// 84 round trips for one habit. transactions.user_id is the creator, i.e.
// already the viewer's own money (§3 Money trap: never sum GET /api/accounts's
// shared-in rows for a total — this reads transactions directly, scoped the
// same way).
async function noSpendDatesInRange(db: D1Database, userId: string, from: string, to: string): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT DISTINCT date FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ? AND date <= ?`)
    .bind(userId, from, to)
    .all<{ date: string }>()
  return new Set(results.map((r) => r.date))
}

function isDoneOn(
  habit: HabitRow,
  entries: Map<string, number>,
  spendDates: Set<string> | null,
  date: string,
): boolean {
  if (habit.linked_kind === 'wallet:no-spend') return !spendDates!.has(date)
  return entries.get(date) === 1
}

/** Local calendar date, `days` before `dateStr` (both YYYY-MM-DD), pure UTC arithmetic. */
function dateMinusDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

interface HabitStats {
  entries: { date: string; done: boolean; due: boolean }[]
  currentStreak: number
  bestStreak: number
  /** The date (YYYY-MM-DD) `bestStreak`'s run ended, within the stats window — null if bestStreak is 0.
   *  FEAT-061: ties (multiple runs of the same max length) report the most recent one. */
  bestStreakEnd: string | null
  weekdayRates: number[] // index 0=Sun..6=Sat; fraction of due days kept, over the last 84 days (12 weeks)
  weeklyRate: number // this week's kept / target_per_week
}

// 84 days (12 weeks) is enough to make each weekday's rate meaningful without
// scanning a habit's entire history on every list load.
const STATS_WINDOW_DAYS = 84
const GRID_DAYS = 28

type WindowDay = { date: string; done: boolean; due: boolean }

/** Fetches + builds the full `STATS_WINDOW_DAYS` (oldest-first) due/done
 * window for one habit — the single DB round trip `computeStats` and
 * `computeJointStats` (FEAT-061 review fix #6) both build their numbers from,
 * so a joint "all habits kept" streak can see the same 84-day history each
 * habit's own streak is computed over, not just the 28-day grid slice. */
async function computeWindow(db: D1Database, habit: HabitRow, today: string): Promise<WindowDay[]> {
  const windowStart = dateMinusDays(today, STATS_WINDOW_DAYS - 1)
  const { results } = await db
    .prepare('SELECT date, done FROM habit_entries WHERE habit_id = ? AND date >= ? AND date <= ?')
    .bind(habit.id, windowStart, today)
    .all<{ date: string; done: number }>()
  const entryMap = new Map(results.map((r) => [r.date, r.done]))
  const schedule = parseSchedule(habit.schedule)
  const spendDates =
    habit.linked_kind === 'wallet:no-spend' ? await noSpendDatesInRange(db, habit.user_id, windowStart, today) : null

  const window: WindowDay[] = []
  for (let i = STATS_WINDOW_DAYS - 1; i >= 0; i--) {
    const date = dateMinusDays(today, i)
    const weekday = weekdayOf(date)
    const due = isDueOn(schedule, weekday)
    const done = isDoneOn(habit, entryMap, spendDates, date)
    window.push({ date, done, due })
  }
  return window
}

/** Pure (no DB) — derives one habit's stats from its already-fetched window. */
function computeStatsFromWindow(habit: HabitRow, window: WindowDay[]): HabitStats {
  const today = window[window.length - 1]!.date
  const dueByWeekday = new Array(7).fill(0)
  const keptByWeekday = new Array(7).fill(0)
  let bestStreak = 0
  let bestStreakEnd: string | null = null
  let runningStreak = 0
  // Oldest-first, so `entries` and the weekday tallies can be built forward
  // in one pass; the whole window (not just the 28-day grid slice), since
  // bestStreak needs the full history to find its longest run.
  const entries: WindowDay[] = []

  for (let idx = 0; idx < window.length; idx++) {
    const { date, done, due } = window[idx]!
    const weekday = weekdayOf(date)

    if (due) {
      dueByWeekday[weekday]++
      if (done) keptByWeekday[weekday]++
    }

    if (due && done) {
      runningStreak++
      // >= (not >) so a later run that TIES the max reports its own end date —
      // "ended {date}" should name the most recent occurrence, not the first.
      if (runningStreak >= bestStreak) {
        bestStreak = runningStreak
        bestStreakEnd = date
      }
    } else if (due) {
      runningStreak = 0
    }

    if (window.length - idx <= GRID_DAYS) entries.push({ date, done, due })
  }

  // Current streak: walk backward from today (the END of `window`) — a day
  // that isn't due doesn't break it (skipping a day the habit was never
  // scheduled on shouldn't cost the streak); a due, unkept day does, and only
  // ever the first one found walking backward. Iterating `window` forward
  // (oldest-first, above) would find the streak at the START of the window
  // instead of the one ending today, which is the bug this replaced.
  let currentStreak = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const day = window[i]!
    // Today is a special case for a MANUALLY-tracked habit only: due-but-
    // not-yet-checked-off doesn't break the streak, since the day isn't over
    // and the user may still tick it — it just doesn't extend the streak
    // either. Without this, every manual streak reads 0 from midnight until
    // the user ticks today. A linked habit (e.g. wallet:no-spend) derives
    // `done` from something that already happened today (a transaction was
    // or wasn't posted) — there is nothing left to "still do," so its today
    // is judged the same as any other day.
    if (day.due && !day.done) {
      if (day.date === today && !habit.linked_kind) continue
      break
    }
    if (day.due && day.done) currentStreak++
  }

  const weekdayRates = dueByWeekday.map((due, i) => (due > 0 ? keptByWeekday[i] / due : 0))

  // This week: Monday..today (or the whole week if archived/no schedule),
  // matching the design's "target_per_week" framing.
  let weekStart = today
  for (let i = 0; i < 6; i++) {
    const wd = weekdayOf(weekStart)
    if (wd === 1) break
    weekStart = dateMinusDays(weekStart, 1)
  }
  const keptThisWeek = entries.filter((e) => e.date >= weekStart && e.done).length
  const weeklyRate = habit.target_per_week > 0 ? Math.min(1, keptThisWeek / habit.target_per_week) : 0

  return { entries, currentStreak, bestStreak, bestStreakEnd, weekdayRates, weeklyRate }
}

async function computeStats(db: D1Database, habit: HabitRow, today: string): Promise<HabitStats> {
  const window = await computeWindow(db, habit, today)
  return computeStatsFromWindow(habit, window)
}

/** FEAT-061 review fix #6 — the joint "every habit due that day was kept"
 * streak, computed server-side over each habit's full `STATS_WINDOW_DAYS`
 * window (not the client's 28-day grid slice), so it can't disagree with a
 * per-habit card that legitimately shows a longer streak than 28 days.
 * Mirrors the per-habit day-status rule above, applied jointly: a date is
 * 'broken' the moment any habit due that date was missed (today is forgiven
 * for a manually-tracked habit not yet ticked), 'kept' when at least one
 * habit was due and kept with none missed, otherwise 'skip'. */
function computeJointStats(
  habits: HabitRow[],
  windows: WindowDay[][],
): { currentStreak: number; bestRun: { length: number; end: string } | null } {
  if (habits.length === 0) return { currentStreak: 0, bestRun: null }
  const dates = windows[0]!.map((d) => d.date)
  const today = dates[dates.length - 1]!

  const statuses: ('kept' | 'skip' | 'broken')[] = dates.map((date, i) => {
    let broken = false
    let anyCounted = false
    for (let h = 0; h < habits.length; h++) {
      const day = windows[h]![i]
      if (!day) continue
      if (day.due && !day.done) {
        if (date === today && !habits[h]!.linked_kind) continue
        broken = true
        break
      }
      if (day.due && day.done) anyCounted = true
    }
    return broken ? 'broken' : anyCounted ? 'kept' : 'skip'
  })

  let currentStreak = 0
  for (let i = statuses.length - 1; i >= 0; i--) {
    if (statuses[i] === 'broken') break
    if (statuses[i] === 'kept') currentStreak++
  }

  let bestLen = 0
  let bestEnd: string | null = null
  let runLen = 0
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] === 'broken') {
      runLen = 0
    } else if (statuses[i] === 'kept') {
      runLen++
      // Same >= tie-break as the per-habit bestStreak above.
      if (runLen >= bestLen) {
        bestLen = runLen
        bestEnd = dates[i]!
      }
    }
  }

  return { currentStreak, bestRun: bestLen > 0 ? { length: bestLen, end: bestEnd! } : null }
}

habits.get('/habits', async (c) => {
  const userId = c.get('userId')
  const includeArchived = c.req.query('archived') === '1'
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM habits WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY created_at ASC`,
  )
    .bind(userId)
    .all<HabitRow>()

  const today = todayStr()
  const withStats = await Promise.all(
    results.map(async (habit) => ({ ...habit, stats: await computeStats(c.env.DB, habit, today) })),
  )
  return c.json(withStats)
})

// FEAT-061 review fix #6 — a sibling, additive GET so `GET /habits`'s
// existing plain-array response shape (e2e/94 destructures it directly)
// doesn't have to change. The client was computing "all habits kept"
// current streak from only its 28-day `entries`, capping a figure that
// should be allowed to run as long as each habit's own `currentStreak`
// (84 days) — this recomputes it server-side over the same full window.
habits.get('/habits/joint-stats', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(`SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY created_at ASC`)
    .bind(userId)
    .all<HabitRow>()
  if (results.length === 0) return c.json({ currentStreak: 0, bestRun: null })

  const today = todayStr()
  const windows = await Promise.all(results.map((habit) => computeWindow(c.env.DB, habit, today)))
  return c.json(computeJointStats(results, windows))
})

const LINKED_KINDS = new Set(['wallet:no-spend'])

habits.post('/habits', async (c) => {
  const userId = c.get('userId')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (b.linkedKind != null && !LINKED_KINDS.has(String(b.linkedKind))) {
    return c.json({ error: 'unknown linkedKind' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO habits (id, user_id, name, color, icon, target_per_week, schedule, linked_kind, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, COALESCE(?, '#10b981'), ?, COALESCE(?, 7), ?, ?, datetime('now'), datetime('now'))
     RETURNING *`,
  )
    // userId, name, color, icon, targetPerWeek, schedule, linkedKind
    .bind(
      userId,
      b.name,
      b.color ?? null,
      b.icon ?? null,
      b.targetPerWeek ?? null,
      b.schedule != null ? JSON.stringify(b.schedule) : null,
      b.linkedKind ?? null,
    )
    .first<HabitRow>()

  const today = todayStr()
  return c.json({ ...row, stats: await computeStats(c.env.DB, row!, today) }, 201)
})

habits.patch('/habits/:id', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  if ('schedule' in body && body.schedule !== null && typeof body.schedule === 'object') {
    body.schedule = JSON.stringify(body.schedule)
  }
  const row = await updateRow<HabitRow>(c.env.DB, 'habits', c.req.param('id'), userId, HABIT_COLS, body)
  if (!row) return c.json({ error: 'habit not found' }, 404)
  const today = todayStr()
  return c.json({ ...row, stats: await computeStats(c.env.DB, row, today) })
})

habits.delete('/habits/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})

// Toggle a single day for a manually-tracked habit. Linked habits (e.g.
// wallet:no-spend) have no entries of their own — their `done` is always
// derived — so toggling one is rejected rather than silently no-op'd
// (CLAUDE.md §2 rule 10: no dead-end buttons).
habits.post('/habits/:id/toggle', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const date = typeof b.date === 'string' && b.date ? b.date : todayStr()

  const habit = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<HabitRow>()
  if (!habit) return c.json({ error: 'habit not found' }, 404)
  if (habit.linked_kind) {
    return c.json({ error: 'this habit is derived automatically and cannot be toggled by hand' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT done FROM habit_entries WHERE habit_id = ? AND date = ?')
    .bind(id, date)
    .first<{ done: number }>()

  if (existing) {
    await c.env.DB.prepare('DELETE FROM habit_entries WHERE habit_id = ? AND date = ?').bind(id, date).run()
  } else {
    await c.env.DB.prepare('INSERT INTO habit_entries (habit_id, date, done) VALUES (?, ?, 1)')
      .bind(id, date)
      .run()
  }

  const today = todayStr()
  return c.json({ ...habit, stats: await computeStats(c.env.DB, habit, today) })
})
