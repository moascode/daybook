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

tasksRouter.get('/tasks', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY sort_order ASC').all()
  res.json(rows)
})

// Create (or restore). id/timestamps are optional: provided on restore so the
// original row is recreated verbatim; generated otherwise.
tasksRouter.post('/tasks', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO tasks
         (id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date, created_at, updated_at)
       VALUES
         (COALESCE(@id, lower(hex(randomblob(16)))), @parentId, @content, @note,
          @isCompleted, @isCollapsed, @sortOrder, @dueDate,
          COALESCE(@createdAt, datetime('now')), COALESCE(@updatedAt, datetime('now')))
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
    )
    .get({
      id: b.id ?? null,
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
  const row = updateRow(getDb(), 'tasks', req.params.id, TASK_COLS, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'task not found' })
  res.json(row)
})

tasksRouter.delete('/tasks/:id', (req, res) => {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Task templates ───────────────────────────────────

tasksRouter.get('/task-templates', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM task_templates ORDER BY created_at ASC').all()
  res.json(rows)
})

tasksRouter.post('/task-templates', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO task_templates (id, name, content, created_at)
       VALUES (COALESCE(@id, lower(hex(randomblob(16)))), @name, @content,
               COALESCE(@createdAt, datetime('now')))
       RETURNING *`,
    )
    .get({ id: b.id ?? null, name: b.name ?? '', content: b.content ?? '', createdAt: b.createdAt ?? null })
  res.status(201).json(row)
})

tasksRouter.delete('/task-templates/:id', (req, res) => {
  getDb().prepare('DELETE FROM task_templates WHERE id = ?').run(req.params.id)
  res.status(204).end()
})
