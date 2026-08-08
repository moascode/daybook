import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'

// Port of server/routes/settings.ts. Mounted behind requireAuth, so
// `c.get('userId')` is always present — it replaces `req.session.userId!` and
// removes the non-null assertion the Express version needed.
export const settings = new Hono<AppEnv>()

// Prefixes for settings rows that are Worker-internal bookkeeping, not a user
// preference — never surfaced to the client and never writable through the
// generic PUT below (docs/ai-bulk-categorize-feature.md §2, §4).
const INTERNAL_KEY_PREFIXES = ['ai_rate_limit_', '_test_']

function isInternalKey(key: string): boolean {
  return INTERNAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

// GET /api/settings → the current user's key/value rows.
settings.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT key, value FROM settings WHERE user_id = ?',
  )
    .bind(c.get('userId'))
    .all<{ key: string; value: string }>()

  // anthropic_api_key must never round-trip to the browser — otherwise it
  // rides along on every page load. Masked to a presence flag instead; the
  // Settings UI only ever needs to know whether one is saved.
  const rows = results
    .filter((row) => !isInternalKey(row.key))
    .map((row) => (row.key === 'anthropic_api_key' ? { key: row.key, value: row.value ? 'set' : '' } : row))
  return c.json(rows)
})

// PUT /api/settings/:key → upsert a single setting for the current user.
settings.put('/settings/:key', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const value = String(body?.value ?? '')
  const key = c.req.param('key')
  if (isInternalKey(key)) return c.json({ error: 'not a writable setting' }, 400)

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
