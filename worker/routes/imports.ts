import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { writableAccountIds } from '../lib/sharing.ts'

// Import history (migration 0034_import_batches.sql). POST /transactions/import
// writes the batch row; this module lists batches, moves one to another
// account, and undoes one. Batches are the caller's own — an import is a
// personal act even when it lands in a shared account.
export const imports = new Hono<AppEnv>()

const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

// Gross statement figures, deliberately not countableAmount: this total is
// checked against the bank statement, which knows nothing of splits.
const BATCH_SELECT = `
  SELECT b.id, b.account_id, b.source_name, b.kind, b.moved_at, b.created_at,
         a.name AS account_name, a.color AS account_color, a.last4 AS account_last4,
         COUNT(t.id) AS row_count,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount WHEN t.type = 'expense' THEN -t.amount ELSE 0 END), 0) AS net,
         MIN(t.date) AS date_from, MAX(t.date) AS date_to
  FROM import_batches b
  LEFT JOIN accounts a ON a.id = b.account_id
  LEFT JOIN transactions t ON t.import_batch_id = b.id`

interface BatchRow {
  id: string
  account_id: string
}

async function ownBatch(db: D1Database, id: string, userId: string) {
  return db
    .prepare('SELECT id, account_id FROM import_batches WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<BatchRow>()
}

imports.get('/imports', async (c) => {
  // A batch whose rows were all deleted by hand has nothing left to review.
  const { results } = await c.env.DB.prepare(
    `${BATCH_SELECT} WHERE b.user_id = ? GROUP BY b.id HAVING row_count > 0 ORDER BY b.created_at DESC, b.rowid DESC`,
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

imports.get('/imports/:id', async (c) => {
  const row = await c.env.DB.prepare(`${BATCH_SELECT} WHERE b.id = ? AND b.user_id = ? GROUP BY b.id`)
    .bind(c.req.param('id'), c.get('userId'))
    .first()
  if (!row) return c.json({ error: 'import not found' }, 404)
  return c.json(row)
})

imports.post('/imports/:id/move', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const accountId = String((await body(c)).accountId ?? '')

  const batch = await ownBatch(c.env.DB, id, userId)
  if (!batch) return c.json({ error: 'import not found' }, 404)
  if (!accountId) return c.json({ error: 'accountId is required' }, 400)
  if (accountId === batch.account_id) return c.json({ error: 'the import is already in this account' }, 400)
  if (!(await writableAccountIds(c.env.DB, userId)).has(accountId)) {
    return c.json({ error: 'no write permission on this account' }, 403)
  }

  // A transfer into the target would become a transfer to itself.
  const clash = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transactions
     WHERE import_batch_id = ? AND user_id = ? AND account_id = ? AND type = 'transfer' AND destination_account_id = ?`,
  )
    .bind(id, userId, batch.account_id, accountId)
    .first<{ n: number }>()
  if (clash && clash.n > 0) {
    return c.json(
      { error: `${clash.n} transfer${clash.n !== 1 ? 's' : ''} in this import go${clash.n === 1 ? 'es' : ''} to that account — change ${clash.n !== 1 ? 'them' : 'it'} first` },
      409,
    )
  }

  // Only rows still in the batch's account move: one the user already re-filed
  // by hand stays where they put it.
  const [moved] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE transactions SET account_id = ?, updated_at = datetime('now')
       WHERE import_batch_id = ? AND user_id = ? AND account_id = ?`,
    ).bind(accountId, id, userId, batch.account_id),
    c.env.DB.prepare(`UPDATE import_batches SET account_id = ?, moved_at = datetime('now') WHERE id = ?`).bind(
      accountId,
      id,
    ),
  ])
  return c.json({ moved: moved.meta.changes })
})

imports.delete('/imports/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const batch = await ownBatch(c.env.DB, id, userId)
  if (!batch) return c.json({ error: 'import not found' }, 404)

  // Money already changed hands against these rows; deleting them would
  // orphan a real payment. Same line PATCH draws before rescaling a split.
  const settled = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transaction_splits ts JOIN transactions t ON t.id = ts.transaction_id
     WHERE t.import_batch_id = ? AND (ts.settled_at IS NOT NULL OR ts.settled_amount > 0)`,
  )
    .bind(id)
    .first<{ n: number }>()
  if (settled && settled.n > 0) {
    return c.json({ error: 'some splits in this import are already settled — undo those payments first' }, 409)
  }

  const [deleted] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM transactions WHERE import_batch_id = ? AND user_id = ?').bind(id, userId),
    c.env.DB.prepare('DELETE FROM import_batches WHERE id = ?').bind(id),
  ])
  return c.json({ deleted: deleted.meta.changes })
})
