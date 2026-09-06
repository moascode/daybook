import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'

// Reading and acting on the capture inbox is the OWNER's job, done in the
// browser — so this is cookie-authenticated and mounted on protectedApi. A
// capture token can write a pending row and can never read one back, which is
// the whole asymmetry that makes a token on a phone safe to lose (spec §4.2).
//
// PR-3 ships the read only. Enrichment, accept and dismiss land in PR-4.
export const captures = new Hono<AppEnv>()

captures.get('/captures', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, source, raw_merchant, raw_card, raw_destination_card, amount,
            type, occurred_at, duplicate_key, status, created_at
       FROM pending_captures
      WHERE user_id = ? AND status = 'pending'
      ORDER BY occurred_at DESC, created_at DESC`,
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})
