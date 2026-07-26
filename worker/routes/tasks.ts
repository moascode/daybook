import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { updateRow } from '../lib.ts'

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
}

// ── Tasks ────────────────────────────────────────────

tasks.get('/tasks', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

// Create (or restore). id/timestamps are optional: provided on restore so the
// original row is recreated verbatim; generated otherwise.
tasks.post('/tasks', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const row = await c.env.DB.prepare(
    `INSERT INTO tasks
       (id, user_id, parent_id, content, note, is_completed, is_collapsed, sort_order, due_date, created_at, updated_at)
     VALUES
       (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?,
        ?, ?, ?, ?,
        COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
  )
    // id, userId, parentId, content, note,
    // isCompleted, isCollapsed, sortOrder, dueDate, createdAt, updatedAt
    .bind(
      b.id ?? null,
      c.get('userId'),
      b.parentId ?? null,
      b.content ?? '',
      b.note ?? '',
      b.isCompleted ? 1 : 0,
      b.isCollapsed ? 1 : 0,
      b.sortOrder ?? 0,
      b.dueDate ?? null,
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
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const row = await updateRow(
    c.env.DB,
    'tasks',
    c.req.param('id'),
    c.get('userId'),
    TASK_COLS,
    body,
  )
  if (!row) return c.json({ error: 'task not found' }, 404)
  return c.json(row)
})

tasks.delete('/tasks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
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
