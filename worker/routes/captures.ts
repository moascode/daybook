import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { newId, ownedIdSet } from '../lib.ts'
import { writableAccountIds } from '../lib/sharing.ts'
import { insertTransactionStmt } from '../lib/insert-transaction.ts'

// Reading and acting on the capture inbox is the OWNER's job, done in the
// browser — so this is cookie-authenticated and mounted on protectedApi. A
// capture token can write a pending row and can never read one back, which is
// the whole asymmetry that makes a token on a phone safe to lose (spec §4.2).

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

// Status for Settings: how many are waiting, and — the important one — when a
// capture was LAST received, across every status.
//
// Only the app can detect ABSENCE. A phone cannot report an event that never
// happened, so an automation that quietly stops firing (the documented iOS 18
// bug class) is invisible from the device side. This line is the whole
// silence detector (spec §8).
captures.get('/captures/status', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM pending_captures WHERE user_id = ?1 AND status = 'pending') AS pending,
       (SELECT MAX(created_at) FROM pending_captures WHERE user_id = ?1) AS last_capture_at,
       (SELECT COUNT(DISTINCT raw_card) FROM pending_captures WHERE user_id = ?1 AND raw_card <> '') AS cards`,
  )
    .bind(c.get('userId'))
    .first<{ pending: number; last_capture_at: string | null; cards: number }>()
  return c.json({
    pending: Number(row?.pending ?? 0),
    lastCaptureAt: row?.last_capture_at ?? null,
    cards: Number(row?.cards ?? 0),
  })
})

// Distinct card strings seen across every capture, so Settings can offer them
// for mapping without the user having to type an issuer string by hand.
captures.get('/captures/cards', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT raw_card AS card FROM pending_captures
      WHERE user_id = ? AND raw_card <> '' ORDER BY raw_card`,
  )
    .bind(c.get('userId'))
    .all<{ card: string }>()
  return c.json(results.map((r) => r.card))
})

interface AcceptRow {
  id?: unknown
  accountId?: unknown
  destinationAccountId?: unknown
  date?: unknown
  merchant?: unknown
  description?: unknown
  amount?: unknown
  type?: unknown
  categoryId?: unknown
}

// Accept — the ONLY path from the inbox into the ledger, and it runs through
// insertTransactionStmt like every other write, so an accepted capture gets its
// duplicate_key for free.
//
// Permissions are re-checked HERE, not just when the capture arrived: a share
// revoked between capture and review must block the accept (spec §13.1). The
// capture could have been sitting in the inbox for weeks.
captures.post('/captures/accept', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const rows: AcceptRow[] = Array.isArray(body?.rows) ? body.rows : []
  if (rows.length === 0) return c.json({ error: 'nothing to accept' }, 400)

  const ids = rows.map((r) => String(r.id ?? ''))
  if (ids.some((id) => !id)) return c.json({ error: 'every row needs an id' }, 400)

  // Only rows that are actually still pending and actually this user's. This is
  // also what makes accept idempotent: a double-submitted accept finds nothing
  // pending the second time and says so rather than writing the row twice.
  const placeholders = ids.map(() => '?').join(', ')
  const { results: pending } = await c.env.DB.prepare(
    `SELECT id FROM pending_captures
      WHERE user_id = ? AND status = 'pending' AND id IN (${placeholders})`,
  )
    .bind(userId, ...ids)
    .all<{ id: string }>()
  const pendingIds = new Set(pending.map((r) => r.id))
  if (pendingIds.size !== ids.length) {
    return c.json({ error: 'some captures are no longer pending — reload the inbox' }, 409)
  }

  const [writable, ownedCategories] = await Promise.all([
    writableAccountIds(c.env.DB, userId),
    ownedIdSet(c.env.DB, 'categories', userId),
  ])

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const accountId = String(r.accountId ?? '')
    const type = String(r.type ?? '')
    const amount = Number(r.amount)
    const where = `capture ${i + 1}`

    if (!accountId || !writable.has(accountId)) {
      return c.json({ error: `${where}: no write permission on this account` }, 403)
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: `${where}: amount must be a positive number` }, 400)
    }
    if (!['income', 'expense', 'transfer'].includes(type)) {
      return c.json({ error: `${where}: type must be income, expense, or transfer` }, 400)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? ''))) {
      return c.json({ error: `${where}: date must be YYYY-MM-DD` }, 400)
    }
    if (r.categoryId != null && !ownedCategories.has(String(r.categoryId))) {
      return c.json({ error: `${where}: invalid category reference` }, 400)
    }
    // A transfer with no destination cannot be a ledger row at all — it is
    // flagged in the inbox rather than silently downgraded to an expense
    // (spec §13.7, rule 13).
    if (type === 'transfer') {
      const dest = String(r.destinationAccountId ?? '')
      if (!dest || !writable.has(dest)) {
        return c.json({ error: `${where}: a transfer needs a destination account you can write to` }, 400)
      }
      if (dest === accountId) {
        return c.json({ error: `${where}: a transfer needs two different accounts` }, 400)
      }
    }
  }

  // One batch, so a partial accept can never leave a capture both in the ledger
  // and in the queue. The transaction id is generated here rather than by the
  // INSERT default because a batch cannot read a prior statement's RETURNING.
  const statements = rows.flatMap((r) => {
    const txnId = newId()
    return [
      insertTransactionStmt(
        c.env.DB,
        {
          accountId: r.accountId,
          destinationAccountId: String(r.type) === 'transfer' ? r.destinationAccountId : null,
          date: r.date,
          merchant: r.merchant ?? '',
          description: r.description ?? '',
          amount: r.amount,
          type: r.type,
          categoryId: r.categoryId ?? null,
          tag: [],
          importHash: '',
        },
        userId,
        txnId,
      ),
      c.env.DB.prepare(
        `UPDATE pending_captures
            SET status = 'accepted', transaction_id = ?
          WHERE id = ? AND user_id = ? AND status = 'pending'`,
      ).bind(txnId, String(r.id), userId),
    ]
  })

  const results = await c.env.DB.batch(statements)
  const created = results.filter((_, i) => i % 2 === 0).flatMap((r) => r.results ?? [])
  return c.json({ accepted: rows.length, transactions: created }, 201)
})

// Dismiss — the row stays, marked. Never deleted: the UNIQUE
// (user_id, idempotency_key) row IS the idempotency guarantee, so removing it
// would let the same payment be captured again by a retry.
captures.post('/captures/dismiss', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : []
  if (ids.length === 0) return c.json({ error: 'nothing to dismiss' }, 400)

  const placeholders = ids.map(() => '?').join(', ')
  const result = await c.env.DB.prepare(
    `UPDATE pending_captures SET status = 'dismissed'
      WHERE user_id = ? AND status = 'pending' AND id IN (${placeholders})`,
  )
    .bind(userId, ...ids)
    .run()

  return c.json({ dismissed: result.meta.changes })
})
