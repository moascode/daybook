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

  const description = note || `Settlement ${callerId === b.fromUserId ? 'to' : 'from'} member`

  // Payer's expense transaction (their side of the ledger)
  const fromTxnId = (db.transaction(() => {
    const fromTxn = insertTxn.get({
      userId: callerId,
      accountId: fromAccountId,
      date: today,
      merchant: 'Settlement',
      description: `Settlement to ${db.prepare('SELECT username FROM users WHERE id = ?').get(toUserId) ? (db.prepare('SELECT username FROM users WHERE id = ?').get(toUserId) as { username: string }).username : toUserId}${description ? ' — ' + description : ''}`,
      amount,
      type: 'expense',
    }) as { id: string }
    return fromTxn.id
  }))()

  // Recipient's income transaction (their side of the ledger) — only if they provided an account
  let toTxnId: string | null = null
  if (toAccountId) {
    const toAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(toAccountId, toUserId)
    if (toAcct) {
      const callerUsername = (db.prepare('SELECT username FROM users WHERE id = ?').get(callerId) as { username: string } | undefined)?.username ?? callerId
      const toTxn = insertTxn.get({
        userId: toUserId,
        accountId: toAccountId,
        date: today,
        merchant: 'Settlement',
        description: `Settlement from ${callerUsername}${description ? ' — ' + description : ''}`,
        amount,
        type: 'income',
      }) as { id: string }
      toTxnId = toTxn.id
    }
  }

  // Mark oldest outstanding share rows settled (FIFO)
  let remaining = amount
  const pendingShares = db
    .prepare(
      `SELECT ts.id, ts.share_amount
       FROM transaction_shares ts
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL
       ORDER BY ts.created_at ASC`,
    )
    .all(callerId, toUserId) as { id: string; share_amount: number }[]

  const markSettled = db.prepare(`UPDATE transaction_shares SET settled_at = datetime('now') WHERE id = ?`)
  for (const share of pendingShares) {
    if (remaining <= 0) break
    markSettled.run(share.id)
    remaining -= share.share_amount
  }

  // Create settlements record
  const settlement = db
    .prepare(
      `INSERT INTO settlements (id, group_id, from_user, to_user, amount, currency, note, from_transaction_id, to_transaction_id, settled_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'MYR', ?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    .get(groupId, callerId, toUserId, amount, note, fromTxnId, toTxnId)

  res.status(201).json(settlement)
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
    sql += ' AND s.group_id = @groupId'
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
      id: string; from_transaction_id: string | null; to_transaction_id: string | null; settled_at: string
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
  if (settlement.to_transaction_id) {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(settlement.to_transaction_id)
  }

  // Un-settle the share rows that were marked settled by this settlement
  // (We can't perfectly know which rows were settled by this specific settlement,
  //  so we un-settle everything settled on the same day between these two users.)
  db.prepare(
    `UPDATE transaction_shares SET settled_at = NULL
     WHERE user_id = ? AND date(settled_at) = ?
       AND transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)`,
  ).run(
    (db.prepare('SELECT from_user FROM settlements WHERE id = ?').get(req.params.id) as { from_user: string }).from_user,
    settledDay,
    (db.prepare('SELECT to_user FROM settlements WHERE id = ?').get(req.params.id) as { to_user: string }).to_user,
  )

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
