import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { updateRow, todayStr, nowStr, businessDateOf, daysBetween } from '../lib.ts'
import { isGroupMember, visibleListIds, writableListIds } from '../lib/sharing.ts'

// Port of server/routes/tasks.ts. Mounted behind requireAuth.
//
// The mechanical part of the conversion is `.get()/.all()/.run()` →
// awaited `.first()/.all()/.run()`. The part that needs attention is binding:
// D1 has no named parameters, so every `@name` becomes a `?` and the argument
// order must match the order the placeholders appear in the SQL. Each INSERT
// below is annotated with its bind order for that reason.
export const tasks = new Hono<AppEnv>()

// Columns a PATCH may touch (camelCase → column).
const TASK_COLS: Record<string, string> = {
  content: 'content',
  note: 'note',
  isCompleted: 'is_completed',
  isCollapsed: 'is_collapsed',
  parentId: 'parent_id',
  sortOrder: 'sort_order',
  dueDate: 'due_date',
  // R4 (docs/archive/design-adoption/tasks-data-model.md): additive columns for the designed
  // row. A caller may set these directly via PATCH; nothing here auto-derives
  // completedAt from isCompleted — that derivation lives only in
  // POST /tasks/:id/complete below, so the outliner's existing
  // PATCH { isCompleted } path (useTasks.ts) is untouched (D-3).
  listId: 'list_id',
  priority: 'priority',
  dueTime: 'due_time',
  assigneeId: 'assignee_id',
  completedAt: 'completed_at',
  // FEAT-027 (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md):
  // when the assignee was last set. Derived server-side in the PATCH handler
  // below — a client-supplied value is always discarded there. POST /tasks
  // does accept it verbatim (for the undo/restore path only, see its own
  // comment); that path is self-scoped (`user_id = caller`), so the only
  // thing a client could skew by lying here is their own turnaround stats.
  assignedAt: 'assigned_at',
  // FEAT-028 (docs/backlog/EP-07-tasks-depth/FEAT-028-task-recurrence.md).
  // recurrenceParentId is deliberately NOT here — it is only ever set by
  // POST /tasks/recurring/process below, never client-writable.
  recurrence: 'recurrence',
  recurrenceData: 'recurrence_data',
}

const RECURRENCE_FREQS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'custom'])

// ── Tasks ────────────────────────────────────────────

tasks.get('/tasks', async (c) => {
  const userId = c.get('userId')
  const view = c.req.query('view')

  // No `view` param: the outliner's original, unfiltered shape. Untouched by
  // R4 — this is the query 01-tasks.spec.ts exercises and must stay identical.
  if (!view) {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order ASC',
    )
      .bind(userId)
      .all()
    return c.json(results)
  }

  const listParam = c.req.query('list')
  const priority = c.req.query('priority')
  const assignee = c.req.query('assignee')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const q = c.req.query('q')
  const today = todayStr()

  // The literal string "unsorted" is a reserved sentinel for "no list" (tasks
  // with list_id IS NULL) — every user always has this bucket, so unlike a
  // real list id it needs no ownership/sharing check against visibleListIds.
  const isUnsortedSentinel = view === 'list' && listParam === 'unsorted'

  if (view === 'list' && !isUnsortedSentinel) {
    if (!listParam) return c.json({ error: 'list is required for view=list' }, 400)
    const visible = await visibleListIds(c.env.DB, userId)
    if (!visible.includes(listParam)) return c.json({ error: 'list not found' }, 404)
  }

  // Visible tasks: the caller's own, tasks assigned to the caller (D-15 —
  // matches the access POST /tasks/:id/complete already grants an assignee,
  // so the field is discoverable via view=assigned and not just actionable
  // by id), plus tasks in any list shared into a group they belong to.
  const conditions: string[] = [
    `(t.user_id = ? OR t.assignee_id = ? OR t.list_id IN (
       SELECT tls.list_id FROM task_list_shares tls
       JOIN group_members gm ON gm.group_id = tls.group_id
       WHERE gm.user_id = ?
     ))`,
  ]
  const whereParams: unknown[] = [userId, userId, userId]

  switch (view) {
    case 'today':
      conditions.push('t.is_completed = 0', 't.due_date IS NOT NULL', 't.due_date <= ?')
      whereParams.push(today)
      break
    case 'upcoming':
      conditions.push('t.is_completed = 0', 't.due_date IS NOT NULL', 't.due_date > ?')
      whereParams.push(today)
      break
    case 'all':
      conditions.push('t.is_completed = 0')
      break
    case 'list':
      if (isUnsortedSentinel) {
        conditions.push('t.is_completed = 0', 't.list_id IS NULL')
      } else {
        conditions.push('t.is_completed = 0', 't.list_id = ?')
        whereParams.push(listParam)
      }
      break
    case 'completed':
      conditions.push('t.is_completed = 1')
      break
    case 'assigned':
      // is_completed = 0 like every other open-work view (today/upcoming/
      // all/list) — a finished task shouldn't stay listed under "waiting on
      // you" forever (FEAT-027, docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md).
      conditions.push('t.is_completed = 0', 't.assignee_id = ?')
      whereParams.push(userId)
      break
    default:
      return c.json({ error: `unknown view: ${view}` }, 400)
  }

  if (priority) {
    conditions.push('t.priority = ?')
    whereParams.push(priority)
  }
  if (assignee) {
    conditions.push('t.assignee_id = ?')
    whereParams.push(assignee)
  }
  if (from) {
    conditions.push('t.due_date >= ?')
    whereParams.push(from)
  }
  if (to) {
    conditions.push('t.due_date <= ?')
    whereParams.push(to)
  }
  if (q) {
    conditions.push('t.content LIKE ?')
    whereParams.push(`%${q}%`)
  }

  // Two `?` placeholders for due_state appear (in the SQL string) before the
  // WHERE clause's, so `today` is bound twice up front — bind order must
  // match placeholder order in the final SQL text, not the order the pieces
  // were assembled in.
  const sql = `
    SELECT t.*,
      (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS subtask_total,
      (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.is_completed = 1) AS subtask_done,
      CASE
        WHEN t.due_date IS NULL THEN 'none'
        WHEN t.is_completed = 1 THEN 'done'
        WHEN t.due_date < ? THEN 'late'
        WHEN t.due_date = ? THEN 'soon'
        ELSE 'ok'
      END AS due_state
    FROM tasks t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.due_date IS NULL, t.due_date ASC, t.sort_order ASC
  `
  const { results } = await c.env.DB.prepare(sql)
    .bind(today, today, ...whereParams)
    .all()
  return c.json(results)
})

// Create (or restore). id/timestamps are optional: provided on restore so the
// original row is recreated verbatim; generated otherwise.
tasks.post('/tasks', async (c) => {
  const userId = c.get('userId')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  // A caller may only file a task into a list they can write to — their own,
  // or one shared to them with can_write=1. Without this check any
  // authenticated user could point a task at any list_id, including one they
  // cannot see, making the task appear inside a stranger's list for every
  // member it's shared with.
  if (b.listId) {
    const writable = await writableListIds(c.env.DB, userId)
    if (!writable.has(String(b.listId))) return c.json({ error: 'list not found' }, 404)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO tasks
       (id, user_id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date,
        list_id, priority, due_time, assignee_id, assigned_at, recurrence, recurrence_data,
        recurrence_parent_id, created_at, updated_at)
     VALUES
       (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, COALESCE(?, 'none'), ?, ?, ?,
        ?, ?, ?,
        COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
  )
    // id, userId, parentId, content, note,
    // isCompleted, isCollapsed, sortOrder, dueDate,
    // listId, priority, dueTime, assigneeId, assignedAt,
    // recurrence, recurrenceData, recurrenceParentId, createdAt, updatedAt
    .bind(
      b.id ?? null,
      userId,
      b.parentId ?? null,
      b.content ?? '',
      b.note ?? '',
      b.isCompleted ? 1 : 0,
      b.isCollapsed ? 1 : 0,
      b.sortOrder ?? 0,
      b.dueDate ?? null,
      b.listId ?? null,
      b.priority ?? null,
      b.dueTime ?? null,
      b.assigneeId ?? null,
      // Only a restore (undo of a delete) ever sends this — a fresh POST
      // from addTask() never sets an assignee at creation time, so this is
      // null for every normal create. See FEAT-027
      // (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md).
      b.assignedAt ?? null,
      // Same restore-only story as assignedAt above, for FEAT-028's
      // recurrence fields — a fresh addTask() never sets these.
      b.recurrence ?? null,
      b.recurrenceData != null && typeof b.recurrenceData === 'object'
        ? JSON.stringify(b.recurrenceData)
        : b.recurrenceData ?? null,
      b.recurrenceParentId ?? null,
      b.createdAt ?? null,
      b.updatedAt ?? null,
    )
    .first()

  // ON CONFLICT DO NOTHING means a restore of an existing id returns no row.
  // The Express version sent `null` with 201; preserved so the client's restore
  // path behaves identically.
  return c.json(row ?? null, 201)
})

tasks.patch('/tasks/:id', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  // Same write-scoping guard as POST /tasks — moving an existing (owned) task
  // into a list the caller can't write to is the same bypass as creating one
  // there directly. Clearing listId (null/'') is always allowed.
  if ('listId' in body && body.listId) {
    const writable = await writableListIds(c.env.DB, userId)
    if (!writable.has(String(body.listId))) return c.json({ error: 'list not found' }, 404)
  }

  // Deriving assigned_at here, not accepting it from the client, mirrors how
  // completed_at is only ever derived server-side (POST /tasks/:id/complete,
  // D-3) — a value other people's turnaround stats depend on shouldn't be
  // client-suppliable. `assignedAt` is in TASK_COLS so this derivation can
  // reach the column via updateRow below, which would otherwise let a caller
  // PATCH `{ assignedAt: '<anything>' }` directly — so any client-supplied
  // value is discarded first, and only ever replaced by the derivation
  // below. Setting a new assignee (including re-assigning to the same
  // person again) stamps "now"; clearing the assignee (assigneeId falsy)
  // clears the stamp too; PATCHing anything else leaves it untouched.
  delete body.assignedAt
  if ('assigneeId' in body) {
    body.assignedAt = body.assigneeId ? nowStr() : null
  }

  // FEAT-028: a recurrence needs a due date to advance from — reject setting
  // one on a task that has none and isn't gaining one in this same request,
  // rather than letting POST /tasks/recurring/process silently skip it later.
  if ('recurrence' in body && body.recurrence != null) {
    if (!RECURRENCE_FREQS.has(String(body.recurrence))) {
      return c.json({ error: 'recurrence must be daily, weekly, monthly, yearly, or custom' }, 400)
    }
    const dueDate = 'dueDate' in body
      ? body.dueDate
      : (
          await c.env.DB.prepare('SELECT due_date FROM tasks WHERE id = ? AND user_id = ?')
            .bind(c.req.param('id'), userId)
            .first<{ due_date: string | null }>()
        )?.due_date
    if (!dueDate) return c.json({ error: 'a task must have a due date to repeat' }, 400)
  }
  // Clearing recurrence without an explicit recurrenceData clears it too, so
  // stale interval/weekday/end data can't linger and reappear if the task is
  // ever set to repeat again with only `{ recurrence: '<freq>' }`.
  if ('recurrence' in body && body.recurrence == null && !('recurrenceData' in body)) {
    body.recurrenceData = null
  }
  if ('recurrenceData' in body && body.recurrenceData !== null && typeof body.recurrenceData === 'object') {
    body.recurrenceData = JSON.stringify(body.recurrenceData)
  }

  const row = await updateRow(c.env.DB, 'tasks', c.req.param('id'), userId, TASK_COLS, body)
  if (!row) return c.json({ error: 'task not found' }, 404)
  return c.json(row)
})

// Toggle completion, deriving completed_at along with is_completed — the
// derivation the generic PATCH above deliberately does not do (D-3). Allowed
// for the task's owner, its assignee, or a member with write access on its
// list (D-15).
tasks.post('/tasks/:id/complete', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const task = await c.env.DB.prepare(
    'SELECT id, user_id, assignee_id, list_id, is_completed FROM tasks WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string
      user_id: string
      assignee_id: string | null
      list_id: string | null
      is_completed: number
    }>()
  if (!task) return c.json({ error: 'task not found' }, 404)

  const writable = await writableListIds(c.env.DB, userId)
  const allowed =
    task.user_id === userId ||
    task.assignee_id === userId ||
    (task.list_id !== null && writable.has(task.list_id))
  if (!allowed) return c.json({ error: 'task not found' }, 404)

  const next = task.is_completed ? 0 : 1
  // completed_at must land on the business timezone's "today" (nowStr), not
  // SQL's own datetime('now') (UTC) — the client compares it against
  // todayStr()-derived dates to group "done today", and those two clocks
  // disagree for 8 hours every day (worker/lib.ts's nowStr doc comment).
  const row = await c.env.DB.prepare(
    `UPDATE tasks
     SET is_completed = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
         updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(next, next, nowStr(), id)
    .first()
  return c.json(row)
})

// Bulk due-date move for the overdue header's one-click action
// (docs/archive/design-adoption/tasks-data-model.md §4). Scoped to the caller's own tasks only —
// not sharing-aware, since a shared task's due date is the owner's call.
//
// Registered before /tasks/:id so a literal "reschedule" path segment can
// never be captured as an :id — harmless here since no other route shares
// this method+prefix, but kept explicit for the next person extending this file.
tasks.post('/tasks/reschedule', async (c) => {
  const userId = c.get('userId')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : []
  const dueDate = b.dueDate
  if (ids.length === 0) return c.json({ error: 'ids is required' }, 400)
  if (typeof dueDate !== 'string' || !dueDate) return c.json({ error: 'dueDate is required' }, 400)

  const placeholders = ids.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `UPDATE tasks SET due_date = ?, updated_at = datetime('now')
     WHERE user_id = ? AND id IN (${placeholders})
     RETURNING *`,
  )
    .bind(dueDate, userId, ...ids)
    .all()
  return c.json(results)
})

// ── Completed analytics (FEAT-030) ───────────────────

// A year heatmap, a by-list time-to-finish breakdown, and the overall
// average — everything comes from columns that already existed (completedAt,
// createdAt, listId), so this is read-only aggregation, no new schema.
//
// The day-to-day arithmetic happens in JS, not SQL, and deliberately treats
// completed_at and created_at asymmetrically: completed_at is already a
// business-timezone value (nowStr(), POST /tasks/:id/complete above) so its
// date is a plain `.slice(0, 10)`, while created_at's column default is raw
// SQL `datetime('now')` (UTC) and must go through businessDateOf() first.
// Running both through businessDateOf() — or worse, both through a bare
// slice — would silently reintroduce the up-to-8-hour skew CLAUDE.md §3
// documents for exactly this UTC-vs-business-timezone pairing, this time as
// a wrong "0 days" or "1 day" in a real user's numbers rather than a test
// failure. TasksCompletedPage.tsx's day-grouping comment made the same
// completed_at call already; this mirrors it for created_at.
tasks.get('/tasks/completed/analytics', async (c) => {
  const userId = c.get('userId')
  const since = dateMinusDays(todayStr(), 364)

  const { results } = await c.env.DB.prepare(
    `SELECT list_id, created_at, completed_at FROM tasks
     WHERE user_id = ? AND is_completed = 1 AND completed_at IS NOT NULL`,
  )
    .bind(userId)
    .all<{ list_id: string | null; created_at: string; completed_at: string }>()

  const heatmapCounts = new Map<string, number>()
  const byListAgg = new Map<string | null, { count: number; totalDays: number }>()
  let totalDaysAll = 0

  for (const row of results) {
    const completedDate = row.completed_at.slice(0, 10)
    const createdDate = businessDateOf(row.created_at)
    const days = Math.max(0, daysBetween(createdDate, completedDate))

    if (completedDate >= since) {
      heatmapCounts.set(completedDate, (heatmapCounts.get(completedDate) ?? 0) + 1)
    }

    const agg = byListAgg.get(row.list_id) ?? { count: 0, totalDays: 0 }
    agg.count++
    agg.totalDays += days
    byListAgg.set(row.list_id, agg)
    totalDaysAll += days
  }

  const totalCompleted = results.length

  return c.json({
    heatmap: [...heatmapCounts.entries()].map(([date, count]) => ({ date, count })),
    byList: [...byListAgg.entries()].map(([listId, agg]) => ({
      listId,
      count: agg.count,
      avgDays: agg.totalDays / agg.count,
    })),
    overallAvgDays: totalCompleted > 0 ? totalDaysAll / totalCompleted : 0,
    totalCompleted,
  })
})

function dateMinusDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

// ── Recurrence (FEAT-028) ────────────────────────────

interface TaskRecurrenceData {
  interval?: number
  weekdays?: number[] // 0=Sun..6=Sat; 'custom' only
  end?: { type: 'date'; value: string } | { type: 'count'; value: number }
  occurrences?: number
}

function parseRecurrenceData(raw: string | null | undefined): TaskRecurrenceData {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as TaskRecurrenceData
  } catch {
    return {}
  }
}

// Advance an ISO date (YYYY-MM-DD) to the next occurrence. Mirrors
// wallet.ts's advanceDate (pure UTC arithmetic, month-end clamping) but
// generalized to daily/yearly/custom-weekday, since a task's recurrence
// covers a wider set of frequencies than Wallet's monthly/weekly rules.
function advanceTaskDate(dateStr: string, recurrence: string, data: TaskRecurrenceData): string {
  const interval = data.interval && data.interval > 0 ? data.interval : 1
  const [y, m, d] = dateStr.split('-').map(Number)

  if (recurrence === 'daily') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + interval)
    return dt.toISOString().slice(0, 10)
  }
  if (recurrence === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + interval * 7)
    return dt.toISOString().slice(0, 10)
  }
  if (recurrence === 'custom') {
    // Rolls forward day by day to the next date whose weekday is selected.
    // Guarded at 400 iterations (just over a year) so an empty weekday list
    // can never spin forever.
    const dt = new Date(Date.UTC(y, m - 1, d))
    const weekdays = data.weekdays && data.weekdays.length > 0 ? data.weekdays : [dt.getUTCDay()]
    for (let i = 0; i < 400; i++) {
      dt.setUTCDate(dt.getUTCDate() + 1)
      if (weekdays.includes(dt.getUTCDay())) return dt.toISOString().slice(0, 10)
    }
    return dt.toISOString().slice(0, 10)
  }
  if (recurrence === 'yearly') {
    const ny = y + interval
    const lastDayTarget = new Date(Date.UTC(ny, m, 0)).getUTCDate()
    const nd = Math.min(d, lastDayTarget) // Feb 29 → Feb 28 on a non-leap target year
    return `${ny}-${String(m).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
  }
  // monthly
  let ny = y
  let nm = m + interval
  while (nm > 12) {
    nm -= 12
    ny += 1
  }
  const lastDayThis = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lastDayNext = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

interface RecurringTaskRow {
  id: string
  content: string
  note: string | null
  due_date: string | null
  sort_order: number
  list_id: string | null
  priority: string | null
  due_time: string | null
  recurrence: string
  recurrence_data: string | null
  recurrence_parent_id: string | null
  completed_at: string | null
}

// Materializes the next occurrence of every completed recurring task
// (recurrence IS NOT NULL AND is_completed = 1), fire-and-forget on app boot
// (src/App.tsx) — mirrors Wallet's POST /recurring-transactions/process.
// Unlike money, a task series only ever has ONE next occurrence pending: no
// catch-up burst, since skipping a month of a weekly task should not spawn
// several overdue copies. After spawning (or ending the series), the
// completed row's own recurrence/recurrence_data are cleared so it is never
// reprocessed — "only one task per series is ever active" (design.md).
tasks.post('/tasks/recurring/process', async (c) => {
  const userId = c.get('userId')

  const { results: due } = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND is_completed = 1 AND recurrence IS NOT NULL',
  )
    .bind(userId)
    .all<RecurringTaskRow>()

  const writes: D1PreparedStatement[] = []
  let created = 0

  for (const row of due) {
    const data = parseRecurrenceData(row.recurrence_data)
    const occurrences = (data.occurrences ?? 1) + 1
    const baseDate = row.due_date ?? (row.completed_at ?? todayStr()).slice(0, 10)
    const nextDue = advanceTaskDate(baseDate, row.recurrence, data)

    const endedByCount = data.end?.type === 'count' && occurrences > data.end.value
    const endedByDate = data.end?.type === 'date' && nextDue > data.end.value

    if (!endedByCount && !endedByDate) {
      const nextData: TaskRecurrenceData = { ...data, occurrences }
      writes.push(
        c.env.DB.prepare(
          `INSERT INTO tasks
             (id, user_id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date,
              list_id, priority, due_time, recurrence, recurrence_data, recurrence_parent_id,
              created_at, updated_at)
           VALUES
             (lower(hex(randomblob(16))), ?, NULL, ?, ?, 0, 0, ?, ?,
              ?, COALESCE(?, 'none'), ?, ?, ?, ?,
              datetime('now'), datetime('now'))`,
        ).bind(
          userId,
          row.content,
          row.note ?? '',
          row.sort_order,
          nextDue,
          row.list_id,
          row.priority,
          row.due_time,
          row.recurrence,
          JSON.stringify(nextData),
          row.recurrence_parent_id ?? row.id,
        ),
      )
      created++
    }

    writes.push(
      c.env.DB.prepare(
        `UPDATE tasks SET recurrence = NULL, recurrence_data = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).bind(row.id),
    )
  }

  if (writes.length > 0) await c.env.DB.batch(writes)
  return c.json({ created })
})

tasks.delete('/tasks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})

// ── Task lists (R4 / D-15) ───────────────────────────

const TASK_LIST_COLS: Record<string, string> = {
  name: 'name',
  color: 'color',
  icon: 'icon',
  sortOrder: 'sort_order',
  archived: 'archived',
}

/** Every list structural route (rename, delete, share) is owner-only. */
async function ownedList(db: D1Database, id: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM task_lists WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  return !!row
}

tasks.get('/task-lists', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(
    `SELECT tl.*,
       (SELECT COUNT(*) FROM tasks t WHERE t.list_id = tl.id AND t.is_completed = 0) AS open_count
     FROM task_lists tl
     WHERE tl.user_id = ?
        OR tl.id IN (
          SELECT tls.list_id FROM task_list_shares tls
          JOIN group_members gm ON gm.group_id = tls.group_id
          WHERE gm.user_id = ?
        )
     ORDER BY tl.sort_order ASC`,
  )
    .bind(userId, userId)
    .all()
  return c.json(results)
})

tasks.post('/task-lists', async (c) => {
  const userId = c.get('userId')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const name = String(b.name ?? '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  const row = await c.env.DB.prepare(
    `INSERT INTO task_lists (id, user_id, name, color, icon, sort_order, archived, created_at)
     VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
     RETURNING *`,
  )
    // id, userId, name, color, icon, sortOrder, archived, createdAt
    .bind(
      b.id ?? null,
      userId,
      name,
      b.color ?? '#2F6FEB',
      b.icon ?? 'list',
      b.sortOrder ?? 0,
      b.archived ? 1 : 0,
      b.createdAt ?? null,
    )
    .first()
  return c.json(row, 201)
})

tasks.put('/task-lists/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  // task_lists has no updated_at column, unlike tasks/accounts.
  const row = await updateRow(c.env.DB, 'task_lists', id, userId, TASK_LIST_COLS, body, {
    touchUpdatedAt: false,
  })
  if (!row) return c.json({ error: 'list not found' }, 404)
  return c.json(row)
})

tasks.delete('/task-lists/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!(await ownedList(c.env.DB, id, userId))) return c.json({ error: 'list not found' }, 404)

  // Tasks survive; list_id → NULL (docs/archive/design-adoption/tasks-data-model.md §3). The FK
  // is ON DELETE SET NULL, but the update is issued explicitly in the same
  // batch rather than relied on implicitly, matching the accounts route's style.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tasks SET list_id = NULL WHERE list_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM task_lists WHERE id = ?').bind(id),
  ])
  return c.body(null, 204)
})

// ── Task list shares (D-15) — mirrors the accounts share routes exactly ──

tasks.get('/task-lists/:id/shares', async (c) => {
  const id = c.req.param('id')
  if (!(await ownedList(c.env.DB, id, c.get('userId')))) {
    return c.json({ error: 'list not found' }, 404)
  }
  const { results } = await c.env.DB.prepare(
    `SELECT tls.list_id, tls.group_id, tls.can_write, tls.shared_at, g.name AS group_name
     FROM task_list_shares tls
     JOIN groups g ON g.id = tls.group_id
     WHERE tls.list_id = ?`,
  )
    .bind(id)
    .all()
  return c.json(results)
})

tasks.post('/task-lists/:id/shares', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!(await ownedList(c.env.DB, id, userId))) {
    return c.json({ error: 'list not found' }, 404)
  }

  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const groupId = b.groupId
  if (!groupId) return c.json({ error: 'groupId is required' }, 400)

  if (!(await isGroupMember(c.env.DB, userId, String(groupId)))) {
    return c.json({ error: 'you must be a member of the group' }, 403)
  }

  const row = await c.env.DB.prepare(
    `INSERT OR REPLACE INTO task_list_shares (list_id, group_id, can_write, shared_at)
     VALUES (?, ?, ?, datetime('now'))
     RETURNING *`,
  )
    .bind(id, groupId, b.canWrite ? 1 : 0)
    .first()
  return c.json(row, 201)
})

tasks.patch('/task-lists/:id/shares/:groupId', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!(await ownedList(c.env.DB, id, userId))) {
    return c.json({ error: 'list not found' }, 404)
  }
  // Symmetric with POST/DELETE — an owner who has since left the group
  // shouldn't be able to keep adjusting that group's access.
  if (!(await isGroupMember(c.env.DB, userId, c.req.param('groupId')))) {
    return c.json({ error: 'you are not a member of this group' }, 403)
  }
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const row = await c.env.DB.prepare(
    'UPDATE task_list_shares SET can_write = ? WHERE list_id = ? AND group_id = ? RETURNING *',
  )
    .bind(b.canWrite ? 1 : 0, id, c.req.param('groupId'))
    .first()
  if (!row) return c.json({ error: 'share not found' }, 404)
  return c.json(row)
})

tasks.delete('/task-lists/:id/shares/:groupId', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const groupId = c.req.param('groupId')

  if (!(await ownedList(c.env.DB, id, userId))) {
    return c.json({ error: 'list not found' }, 404)
  }
  if (!(await isGroupMember(c.env.DB, userId, groupId))) {
    return c.json({ error: 'you are not a member of this group' }, 403)
  }

  await c.env.DB.prepare('DELETE FROM task_list_shares WHERE list_id = ? AND group_id = ?')
    .bind(id, groupId)
    .run()
  return c.body(null, 204)
})

// ── Task templates ───────────────────────────────────

tasks.get('/task-templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM task_templates WHERE user_id = ? ORDER BY created_at ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

tasks.post('/task-templates', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const row = await c.env.DB.prepare(
    `INSERT INTO task_templates (id, user_id, name, content, created_at)
     VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?,
             COALESCE(?, datetime('now')))
     RETURNING *`,
  )
    // id, userId, name, content, createdAt
    .bind(b.id ?? null, c.get('userId'), b.name ?? '', b.content ?? '', b.createdAt ?? null)
    .first()
  return c.json(row, 201)
})

tasks.delete('/task-templates/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM task_templates WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})
