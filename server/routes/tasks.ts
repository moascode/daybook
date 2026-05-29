import { Router } from 'express'
import { getDb } from '../db.ts'
import { updateRow } from '../lib.ts'

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
}

// ── Tasks ────────────────────────────────────────────

tasksRouter.get('/tasks', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order ASC')
    .all(req.session.userId!)
  res.json(rows)
})

// Create (or restore). id/timestamps are optional: provided on restore so the
// original row is recreated verbatim; generated otherwise.
tasksRouter.post('/tasks', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO tasks
         (id, user_id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date, created_at, updated_at)
       VALUES
         (COALESCE(@id, lower(hex(randomblob(16)))), @userId, @parentId, @content, @note,
          @isCompleted, @isCollapsed, @sortOrder, @dueDate,
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

tasksRouter.delete('/tasks/:id', (req, res) => {
  getDb().prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
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
