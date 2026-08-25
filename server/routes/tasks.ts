import { Router } from 'express'
import { getDb, type DB } from '../db.ts'
import { updateRow, todayStr } from '../lib.ts'
import { isGroupMember, visibleListIds, writableListIds } from '../lib/sharing.ts'

export const tasksRouter: Router = Router()

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

tasksRouter.get('/tasks', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const view = req.query.view as string | undefined

  // No `view` param: the outliner's original, unfiltered shape. Untouched by
  // R4 — this is the query 01-tasks.spec.ts exercises and must stay identical.
  if (!view) {
    const rows = db
      .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order ASC')
      .all(userId)
    return res.json(rows)
  }

  const listParam = req.query.list as string | undefined
  const priority = req.query.priority as string | undefined
  const assignee = req.query.assignee as string | undefined
  const from = req.query.from as string | undefined
  const to = req.query.to as string | undefined
  const q = req.query.q as string | undefined
  const today = todayStr()

  if (view === 'list') {
    if (!listParam) return res.status(400).json({ error: 'list is required for view=list' })
    const visible = visibleListIds(db, userId)
    if (!visible.includes(listParam)) return res.status(404).json({ error: 'list not found' })
  }

  // Visible tasks: the caller's own, plus tasks in any list shared into a
  // group they belong to (D-15).
  const conditions: string[] = [
    `(t.user_id = @userId OR t.list_id IN (
       SELECT tls.list_id FROM task_list_shares tls
       JOIN group_members gm ON gm.group_id = tls.group_id
       WHERE gm.user_id = @userId
     ))`,
  ]
  const params: Record<string, unknown> = { userId, today }

  switch (view) {
    case 'today':
      conditions.push('t.is_completed = 0', 't.due_date IS NOT NULL', 't.due_date <= @today')
      break
    case 'upcoming':
      conditions.push('t.is_completed = 0', 't.due_date IS NOT NULL', 't.due_date > @today')
      break
    case 'all':
      conditions.push('t.is_completed = 0')
      break
    case 'list':
      conditions.push('t.is_completed = 0', 't.list_id = @list')
      params.list = listParam
      break
    case 'completed':
      conditions.push('t.is_completed = 1')
      break
    case 'assigned':
      conditions.push('t.assignee_id = @userId')
      break
    default:
      return res.status(400).json({ error: `unknown view: ${view}` })
  }

  if (priority) {
    conditions.push('t.priority = @priority')
    params.priority = priority
  }
  if (assignee) {
    conditions.push('t.assignee_id = @assignee')
    params.assignee = assignee
  }
  if (from) {
    conditions.push('t.due_date >= @from')
    params.from = from
  }
  if (to) {
    conditions.push('t.due_date <= @to')
    params.to = to
  }
  if (q) {
    conditions.push('t.content LIKE @q')
    params.q = `%${q}%`
  }

  const sql = `
    SELECT t.*,
      (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS subtask_total,
      (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.is_completed = 1) AS subtask_done,
      CASE
        WHEN t.due_date IS NULL THEN 'none'
        WHEN t.is_completed = 1 THEN 'done'
        WHEN t.due_date < @today THEN 'late'
        WHEN t.due_date = @today THEN 'soon'
        ELSE 'ok'
      END AS due_state
    FROM tasks t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.due_date IS NULL, t.due_date ASC, t.sort_order ASC
  `
  const rows = db.prepare(sql).all(params)
  res.json(rows)
})

// Create (or restore). id/timestamps are optional: provided on restore so the
// original row is recreated verbatim; generated otherwise.
tasksRouter.post('/tasks', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO tasks
         (id, user_id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date,
          list_id, priority, due_time, assignee_id, created_at, updated_at)
       VALUES
         (COALESCE(@id, lower(hex(randomblob(16)))), @userId, @parentId, @content, @note,
          @isCompleted, @isCollapsed, @sortOrder, @dueDate,
          @listId, COALESCE(@priority, 'none'), @dueTime, @assigneeId,
          COALESCE(@createdAt, datetime('now')), COALESCE(@updatedAt, datetime('now')))
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
    )
    .get({
      id: b.id ?? null,
      userId: req.session.userId!,
      parentId: b.parentId ?? null,
      content: b.content ?? '',
      note: b.note ?? '',
      isCompleted: b.isCompleted ? 1 : 0,
      isCollapsed: b.isCollapsed ? 1 : 0,
      sortOrder: b.sortOrder ?? 0,
      dueDate: b.dueDate ?? null,
      listId: b.listId ?? null,
      priority: b.priority ?? null,
      dueTime: b.dueTime ?? null,
      assigneeId: b.assigneeId ?? null,
      createdAt: b.createdAt ?? null,
      updatedAt: b.updatedAt ?? null,
    })
  res.status(201).json(row ?? null)
})

tasksRouter.patch('/tasks/:id', (req, res) => {
  const row = updateRow(getDb(), 'tasks', req.params.id, req.session.userId!, TASK_COLS, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'task not found' })
  res.json(row)
})

// Toggle completion, deriving completed_at along with is_completed — the
// derivation the generic PATCH above deliberately does not do (D-3). Allowed
// for the task's owner, its assignee, or a member with write access on its
// list (D-15).
tasksRouter.post('/tasks/:id/complete', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const id = req.params.id

  const task = db
    .prepare('SELECT id, user_id, assignee_id, list_id, is_completed FROM tasks WHERE id = ?')
    .get(id) as
    | { id: string; user_id: string; assignee_id: string | null; list_id: string | null; is_completed: number }
    | undefined
  if (!task) return res.status(404).json({ error: 'task not found' })

  const writable = writableListIds(db, userId)
  const allowed =
    task.user_id === userId ||
    task.assignee_id === userId ||
    (task.list_id !== null && writable.has(task.list_id))
  if (!allowed) return res.status(404).json({ error: 'task not found' })

  const next = task.is_completed ? 0 : 1
  const row = db
    .prepare(
      `UPDATE tasks
       SET is_completed = @next, completed_at = CASE WHEN @next = 1 THEN datetime('now') ELSE NULL END,
           updated_at = datetime('now')
       WHERE id = @id
       RETURNING *`,
    )
    .get({ next, id })
  res.json(row)
})

// Bulk due-date move for the overdue header's one-click action
// (docs/v2/tasks/01-data-model.md §4). Scoped to the caller's own tasks only —
// not sharing-aware, since a shared task's due date is the owner's call.
tasksRouter.post('/tasks/reschedule', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const b = req.body ?? {}
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string') : []
  const dueDate = b.dueDate
  if (ids.length === 0) return res.status(400).json({ error: 'ids is required' })
  if (typeof dueDate !== 'string' || !dueDate) return res.status(400).json({ error: 'dueDate is required' })

  const placeholders = ids.map((_, i) => `@id${i}`).join(',')
  const params: Record<string, unknown> = { dueDate, userId }
  ids.forEach((id, i) => { params[`id${i}`] = id })
  const rows = db
    .prepare(
      `UPDATE tasks SET due_date = @dueDate, updated_at = datetime('now')
       WHERE user_id = @userId AND id IN (${placeholders})
       RETURNING *`,
    )
    .all(params)
  res.json(rows)
})

tasksRouter.delete('/tasks/:id', (req, res) => {
  getDb().prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
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
function ownedList(db: DB, id: string, userId: string): boolean {
  return !!db.prepare('SELECT id FROM task_lists WHERE id = ? AND user_id = ?').get(id, userId)
}

tasksRouter.get('/task-lists', (req, res) => {
  const userId = req.session.userId!
  const rows = getDb()
    .prepare(
      `SELECT tl.*,
         (SELECT COUNT(*) FROM tasks t WHERE t.list_id = tl.id AND t.is_completed = 0) AS open_count
       FROM task_lists tl
       WHERE tl.user_id = @userId
          OR tl.id IN (
            SELECT tls.list_id FROM task_list_shares tls
            JOIN group_members gm ON gm.group_id = tls.group_id
            WHERE gm.user_id = @userId
          )
       ORDER BY tl.sort_order ASC`,
    )
    .all({ userId })
  res.json(rows)
})

tasksRouter.post('/task-lists', (req, res) => {
  const userId = req.session.userId!
  const b = req.body ?? {}
  const name = String(b.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })

  const row = getDb()
    .prepare(
      `INSERT INTO task_lists (id, user_id, name, color, icon, sort_order, archived, created_at)
       VALUES (COALESCE(@id, lower(hex(randomblob(16)))), @userId, @name, @color, @icon, @sortOrder, @archived,
               COALESCE(@createdAt, datetime('now')))
       RETURNING *`,
    )
    .get({
      id: b.id ?? null,
      userId,
      name,
      color: b.color ?? '#2F6FEB',
      icon: b.icon ?? 'list',
      sortOrder: b.sortOrder ?? 0,
      archived: b.archived ? 1 : 0,
      createdAt: b.createdAt ?? null,
    })
  res.status(201).json(row)
})

tasksRouter.put('/task-lists/:id', (req, res) => {
  // task_lists has no updated_at column, unlike tasks/accounts.
  const row = updateRow(
    getDb(),
    'task_lists',
    req.params.id,
    req.session.userId!,
    TASK_LIST_COLS,
    req.body ?? {},
    { touchUpdatedAt: false },
  )
  if (!row) return res.status(404).json({ error: 'list not found' })
  res.json(row)
})

tasksRouter.delete('/task-lists/:id', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const id = req.params.id
  if (!ownedList(db, id, userId)) return res.status(404).json({ error: 'list not found' })

  // Tasks survive; list_id → NULL (docs/v2/tasks/01-data-model.md §3). The FK
  // is ON DELETE SET NULL, but the update is issued explicitly in the same
  // transaction rather than relied on implicitly, matching the accounts route's style.
  const del = db.transaction(() => {
    db.prepare('UPDATE tasks SET list_id = NULL WHERE list_id = ?').run(id)
    db.prepare('DELETE FROM task_lists WHERE id = ?').run(id)
  })
  del()
  res.status(204).end()
})

// ── Task list shares (D-15) — mirrors the accounts share routes exactly ──

tasksRouter.get('/task-lists/:id/shares', (req, res) => {
  const db = getDb()
  const id = req.params.id
  if (!ownedList(db, id, req.session.userId!)) return res.status(404).json({ error: 'list not found' })
  const rows = db
    .prepare(
      `SELECT tls.list_id, tls.group_id, tls.can_write, tls.shared_at, g.name AS group_name
       FROM task_list_shares tls
       JOIN groups g ON g.id = tls.group_id
       WHERE tls.list_id = ?`,
    )
    .all(id)
  res.json(rows)
})

tasksRouter.post('/task-lists/:id/shares', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const id = req.params.id
  if (!ownedList(db, id, userId)) return res.status(404).json({ error: 'list not found' })

  const b = req.body ?? {}
  const groupId = b.groupId
  if (!groupId) return res.status(400).json({ error: 'groupId is required' })

  if (!isGroupMember(db, userId, String(groupId))) {
    return res.status(403).json({ error: 'you must be a member of the group' })
  }

  const row = db
    .prepare(
      `INSERT OR REPLACE INTO task_list_shares (list_id, group_id, can_write, shared_at)
       VALUES (@id, @groupId, @canWrite, datetime('now'))
       RETURNING *`,
    )
    .get({ id, groupId, canWrite: b.canWrite ? 1 : 0 })
  res.status(201).json(row)
})

tasksRouter.patch('/task-lists/:id/shares/:groupId', (req, res) => {
  const db = getDb()
  const id = req.params.id
  if (!ownedList(db, id, req.session.userId!)) return res.status(404).json({ error: 'list not found' })
  const b = req.body ?? {}
  const row = db
    .prepare(
      'UPDATE task_list_shares SET can_write = @canWrite WHERE list_id = @id AND group_id = @groupId RETURNING *',
    )
    .get({ canWrite: b.canWrite ? 1 : 0, id, groupId: req.params.groupId })
  if (!row) return res.status(404).json({ error: 'share not found' })
  res.json(row)
})

tasksRouter.delete('/task-lists/:id/shares/:groupId', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const id = req.params.id
  const groupId = req.params.groupId

  if (!ownedList(db, id, userId)) return res.status(404).json({ error: 'list not found' })
  if (!isGroupMember(db, userId, groupId)) {
    return res.status(403).json({ error: 'you are not a member of this group' })
  }

  db.prepare('DELETE FROM task_list_shares WHERE list_id = ? AND group_id = ?').run(id, groupId)
  res.status(204).end()
})

// ── Task templates ───────────────────────────────────

tasksRouter.get('/task-templates', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM task_templates WHERE user_id = ? ORDER BY created_at ASC')
    .all(req.session.userId!)
  res.json(rows)
})

tasksRouter.post('/task-templates', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO task_templates (id, user_id, name, content, created_at)
       VALUES (COALESCE(@id, lower(hex(randomblob(16)))), @userId, @name, @content,
               COALESCE(@createdAt, datetime('now')))
       RETURNING *`,
    )
    .get({ id: b.id ?? null, userId: req.session.userId!, name: b.name ?? '', content: b.content ?? '', createdAt: b.createdAt ?? null })
  res.status(201).json(row)
})

tasksRouter.delete('/task-templates/:id', (req, res) => {
  getDb().prepare('DELETE FROM task_templates WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
})
