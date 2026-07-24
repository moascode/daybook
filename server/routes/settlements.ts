import { Router } from 'express'
import { getDb } from '../db.ts'
import { isGroupMember, canWriteAccount } from '../lib/sharing.ts'
import { todayStr } from '../lib.ts'

export const settlementsRouter: Router = Router()

// POST /api/settlements — record that a debtor paid a creditor; books the two
// ledger legs and clears the debtor's outstanding shares (partial-aware).
//
// Direction (B-01): the settlement always stores from_user=debtor, to_user=creditor,
// regardless of who calls. Either party can record it:
//   • Debtor-initiated ("Settle Up"): caller owes → pass toUserId=creditor.
//   • Creditor-initiated ("Mark Received"): caller is owed → pass fromUserId=debtor.
// The debtor-side leg is an expense on fromAccountId; the creditor-side leg is an
// income on toAccountId. Each leg is booked on its own account and only when that
// account is given and writable by the caller.
settlementsRouter.post('/settlements', (req, res) => {
  const callerId = req.session.userId!
  const db = getDb()
  const b = req.body ?? {}

  const groupId = String(b.groupId ?? '')
  const amount = Number(b.amount)
  const note = String(b.note ?? '')
  const fromAccountId = String(b.fromAccountId ?? '') // debtor-side expense account
  const toAccountId = String(b.toAccountId ?? '')     // creditor-side income account

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
    return res.status(400).json({ error: 'toUserId (creditor) or fromUserId (debtor) is required' })
  }

  if (!groupId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'groupId and a positive amount are required' })
  }
  if (debtorId === creditorId) {
    return res.status(400).json({ error: 'debtor and creditor must be different users' })
  }
  const callerIsDebtor = debtorId === callerId

  if (
    !isGroupMember(db, callerId, groupId) ||
    !isGroupMember(db, debtorId, groupId) ||
    !isGroupMember(db, creditorId, groupId)
  ) {
    return res.status(403).json({ error: 'both users must be in the group' })
  }

  // Verify the debtor actually owes the creditor in this group (partial-aware).
  const owedRow = db.prepare(
    `SELECT COALESCE(SUM(ts.share_amount - ts.settled_amount), 0) AS total
     FROM transaction_shares ts
     JOIN transactions t ON t.id = ts.transaction_id
     JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
     WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL`
  ).get(groupId, debtorId, creditorId) as { total: number }
  if (!owedRow || owedRow.total <= 0.005) {
    return res.status(400).json({ error: 'no outstanding balance owed in this group' })
  }
  // U-13: cap at the actual outstanding amount and warn via the response.
  const owed = Math.round(owedRow.total * 100) / 100
  const effectiveAmount = Math.round(Math.min(amount, owed) * 100) / 100

  // The caller must supply their own side and be able to write every account that
  // will receive a leg (B-07 spirit: no writing to accounts you can't write).
  const callerSideAccount = callerIsDebtor ? fromAccountId : toAccountId
  if (!callerSideAccount) {
    return res.status(400).json({
      error: callerIsDebtor ? 'fromAccountId is required' : 'toAccountId is required',
    })
  }
  for (const acctId of [fromAccountId, toAccountId]) {
    if (acctId && !canWriteAccount(db, callerId, acctId)) {
      return res.status(400).json({ error: 'you do not have write access to the selected account' })
    }
  }

  const today = todayStr()

  const insertTxn = db.prepare(
    `INSERT INTO transactions
       (id, user_id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
     VALUES
       (lower(hex(randomblob(16))), @userId, @accountId, NULL, @date, @merchant, @description,
        @amount, @type, NULL, '[]', '', datetime('now'), datetime('now'))
     RETURNING id`,
  )

  // Wrap the entire handler body in a single db.transaction.
  let settlement: unknown
  try {
    settlement = db.transaction(() => {
      const debtorUsername = (db.prepare('SELECT username FROM users WHERE id = ?').get(debtorId) as { username: string } | undefined)?.username ?? '(unknown user)'
      const creditorUsername = (db.prepare('SELECT username FROM users WHERE id = ?').get(creditorId) as { username: string } | undefined)?.username ?? '(unknown user)'

      // Book each leg on its own account, owned by that account's owner. The
      // debtor side is an expense; the creditor side is an income.
      let fromTxnId: string | null = null
      if (fromAccountId) {
        const owner = (db.prepare('SELECT user_id FROM accounts WHERE id = ?').get(fromAccountId) as { user_id: string }).user_id
        fromTxnId = (insertTxn.get({
          userId: owner,
          accountId: fromAccountId,
          date: today,
          merchant: 'Settlement',
          description: `Settlement to ${creditorUsername}${note ? ' — ' + note : ''}`,
          amount: effectiveAmount,
          type: 'expense',
        }) as { id: string }).id
      }
      let toTxnId: string | null = null
      if (toAccountId) {
        const owner = (db.prepare('SELECT user_id FROM accounts WHERE id = ?').get(toAccountId) as { user_id: string }).user_id
        toTxnId = (insertTxn.get({
          userId: owner,
          accountId: toAccountId,
          date: today,
          merchant: 'Settlement',
          description: `Settlement from ${debtorUsername}${note ? ' — ' + note : ''}`,
          amount: effectiveAmount,
          type: 'income',
        }) as { id: string }).id
      }

      // B-02: FIFO across the debtor's outstanding shares owed to the creditor,
      // applying a partial amount to each share (not whole-share-or-nothing).
      let remaining = effectiveAmount
      const pendingShares = db.prepare(
        `SELECT ts.id, ts.share_amount, ts.settled_amount
         FROM transaction_shares ts
         JOIN transactions t ON t.id = ts.transaction_id
         JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
         WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL
         ORDER BY ts.created_at ASC`
      ).all(groupId, debtorId, creditorId) as { id: string; share_amount: number; settled_amount: number }[]

      // settled_at is set only once a share is fully cleared (kept for history/back-compat).
      const applyToShare = db.prepare(
        `UPDATE transaction_shares
         SET settled_amount = @settled,
             settled_at = CASE WHEN @settled >= share_amount THEN datetime('now') ELSE NULL END
         WHERE id = @id`
      )
      const shareLines: { id: string; amount: number }[] = []
      for (const share of pendingShares) {
        if (remaining <= 0.005) break
        const outstanding = Math.round((share.share_amount - share.settled_amount) * 100) / 100
        if (outstanding <= 0) continue
        const applied = Math.min(remaining, outstanding)
        const newSettled = Math.round((share.settled_amount + applied) * 100) / 100
        applyToShare.run({ settled: newSettled, id: share.id })
        shareLines.push({ id: share.id, amount: Math.round(applied * 100) / 100 })
        remaining -= applied
      }

      const newSettlement = db.prepare(
        `INSERT INTO settlements (id, group_id, from_user, to_user, amount, currency, note, from_transaction_id, to_transaction_id, settled_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'MYR', ?, ?, ?, datetime('now'))
         RETURNING *`
      ).get(groupId, debtorId, creditorId, effectiveAmount, note, fromTxnId, toTxnId) as {
          id: string;
          from_user: string;
          to_user: string;
         }

      // Record how much this settlement applied to each share (partial-aware undo).
      const insertShareLine = db.prepare(
        `INSERT INTO settlement_share_lines (settlement_id, share_id, amount) VALUES (?, ?, ?)`
      )
      for (const line of shareLines) {
        insertShareLine.run(newSettlement.id, line.id, line.amount)
      }

      return newSettlement
    })()
  } catch (err: unknown) {
    const code = (err as { statusCode?: number })?.statusCode ?? 500
    return res.status(code).json({ error: (err as Error).message })
  }

  // U-13/B-18: surface when the amount was capped below what was requested.
  const response: { id: string; message?: string } = {
    id: (settlement as { id: string }).id,
  }
  if (amount > owed) {
    response.message = `Only ${owed.toFixed(2)} was outstanding. Recorded ${effectiveAmount.toFixed(2)}.`
  }
  res.status(201).json(response)
})

// GET /api/settlements — settlement history, filtered by groupId
settlementsRouter.get('/settlements', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const groupId = req.query.groupId ? String(req.query.groupId) : null

  let sql = `
    SELECT s.*, uf.username AS from_username, ut.username AS to_username, s.original_transaction_id AS original_transaction_id
    FROM settlements s
    JOIN users uf ON uf.id = s.from_user
    JOIN users ut ON ut.id = s.to_user
    WHERE (s.from_user = @userId OR s.to_user = @userId)
  `
  const params: Record<string, unknown> = { userId }
  if (groupId) {
    // S-8: Also verify caller is a member of the requested group
    sql += ' AND s.group_id = @groupId AND s.group_id IN (SELECT group_id FROM group_members WHERE user_id = @userId)'
    params.groupId = groupId
  }
  sql += ' ORDER BY s.settled_at DESC'

  res.json(db.prepare(sql).all(params))
})

// DELETE /api/settlements/:id — undo settlement (same-day only)
settlementsRouter.delete('/settlements/:id', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  // B-01: either party (debtor or creditor) may undo their settlement.
  const settlement = db
    .prepare('SELECT * FROM settlements WHERE id = ? AND (from_user = ? OR to_user = ?)')
    .get(req.params.id, userId, userId) as {
      id: string; from_transaction_id: string | null; to_transaction_id: string | null;
      settled_at: string; from_user: string; to_user: string
    } | undefined

  if (!settlement) return res.status(404).json({ error: 'settlement not found' })

  // Only allow undo within same calendar day (local, not UTC).
  const settledDay = settlement.settled_at.slice(0, 10)
  if (settledDay !== todayStr()) {
    return res.status(409).json({ error: 'can only undo a settlement on the same day it was created' })
  }

  db.transaction(() => {
    if (settlement.from_transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(settlement.from_transaction_id, settlement.from_user)
    }
    if (settlement.to_transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(
        settlement.to_transaction_id,
        settlement.to_user
      )
    }
    // B-02: subtract exactly what this settlement applied to each share, and
    // re-open (settled_at = NULL) any share that is no longer fully cleared.
    const lines = db
      .prepare('SELECT share_id, amount FROM settlement_share_lines WHERE settlement_id = ?')
      .all(req.params.id) as { share_id: string; amount: number }[]
    const reverse = db.prepare(
      `UPDATE transaction_shares
       SET settled_amount = MAX(0, ROUND(settled_amount - @amount, 2)),
           settled_at = CASE WHEN ROUND(settled_amount - @amount, 2) >= share_amount THEN settled_at ELSE NULL END
       WHERE id = @id`
    )
    for (const line of lines) {
      reverse.run({ amount: line.amount, id: line.share_id })
    }
    db.prepare('DELETE FROM settlements WHERE id = ?').run(req.params.id)
  })()

  res.status(204).end()
})

// POST /api/transaction-shares/:id/settle — manually mark a single share as settled
settlementsRouter.post('/transaction-shares/:id/settle', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const share = db
    .prepare('SELECT id FROM transaction_shares WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId)
  if (!share) return res.status(404).json({ error: 'share not found' })
  db.prepare("UPDATE transaction_shares SET settled_amount = share_amount, settled_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

// POST /api/transaction-shares/:id/unsettle
settlementsRouter.post('/transaction-shares/:id/unsettle', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const share = db
    .prepare('SELECT id FROM transaction_shares WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId)
  if (!share) return res.status(404).json({ error: 'share not found' })
  db.prepare('UPDATE transaction_shares SET settled_amount = 0, settled_at = NULL WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})
