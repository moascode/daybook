import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { mintToken, hashToken, SCOPE_CAPTURE_WRITE } from '../lib/capture-token.ts'

// Management of capture tokens, by the *logged-in owner* — mounted on
// protectedApi, so these are cookie-authenticated like every other app route.
// The tokens themselves authenticate a different surface entirely
// (worker/routes/capture.ts); the two never overlap. Spec §4.3.
export const captureTokens = new Hono<AppEnv>()

const MAX_LABEL = 60

// The plaintext token is returned EXACTLY here, exactly once. It is not stored,
// so it can never be shown again — the UI says so, and a lost token is replaced
// by revoking and creating another.
captureTokens.post('/capture-tokens', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const label = String(body?.label ?? '').trim().slice(0, MAX_LABEL)
  if (!label) return c.json({ error: 'a device name is required' }, 400)

  const token = mintToken()
  const row = await c.env.DB.prepare(
    `INSERT INTO capture_tokens (user_id, label, token_hash, scope)
     VALUES (?, ?, ?, ?)
     RETURNING id, label, scope, created_at, last_used_at, revoked_at`,
  )
    .bind(c.get('userId'), label, await hashToken(token), SCOPE_CAPTURE_WRITE)
    .first()

  return c.json({ ...row, token }, 201)
})

captureTokens.get('/capture-tokens', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, scope, created_at, last_used_at, revoked_at
       FROM capture_tokens WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

// Revoke, not delete: the row is the audit trail of a credential that existed,
// and `revoked_at` is what the bearer guard checks. A deleted row would make a
// leaked token indistinguishable from one that never existed.
captureTokens.delete('/capture-tokens/:id', async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE capture_tokens SET revoked_at = datetime('now')
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(c.req.param('id'), c.get('userId'))
    .run()

  if (result.meta.changes === 0) return c.json({ error: 'token not found' }, 404)
  return c.json({ ok: true })
})
