import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'

export const health = new Hono<AppEnv>()

// GET /api/health — liveness + DB connectivity check.
// Ported 1:1 from server/routes/health.ts; the only change is `.get()` → an
// awaited `.first()`, which is the same conversion the other 156 .prepare()
// sites get in Phase 4.
health.get('/health', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    return c.json({ status: 'ok', db: row?.ok === 1, time: new Date().toISOString() })
  } catch (err) {
    return c.json({ status: 'error', message: (err as Error).message }, 500)
  }
})
