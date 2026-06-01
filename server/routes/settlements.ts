import { Router } from 'express'
import { getDb } from '../db.ts'
import { isGroupMember } from '../lib/sharing.ts'

export const settlementsRouter: Router = Router()

// POST /api/settlements — record that fromUser paid toUser; creates two ledger transactions
settlementsRouter.post('/settlements', (req, res) => {
  const callerId = req.session.userId!
  const db = getDb()
  const b = req.body ?? {}

  const groupId = String(b.groupId ?? '')
  const toUserId = String(b.toUserId ?? '')
  const amount = Number(b.amount)
  const note = String(b.note ?? '')
  const fromAccountId = String(b.fromAccountId ?? '')
  const toAccountId = String(b.toAccountId ?? '') // recipient's account for the income entry

  if (!groupId || !toUserId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'groupId, toUserId, and a positive amount are required' })
  }
  if (!fromAccountId) {
    return res.status(400).json({ error: 'fromAccountId is required' })
  }

  if (!isGroupMember(db, callerId, groupId) || !isGroupMember(db, toUserId, groupId)) {
    return res.status(403).json({ error: 'both users must be in the group' })
  }

  // S-6: Verify caller actually owes toUserId in this group
  const owedRow = db.prepare(
    `SELECT COALESCE(SUM(ts.share_amount), 0) AS total
     FROM transaction_shares ts
     JOIN transactions t ON t.id = ts.transaction_id
     JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
     WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL`
  ).get(groupId, callerId, toUserId) as { total: number }
  if (!owedRow || owedRow.total <= 0) {
    return res.status(400).json({ error: 'no outstanding balance owed to this user in this group' })
  }
  // U-13: Cap at actual owed amount and warn via response
  const effectiveAmount = Math.min(amount, owedRow.total)

  // Verify account ownership
  const fromAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(fromAccountId, callerId)
  if (!fromAcct) return res.status(400).json({ error: 'fromAccountId must be one of your accounts' })

  const today = new Date().toISOString().slice(0, 10)

  const insertTxn = db.prepare(
    `INSERT INTO transactions
       (id, user_id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
     VALUES
       (lower(hex(randomblob(16))), @userId, @accountId, NULL, @date, @merchant, @description,
        @amount, @type, NULL, '[]', '', datetime('now'), datetime('now'))
     RETURNING id`,
  )

  // C-9: Wrap the entire handler body in a single db.transaction
  let settlement: unknown
  try {
    settlement = db.transaction(() => {
      // B-12: Look up recipient username once, use fallback string (not UUID)
      const toUsername = (db.prepare('SELECT username FROM users WHERE id = ?').get(toUserId) as { username: string } | undefined)?.username ?? '(unknown user)'
      const callerUsername = (db.prepare('SELECT username FROM users WHERE id = ?').get(callerId) as { username: string } | undefined)?.username ?? '(unknown user)'

      const fromTxn = insertTxn.get({
        userId: callerId,
        accountId: fromAccountId,
        date: today,
        merchant: 'Settlement',
        description: `Settlement to ${toUsername}${note ? ' — ' + note : ''}`,
        amount: effectiveAmount,
        type: 'expense',
      }) as { id: string }

      // B-11: If toAccountId provided but invalid, return error instead of silently skipping
      let toTxnId: string | null = null
      if (toAccountId) {
        const toAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(toAccountId, toUserId)
        if (!toAcct) {
          throw Object.assign(new Error('toAccountId not found or not owned by the recipient'), { statusCode: 400 })
        }
        const toTxn = insertTxn.get({
          userId: toUserId,
          accountId: toAccountId,
          date: today,
          merchant: 'Settlement',
          description: `Settlement from ${callerUsername}${note ? ' — ' + note : ''}`,
          amount: effectiveAmount,
          type: 'income',
        }) as { id: string }
        toTxnId = toTxn.id
      }

      // S-4: FIFO only within this group (filter shares to transactions owned by toUserId who is in this group)
      // B-1: Only mark settled if remaining >= share_amount (no over-crediting)
      let remaining = effectiveAmount
      const pendingShares = db.prepare(
        `SELECT ts.id, ts.share_amount
         FROM transaction_shares ts
         JOIN transactions t ON t.id = ts.transaction_id
         JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
         WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL
         ORDER BY ts.created_at ASC`
      ).all(groupId, callerId, toUserId) as { id: string; share_amount: number }[]

      const markSettled = db.prepare(`UPDATE transaction_shares SET settled_at = datetime('now') WHERE id = ?`)
      const settledShareIds: string[] = []
      for (const share of pendingShares) {
        if (remaining <= 0) break
        // B-1: Only settle this share if we have enough remaining
        if (remaining >= share.share_amount) {
          markSettled.run(share.id)
          settledShareIds.push(share.id)
          remaining -= share.share_amount
        }
      }

      // S-2: Create settlement record first, then link settled shares
      const newSettlement = db.prepare(
        `INSERT INTO settlements (id, group_id, from_user, to_user, amount, currency, note, from_transaction_id, to_transaction_id, settled_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'MYR', ?, ?, ?, datetime('now'))
         RETURNING *`
      ).get(groupId, callerId, toUserId, effectiveAmount, note, fromTxn.id, toTxnId) as {
          id: string;
          from_user: string;
          to_user: string;
         }

      // S-2: Record exactly which shares this settlement cleared
      const insertShareLine = db.prepare(
        `INSERT INTO settlement_share_lines (settlement_id, share_id) VALUES (?, ?)`
      )
      for (const shareId of settledShareIds) {
        insertShareLine.run(newSettlement.id, shareId)
      }

      return newSettlement
    })()
  } catch (err: unknown) {
    const code = (err as { statusCode?: number })?.statusCode ?? 500
    return res.status(code).json({ error: (err as Error).message })
  }

  // U-13: Add warning message if amount was capped
  const response: { id: string; message?: string } = {
    id: (settlement as { id: string }).id,
     }
  if (amount > owedRow.total) {
    response.message = `Only ${owedRow.total} was outstanding. Recording ${effectiveAmount}.`
  }
  res.status(201).json(response)
})

// GET /api/settlements — settlement history, filtered by groupId
settlementsRouter.get('/settlements', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const groupId = req.query.groupId ? String(req.query.groupId) : null

  let sql = `
    SELECT s.*, uf.username AS from_username, ut.username AS to_username
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
  const settlement = db
    .prepare('SELECT * FROM settlements WHERE id = ? AND from_user = ?')
    .get(req.params.id, userId) as {
      id: string; from_transaction_id: string | null; to_transaction_id: string | null;
      settled_at: string; from_user: string; to_user: string
    } | undefined

  if (!settlement) return res.status(404).json({ error: 'settlement not found' })

  // Only allow undo within same calendar day
  const settledDay = settlement.settled_at.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  if (settledDay !== today) {
    return res.status(409).json({ error: 'can only undo a settlement on the same day it was created' })
  }

  // Delete the two ledger transactions
  if (settlement.from_transaction_id) {
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(settlement.from_transaction_id, userId)
  }
  // S-5: Delete recipient's transaction with ownership guard
  if (settlement.to_transaction_id) {
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(
      settlement.to_transaction_id,
      settlement.to_user
    )
  }

  // S-2: Un-settle ONLY the exact shares that this settlement cleared (via junction table)
  db.prepare(
    `UPDATE transaction_shares SET settled_at = NULL
     WHERE id IN (SELECT share_id FROM settlement_share_lines WHERE settlement_id = ?)`
  ).run(req.params.id)

  // B-2: No need for redundant SELECT queries — settlement row already has from_user/to_user

  db.prepare('DELETE FROM settlements WHERE id = ?').run(req.params.id)
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
  db.prepare("UPDATE transaction_shares SET settled_at = datetime('now') WHERE id = ?").run(req.params.id)
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
  db.prepare('UPDATE transaction_shares SET settled_at = NULL WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})
