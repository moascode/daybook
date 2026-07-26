import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { canWriteAccount, isGroupMember } from '../lib/sharing.ts'
import { businessDateOf, newId, todayStr } from '../lib.ts'

// Port of server/routes/settlements.ts, including the atomicity work the plan
// schedules for Phase 5 — the two cannot be separated, because the Express
// handler's correctness rests entirely on `db.transaction()` and D1 has no
// interactive transactions.
export const settlements = new Hono<AppEnv>()

/** Round to cents the same way the server does, so amounts stay comparable. */
const cents = (n: number) => Math.round(n * 100) / 100

// POST /api/settlements — record that a debtor paid a creditor; books the two
// ledger legs and clears the debtor's outstanding shares (partial-aware).
//
// Direction (B-01): the settlement always stores from_user=debtor,
// to_user=creditor, regardless of who calls. Either party can record it:
//   • Debtor-initiated ("Settle Up"): caller owes → pass toUserId=creditor.
//   • Creditor-initiated ("Mark Received"): caller is owed → pass fromUserId=debtor.
//
// ─── Why this is not a mechanical port ───
//
// The server wraps read-compute-write in one interactive transaction: it reads
// the debtor's outstanding shares, decides in JS how to spread the payment
// across them (FIFO, partial-aware), then writes. D1 cannot hold a transaction
// open across those reads, so the read and the write are separated by a real
// network gap. A concurrent settlement landing in that gap would make the
// payment be applied against balances that no longer exist — double-clearing a
// debt, which is money.
//
// The structure below is therefore: hoist every read, compute the whole write
// set in JS, then issue one atomic batch() whose share updates are
// compare-and-swap guarded on the exact settled_amount that was read. If any
// guard misses, the batch is undone by an explicit compensating batch and the
// caller gets 409 rather than a silently wrong ledger.
settlements.post('/settlements', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const groupId = String(b.groupId ?? '')
  const amount = Number(b.amount)
  const note = String(b.note ?? '')
  const fromAccountId = String(b.fromAccountId ?? '') // debtor-side expense account
  const toAccountId = String(b.toAccountId ?? '') //     creditor-side income account

  // B-01: resolve debtor/creditor from the direction hint, defaulting the caller
  // to the debtor for backward compatibility with the legacy toUserId-only body.
  const rawFrom = String(b.fromUserId ?? '')
  const rawTo = String(b.toUserId ?? '')
  let debtorId: string
  let creditorId: string
  if (rawFrom && rawFrom !== callerId) {
    debtorId = rawFrom
    creditorId = callerId
  } else if (rawTo) {
    debtorId = callerId
    creditorId = rawTo
  } else {
    return c.json({ error: 'toUserId (creditor) or fromUserId (debtor) is required' }, 400)
  }

  if (!groupId || !amount || amount <= 0) {
    return c.json({ error: 'groupId and a positive amount are required' }, 400)
  }
  if (debtorId === creditorId) {
    return c.json({ error: 'debtor and creditor must be different users' }, 400)
  }
  const callerIsDebtor = debtorId === callerId

  const [callerIn, debtorIn, creditorIn] = await Promise.all([
    isGroupMember(db, callerId, groupId),
    isGroupMember(db, debtorId, groupId),
    isGroupMember(db, creditorId, groupId),
  ])
  if (!callerIn || !debtorIn || !creditorIn) {
    return c.json({ error: 'both users must be in the group' }, 403)
  }

  // The caller must supply their own side and be able to write every account
  // that will receive a leg (B-07: no writing to accounts you cannot write).
  const callerSideAccount = callerIsDebtor ? fromAccountId : toAccountId
  if (!callerSideAccount) {
    return c.json(
      { error: callerIsDebtor ? 'fromAccountId is required' : 'toAccountId is required' },
      400,
    )
  }
  const accountIds = [fromAccountId, toAccountId].filter(Boolean)
  for (const acctId of accountIds) {
    if (!(await canWriteAccount(db, callerId, acctId))) {
      return c.json({ error: 'you do not have write access to the selected account' }, 400)
    }
  }

  // ── Hoisted reads ────────────────────────────────────
  // Everything the write set depends on is read here, before any write. Nothing
  // below this point queries for a value it then writes back.

  const owedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(ts.share_amount - ts.settled_amount), 0) AS total
       FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
       WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL`,
    )
    .bind(groupId, debtorId, creditorId)
    .first<{ total: number }>()

  if (!owedRow || owedRow.total <= 0.005) {
    return c.json({ error: 'no outstanding balance owed in this group' }, 400)
  }

  // U-13: cap at the actual outstanding amount and warn via the response.
  const owed = cents(owedRow.total)
  const effective = cents(Math.min(amount, owed))

  const { results: users } = await db
    .prepare('SELECT id, username FROM users WHERE id IN (?, ?)')
    .bind(debtorId, creditorId)
    .all<{ id: string; username: string }>()
  const nameOf = (id: string) => users.find((u) => u.id === id)?.username ?? '(unknown user)'
  const debtorUsername = nameOf(debtorId)
  const creditorUsername = nameOf(creditorId)

  // Each leg is booked on its own account and owned by that account's owner —
  // the debtor's expense belongs to the debtor, the creditor's income to the
  // creditor, even though one caller records both.
  const owners = new Map<string, string>()
  if (accountIds.length) {
    const { results } = await db
      .prepare(
        `SELECT id, user_id FROM accounts WHERE id IN (${accountIds.map(() => '?').join(', ')})`,
      )
      .bind(...accountIds)
      .all<{ id: string; user_id: string }>()
    for (const r of results) owners.set(r.id, r.user_id)
  }
  if (accountIds.some((id) => !owners.has(id))) {
    return c.json({ error: 'account not found' }, 400)
  }

  // B-02: FIFO across the debtor's outstanding shares owed to the creditor,
  // applying a partial amount to each (not whole-share-or-nothing).
  const { results: pending } = await db
    .prepare(
      `SELECT ts.id, ts.share_amount, ts.settled_amount
       FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
       WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL
       ORDER BY ts.created_at ASC`,
    )
    .bind(groupId, debtorId, creditorId)
    .all<{ id: string; share_amount: number; settled_amount: number }>()

  // ── Compute the entire write set in JS ───────────────

  let remaining = effective
  const applied: {
    id: string
    previousSettled: number
    newSettled: number
    appliedAmount: number
  }[] = []

  for (const share of pending) {
    if (remaining <= 0.005) break
    const outstanding = cents(share.share_amount - share.settled_amount)
    if (outstanding <= 0) continue
    const amt = Math.min(remaining, outstanding)
    applied.push({
      id: share.id,
      previousSettled: share.settled_amount,
      newSettled: cents(share.settled_amount + amt),
      appliedAmount: cents(amt),
    })
    remaining -= amt
  }

  const today = todayStr()
  const settlementId = newId()
  const fromTxnId = fromAccountId ? newId() : null
  const toTxnId = toAccountId ? newId() : null

  const insertTxn = (
    id: string,
    userId: string,
    accountId: string,
    description: string,
    type: 'expense' | 'income',
  ) =>
    db
      .prepare(
        `INSERT INTO transactions
           (id, user_id, account_id, destination_account_id, date, merchant, description,
            amount, type, category_id, tag, import_hash, created_at, updated_at)
         VALUES
           (?, ?, ?, NULL, ?, 'Settlement', ?, ?, ?, NULL, '[]', '', datetime('now'), datetime('now'))`,
      )
      // id, userId, accountId, date, description, amount, type
      .bind(id, userId, accountId, today, description, effective, type)

  // Compare-and-swap. The row is only updated if it is still exactly as it was
  // read — same settled_amount, still unsettled. A concurrent settlement that
  // touched this share first changes settled_amount, the WHERE misses, and
  // meta.changes comes back 0 instead of silently overwriting their work.
  const casUpdate = (a: (typeof applied)[number]) =>
    db
      .prepare(
        `UPDATE transaction_splits
            SET settled_amount = ?,
                settled_at = CASE WHEN ? >= share_amount THEN datetime('now') ELSE NULL END
          WHERE id = ? AND settled_at IS NULL AND settled_amount = ?`,
      )
      .bind(a.newSettled, a.newSettled, a.id, a.previousSettled)

  const writes = [
    // Share updates first so their meta.changes are at known indices.
    ...applied.map(casUpdate),
    ...(fromTxnId
      ? [
          insertTxn(
            fromTxnId,
            owners.get(fromAccountId)!,
            fromAccountId,
            `Settlement to ${creditorUsername}${note ? ' — ' + note : ''}`,
            'expense',
          ),
        ]
      : []),
    ...(toTxnId
      ? [
          insertTxn(
            toTxnId,
            owners.get(toAccountId)!,
            toAccountId,
            `Settlement from ${debtorUsername}${note ? ' — ' + note : ''}`,
            'income',
          ),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO settlements
           (id, group_id, from_user, to_user, amount, currency, note,
            from_transaction_id, to_transaction_id, settled_at)
         VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, ?, datetime('now'))`,
      )
      .bind(settlementId, groupId, debtorId, creditorId, effective, note, fromTxnId, toTxnId),
    // Record how much this settlement applied to each share (partial-aware undo).
    ...applied.map((a) =>
      db
        .prepare(
          'INSERT INTO settlement_split_lines (settlement_id, share_id, amount) VALUES (?, ?, ?)',
        )
        .bind(settlementId, a.id, a.appliedAmount),
    ),
  ]

  const results = await db.batch(writes)

  // ── Verify the optimistic guards held ────────────────
  //
  // batch() is atomic, so everything above committed together — but a CAS that
  // matched no rows is a successful statement affecting 0 rows, not an error.
  // If any missed, the settlement was recorded against a balance that had
  // already moved, so it must be undone explicitly.
  const lost = applied.filter((_, i) => (results[i]?.meta?.changes ?? 0) !== 1)

  if (lost.length > 0) {
    const survivors = applied.filter((a) => !lost.includes(a))
    await db.batch([
      // settlement_split_lines cascades from settlements.
      db.prepare('DELETE FROM settlements WHERE id = ?').bind(settlementId),
      ...(fromTxnId ? [db.prepare('DELETE FROM transactions WHERE id = ?').bind(fromTxnId)] : []),
      ...(toTxnId ? [db.prepare('DELETE FROM transactions WHERE id = ?').bind(toTxnId)] : []),
      // Restore only the shares this request actually changed, and only if they
      // still hold the value it wrote — never clobber a third party's update.
      // settled_at returns to NULL because the CAS required it to be NULL.
      ...survivors.map((a) =>
        db
          .prepare(
            `UPDATE transaction_splits SET settled_amount = ?, settled_at = NULL
              WHERE id = ? AND settled_amount = ?`,
          )
          .bind(a.previousSettled, a.id, a.newSettled),
      ),
    ])

    console.warn(
      `settlement ${settlementId} rolled back: ${lost.length}/${applied.length} share guards lost a race`,
    )
    return c.json(
      { error: 'the outstanding balance changed while recording this settlement; please retry' },
      409,
    )
  }

  // U-13/B-18: surface when the amount was capped below what was requested.
  const response: { id: string; message?: string } = { id: settlementId }
  if (amount > owed) {
    response.message = `Only ${owed.toFixed(2)} was outstanding. Recorded ${effective.toFixed(2)}.`
  }
  return c.json(response, 201)
})

// GET /api/settlements — settlement history, filtered by groupId.
settlements.get('/settlements', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.query('groupId') ? String(c.req.query('groupId')) : null

  // The server used named parameters (@userId twice, @groupId). D1 is
  // positional, so the bind list is built alongside the SQL to keep the two in
  // step — @userId appearing three times becomes three separate binds.
  let sql = `
    SELECT s.*, uf.username AS from_username, ut.username AS to_username,
           s.original_transaction_id AS original_transaction_id
    FROM settlements s
    JOIN users uf ON uf.id = s.from_user
    JOIN users ut ON ut.id = s.to_user
    WHERE (s.from_user = ? OR s.to_user = ?)`
  const binds: unknown[] = [userId, userId]

  if (groupId) {
    // S-8: also verify the caller is a member of the requested group.
    sql += ` AND s.group_id = ?
             AND s.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)`
    binds.push(groupId, userId)
  }
  sql += ' ORDER BY s.settled_at DESC'

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json(results)
})

// DELETE /api/settlements/:id — undo settlement (same-day only).
settlements.delete('/settlements/:id', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')

  // B-01: either party (debtor or creditor) may undo their settlement.
  const settlement = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND (from_user = ? OR to_user = ?)')
    .bind(id, userId, userId)
    .first<{
      id: string
      from_transaction_id: string | null
      to_transaction_id: string | null
      settled_at: string
      from_user: string
      to_user: string
    }>()

  if (!settlement) return c.json({ error: 'settlement not found' }, 404)

  // Only allow undo within the same calendar day, in the business timezone.
  //
  // The server compared `settled_at.slice(0, 10)` against a local-time
  // todayStr(). settled_at is written by datetime('now'), which SQLite emits in
  // UTC, so on the Mac that compared a UTC date against an MYT date — they
  // disagree for the first 8 hours of every MYT day, silently refusing a valid
  // same-day undo. Converting explicitly makes both sides the same zone.
  if (businessDateOf(settlement.settled_at) !== todayStr()) {
    return c.json({ error: 'can only undo a settlement on the same day it was created' }, 409)
  }

  // B-02: subtract exactly what this settlement applied to each share, and
  // re-open (settled_at = NULL) any share that is no longer fully cleared.
  const { results: lines } = await db
    .prepare('SELECT share_id, amount FROM settlement_split_lines WHERE settlement_id = ?')
    .bind(id)
    .all<{ share_id: string; amount: number }>()

  // All reads are done; the writes below are a straight batch() conversion of
  // the server's db.transaction() — no read-then-write, so no CAS needed.
  await db.batch([
    ...(settlement.from_transaction_id
      ? [
          db
            .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
            .bind(settlement.from_transaction_id, settlement.from_user),
        ]
      : []),
    ...(settlement.to_transaction_id
      ? [
          db
            .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
            .bind(settlement.to_transaction_id, settlement.to_user),
        ]
      : []),
    ...lines.map((line) =>
      db
        .prepare(
          `UPDATE transaction_splits
              SET settled_amount = MAX(0, ROUND(settled_amount - ?, 2)),
                  settled_at = CASE WHEN ROUND(settled_amount - ?, 2) >= share_amount
                                    THEN settled_at ELSE NULL END
            WHERE id = ?`,
        )
        .bind(line.amount, line.amount, line.share_id),
    ),
    db.prepare('DELETE FROM settlements WHERE id = ?').bind(id),
  ])

  return c.body(null, 204)
})

// POST /api/transaction-shares/:id/settle — manually mark a single share settled.
settlements.post('/transaction-shares/:id/settle', async (c) => {
  const id = c.req.param('id')
  const share = await c.env.DB.prepare(
    'SELECT id FROM transaction_splits WHERE id = ? AND user_id = ?',
  )
    .bind(id, c.get('userId'))
    .first()
  if (!share) return c.json({ error: 'share not found' }, 404)

  await c.env.DB.prepare(
    "UPDATE transaction_splits SET settled_amount = share_amount, settled_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run()
  return c.json({ ok: true })
})

// POST /api/transaction-shares/:id/unsettle
settlements.post('/transaction-shares/:id/unsettle', async (c) => {
  const id = c.req.param('id')
  const share = await c.env.DB.prepare(
    'SELECT id FROM transaction_splits WHERE id = ? AND user_id = ?',
  )
    .bind(id, c.get('userId'))
    .first()
  if (!share) return c.json({ error: 'share not found' }, 404)

  await c.env.DB.prepare(
    'UPDATE transaction_splits SET settled_amount = 0, settled_at = NULL WHERE id = ?',
  )
    .bind(id)
    .run()
  return c.json({ ok: true })
})
