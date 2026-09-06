import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types.ts'
import {
  bearerFrom,
  hashToken,
  CAPTURE_RATE_LIMIT_MAX,
  CAPTURE_RATE_LIMIT_PREFIX,
  SCOPE_CAPTURE_WRITE,
} from '../lib/capture-token.ts'
import { overRateLimit } from '../lib/rate-limit.ts'

// ─────────────────────────────────────────────────────────────
// The machine surface. Everything here authenticates with a bearer capture
// token and NOTHING here accepts the session cookie — spec §4.3.
//
// Why a third sub-app rather than a few routes on protectedApi: the guarantee
// has to be structural, not positional, for exactly the reason worker/index.ts
// already argues about protectedApi. Two credential types, two surfaces, no
// overlap:
//
//   - A cookie must NOT authenticate anything here. A cookie-authenticated POST
//     that a third-party page can reach is CSRF, and sameSite:'Lax' does not
//     block top-level form POSTs.
//   - A token must NOT authenticate anything on protectedApi. Otherwise the
//     scope list is decorative — a `capture:write` token would inherit every
//     read, every delete, and the AI routes that spend the owner's API key.
//
// Both directions are asserted in e2e (77-capture-tokens.spec.ts); they are the
// point of that spec, not an extra.
// ─────────────────────────────────────────────────────────────
export const capture = new Hono<AppEnv>()

interface TokenRow {
  id: string
  user_id: string
  label: string
  scope: string
}

/**
 * Authenticates the bearer token and charges one rate-limit unit.
 *
 * Deliberately does NOT fall back to `readSession` on a missing or bad token.
 * A 401 here is the correct and only answer.
 */
export const requireCaptureToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerFrom(c.req.header('Authorization'))
  if (!token) return c.json({ error: 'invalid capture token' }, 401)

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, label, scope FROM capture_tokens
      WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await hashToken(token))
    .first<TokenRow>()

  // Same message for "no such token" and "revoked" — distinguishing them tells
  // an attacker which of their guesses once existed.
  if (!row) return c.json({ error: 'invalid capture token' }, 401)

  c.set('userId', row.user_id)
  c.set('captureTokenId', row.id)
  c.set('captureTokenLabel', row.label)
  c.set('captureScopes', row.scope.split(/\s+/).filter(Boolean))

  // Per TOKEN, not per user: one device flooding must not exhaust another's
  // budget, and revoking the noisy one restores the others immediately.
  // Charged in the guard so every capture route is covered by construction —
  // a new route cannot forget it.
  if (
    await overRateLimit(
      c.env.DB,
      row.user_id,
      `${CAPTURE_RATE_LIMIT_PREFIX}${row.id}`,
      CAPTURE_RATE_LIMIT_MAX,
    )
  ) {
    return c.json(
      { error: `capture limit reached (${CAPTURE_RATE_LIMIT_MAX} per hour), try again later` },
      429,
    )
  }

  // Fire-and-forget: the shortcut is waiting on this response, and a bookkeeping
  // write must never be in front of it.
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE capture_tokens SET last_used_at = datetime('now') WHERE id = ?`)
      .bind(row.id)
      .run(),
  )

  await next()
}

/**
 * Default-deny scope check. Every route under this sub-app states the scope it
 * needs; a route that states none is unreachable, which is why this is applied
 * per route rather than once at the top.
 *
 * The scope column exists from day one even though `capture:write` is its only
 * value. Retrofitting scope onto an unscoped credential later means either a
 * breaking change or a permanently over-privileged token.
 */
export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('captureScopes')?.includes(scope)) {
      return c.json({ error: `token is not authorised for ${scope}` }, 403)
    }
    await next()
  }
}

// Mounted at `/api/capture` (worker/index.ts), so `'*'` here means "every
// capture route" and cannot reach anything else. Mounting this sub-app at
// `/api` instead would make this same line guard EVERY api route — it did,
// briefly, and the whole app answered "invalid capture token". The prefix is
// what makes the scoping structural; keep it on the mount, not in the paths.
capture.use('*', requireCaptureToken)

// Proof-of-life for the setup guide: after pasting a token into a shortcut, one
// call confirms it authenticates before any real payment depends on it. Counts
// against the hourly budget like any other request.
capture.get('/health', requireScope(SCOPE_CAPTURE_WRITE), (c) =>
  c.json({ ok: true, device: c.get('captureTokenLabel') ?? '' }),
)
