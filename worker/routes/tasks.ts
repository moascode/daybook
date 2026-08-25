import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { updateRow, todayStr } from '../lib.ts'
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
  // R4 (docs/v2/tasks/01-data-model.md): additive columns for the designed
  // row. A caller may set these directly via PATCH; nothing here auto-derives
  // completedAt from isCompleted — that derivation lives only in
  // POST /tasks/:id/complete below, so the outliner's existing
  // PATCH { isCompleted } path (useTasks.ts) is untouched (D-3).
  listId: 'list_id',
  priority: 'priority',
  dueTime: 'due_time',
  assigneeId: 'assignee_id',
  completedAt: 'completed_at',
}

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

  if (view === 'list') {
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
      conditions.push('t.is_completed = 0', 't.list_id = ?')
      whereParams.push(listParam)
      break
    case 'completed':
      conditions.push('t.is_completed = 1')
      break
    case 'assigned':
      conditions.push('t.assignee_id = ?')
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
        list_id, priority, due_time, assignee_id, created_at, updated_at)
     VALUES
       (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, COALESCE(?, 'none'), ?, ?,
        COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
  )
    // id, userId, parentId, content, note,
    // isCompleted, isCollapsed, sortOrder, dueDate,
    // listId, priority, dueTime, assigneeId, createdAt, updatedAt
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
  const row = await c.env.DB.prepare(
    `UPDATE tasks
     SET is_completed = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
         updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(next, next, id)
    .first()
  return c.json(row)
})

// Bulk due-date move for the overdue header's one-click action
// (docs/v2/tasks/01-data-model.md §4). Scoped to the caller's own tasks only —
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

  // Tasks survive; list_id → NULL (docs/v2/tasks/01-data-model.md §3). The FK
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
