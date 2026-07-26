import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'

// Port of server/routes/settings.ts. Mounted behind requireAuth, so
// `c.get('userId')` is always present — it replaces `req.session.userId!` and
// removes the non-null assertion the Express version needed.
export const settings = new Hono<AppEnv>()

// GET /api/settings → the current user's key/value rows.
settings.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT key, value FROM settings WHERE user_id = ?',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

// PUT /api/settings/:key → upsert a single setting for the current user.
settings.put('/settings/:key', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const value = String(body?.value ?? '')
  const key = c.req.param('key')

  // The server version binds @value twice (once in VALUES, once in DO UPDATE).
  // Positional binding would mean passing the same value twice and keeping the
  // two positions in sync by hand; `excluded.value` refers to the row that
  // failed to insert, which is equivalent and removes the duplicate bind
  // entirely. Same pattern already used by server/session-store.ts:63.
  await c.env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
  )
    .bind(c.get('userId'), key, value)
    .run()

  return c.json({ key, value })
})
