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
import { todayStr } from '../lib.ts'
import { buildDuplicateKey } from '../lib/merchant.ts'

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

// ─────────────────────────────────────────────────────────────
// POST /api/capture/transaction — the one write a machine can make.
//
// It does NOT write to `transactions`. It writes a pending row a human accepts
// later (spec §4.1/D-A), which is what makes an unreliable signal safe: Apple's
// trigger fires on DECLINED payments and is documented to deliver an empty
// merchant or a 0.0 amount, and an agent client acts on text other people
// wrote. A ledger row moves balances, budgets, safe-to-spend and reports, and
// on a shared account can be split and settled against before anyone notices.
//
// Enrichment (merchant cleanup, category, account mapping) deliberately does
// NOT happen here — it runs when the review surface loads the row (§5.2). The
// shortcut is waiting on this response, so this stays one INSERT; enrichment
// needs several reads and would buy nothing on that hot path.
//
// No AI runs here, ever. ai-usage.md guardrail 2 forbids a Claude call on
// anything but an explicit human action, and an unattended POST is the
// definition of a non-human trigger.
// ─────────────────────────────────────────────────────────────

const CAPTURE_TYPES = new Set(['expense', 'income', 'transfer'])
const MAX_TEXT = 200

interface CaptureBody {
  merchant?: unknown
  amount?: unknown
  card?: unknown
  destinationCard?: unknown
  occurredAt?: unknown
  type?: unknown
  source?: unknown
}

/** Money, formatted the way the shortcut will read it aloud in a notification. */
function money(amount: number): string {
  return `RM${amount.toFixed(2)}`
}

capture.post('/transaction', requireScope(SCOPE_CAPTURE_WRITE), async (c) => {
  const userId = c.get('userId')

  // The header, not a body field — it is a standard, and this endpoint serves
  // many clients. Shortcuts has no UUID action, so the setup guide builds one
  // from actions that do exist (Format Date + amount in cents + Random Number).
  const idempotencyKey = (c.req.header('Idempotency-Key') ?? '').trim().slice(0, MAX_TEXT)
  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header is required' }, 400)

  const b = (await c.req.json().catch(() => ({}))) as CaptureBody

  // Reject at the door rather than at review: a non-positive amount is how a
  // DECLINED payment and the documented `0.0` bug both arrive, and neither is
  // a transaction. Everything else is accepted and flagged instead, because
  // dropping a row would lose a real payment.
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'amount must be greater than zero' }, 400)
  }

  const type = b.type == null ? 'expense' : String(b.type)
  if (!CAPTURE_TYPES.has(type)) {
    return c.json({ error: 'type must be expense, income or transfer' }, 400)
  }

  // Empty is allowed and flagged at review — Apple delivers a blank merchant
  // often enough that refusing it would silently drop real payments.
  const merchant = String(b.merchant ?? '').trim().slice(0, MAX_TEXT)
  const card = String(b.card ?? '').trim().slice(0, MAX_TEXT)
  const destinationCard = String(b.destinationCard ?? '').trim().slice(0, MAX_TEXT)
  const source = String(b.source ?? 'api').trim().slice(0, 40) || 'api'

  // Absent → stamped in Asia/Kuala_Lumpur, never UTC. CLAUDE.md §16 trap 1: for
  // the eight hours a day the two disagree, a UTC stamp lands the row outside
  // the month the client is showing.
  let occurredAt = todayStr()
  if (b.occurredAt != null && String(b.occurredAt).trim() !== '') {
    const raw = String(b.occurredAt).trim()
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'occurredAt is not a valid date' }, 400)
    }
    occurredAt = raw.slice(0, 10)
  }

  // Computed here, not at accept, so a CSV import running before the row is
  // ever reviewed can still match it (§5.3 gap 1).
  const duplicateKey = buildDuplicateKey(occurredAt, amount, type, merchant)

  const inserted = await c.env.DB.prepare(
    `INSERT INTO pending_captures
       (user_id, token_id, source, idempotency_key, raw_merchant, raw_card,
        raw_destination_card, amount, type, occurred_at, duplicate_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
  )
    .bind(
      userId,
      c.get('captureTokenId') ?? null,
      source,
      idempotencyKey,
      merchant,
      card,
      destinationCard,
      amount,
      type,
      occurredAt,
      duplicateKey,
    )
    .first<{ id: string }>()

  // No row back means the UNIQUE constraint absorbed a replay. That is the
  // idempotency guarantee, enforced by the database rather than by a
  // check-then-insert race: "Get Contents of URL" timing out after the server
  // already committed is indistinguishable, on the phone, from never arriving.
  if (!inserted) {
    return c.json({ status: 'duplicate', message: 'already captured' }, 200)
  }

  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pending_captures WHERE user_id = ? AND status = 'pending'`,
  )
    .bind(userId)
    .first<{ n: number }>()
  const waiting = Number(pending?.n ?? 1)

  // Short and human-readable on purpose: the shortcut pipes this straight into
  // a notification, which is how the user learns the capture worked at all.
  const name = merchant || 'Unnamed'
  return c.json(
    {
      status: 'pending',
      id: inserted.id,
      message: `${name} ${money(amount)} — ${waiting} to review`,
    },
    201,
  )
})
