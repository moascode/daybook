import { Router } from 'express'
import { getDb } from '../db.ts'
import { updateRow, normalizeBind } from '../lib.ts'

export const walletRouter: Router = Router()

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

// ── Accounts ─────────────────────────────────────────

const ACCOUNT_COLS: Record<string, string> = {
  name: 'name',
  description: 'description',
  currency: 'currency',
  type: 'type',
  color: 'color',
  icon: 'icon',
}

walletRouter.get('/accounts', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM accounts ORDER BY created_at ASC').all())
})

walletRouter.post('/accounts', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO accounts (id, name, description, currency, type, color, icon, created_at)
       VALUES (lower(hex(randomblob(16))), @name, @description, @currency, @type, @color, @icon, datetime('now'))
       RETURNING *`,
    )
    .get({
      name: b.name,
      description: b.description ?? '',
      currency: b.currency ?? 'MYR',
      type: b.type ?? 'cash',
      color: b.color ?? '#1D9E75',
      icon: b.icon ?? 'wallet',
    })
  res.status(201).json(row)
})

walletRouter.patch('/accounts/:id', (req, res) => {
  // accounts has no updated_at column.
  const row = updateRow(getDb(), 'accounts', req.params.id, ACCOUNT_COLS, req.body ?? {}, {
    touchUpdatedAt: false,
  })
  if (!row) return res.status(404).json({ error: 'account not found' })
  res.json(row)
})

walletRouter.delete('/accounts/:id', (req, res) => {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// Balance = income − expense − transfers out + transfers in.
walletRouter.get('/accounts/:id/balance', (req, res) => {
  const db = getDb()
  const id = req.params.id
  const sum = (sql: string) =>
    (db.prepare(sql).get(id) as { total: number }).total ?? 0
  const income = sum(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE account_id = ? AND type = 'income'`)
  const expense = sum(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE account_id = ? AND type = 'expense'`)
  const transferOut = sum(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE account_id = ? AND type = 'transfer'`)
  const transferIn = sum(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE destination_account_id = ? AND type = 'transfer'`)
  res.json({ balance: income - expense - transferOut + transferIn })
})

// ── Categories (read-only for now) ───────────────────

walletRouter.get('/categories', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all())
})

// ── Transactions ─────────────────────────────────────

const TRANSACTION_COLS: Record<string, string> = {
  accountId: 'account_id',
  destinationAccountId: 'destination_account_id',
  date: 'date',
  merchant: 'merchant',
  description: 'description',
  amount: 'amount',
  type: 'type',
  categoryId: 'category_id',
  tag: 'tag',
}

function insertTransaction(b: Record<string, unknown>) {
  return getDb()
    .prepare(
      `INSERT INTO transactions
         (id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
       VALUES
         (lower(hex(randomblob(16))), @accountId, @destinationAccountId, @date, @merchant, @description,
          @amount, @type, @categoryId, @tag, @importHash, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({
      accountId: b.accountId,
      destinationAccountId: b.destinationAccountId ?? null,
      date: b.date,
      merchant: b.merchant ?? '',
      description: b.description ?? '',
      amount: normalizeBind(b.amount),
      type: b.type,
      categoryId: b.categoryId ?? null,
      tag: b.tag ?? '',
      importHash: b.importHash ?? '',
    })
}

walletRouter.get('/transactions', (req, res) => {
  const q = req.query
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (str(q.dateFrom)) { conditions.push('date >= @dateFrom'); params.dateFrom = q.dateFrom }
  if (str(q.dateTo)) { conditions.push('date <= @dateTo'); params.dateTo = q.dateTo }
  if (str(q.type) && q.type !== 'all') { conditions.push('type = @type'); params.type = q.type }
  if (str(q.categoryId)) { conditions.push('category_id = @categoryId'); params.categoryId = q.categoryId }
  if (str(q.accountId)) {
    conditions.push('(account_id = @accountId OR destination_account_id = @accountId)')
    params.accountId = q.accountId
  }
  if (str(q.tag)) { conditions.push('tag LIKE @tag'); params.tag = `%${q.tag}%` }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, created_at DESC`)
    .all(params)
  res.json(rows)
})

// Joined rows for export (category + account names).
walletRouter.get('/transactions/export', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT t.date, t.merchant, t.description, t.amount, t.type,
              c.name AS category_name, a.name AS account_name, t.tag
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       ORDER BY t.date DESC, t.created_at DESC`,
    )
    .all()
  res.json(rows)
})

// Returns the subset of the given hashes that already exist.
walletRouter.post('/transactions/check-duplicates', (req, res) => {
  const hashes: string[] = Array.isArray(req.body?.hashes) ? req.body.hashes : []
  if (hashes.length === 0) return res.json([])
  const placeholders = hashes.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(`SELECT DISTINCT import_hash FROM transactions WHERE import_hash IN (${placeholders})`)
    .all(...hashes) as { import_hash: string }[]
  res.json(rows.map((r) => r.import_hash))
})

// Bulk insert (CSV import). Returns the created rows.
walletRouter.post('/transactions/import', (req, res) => {
  const items: Record<string, unknown>[] = Array.isArray(req.body) ? req.body : []
  const insertMany = getDb().transaction((rows: Record<string, unknown>[]) =>
    rows.map((b) => insertTransaction(b)),
  )
  res.status(201).json(insertMany(items))
})

walletRouter.post('/transactions', (req, res) => {
  res.status(201).json(insertTransaction(req.body ?? {}))
})

walletRouter.patch('/transactions/:id', (req, res) => {
  const row = updateRow(getDb(), 'transactions', req.params.id, TRANSACTION_COLS, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'transaction not found' })
  res.json(row)
})

walletRouter.delete('/transactions/:id', (req, res) => {
  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Budgets ──────────────────────────────────────────

walletRouter.get('/budgets', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM budgets ORDER BY created_at ASC').all())
})

walletRouter.post('/budgets', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO budgets (id, category_id, limit_amount, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @categoryId, @limitAmount, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({ categoryId: b.categoryId, limitAmount: normalizeBind(b.limitAmount) })
  res.status(201).json(row)
})

walletRouter.patch('/budgets/:id', (req, res) => {
  const row = updateRow(getDb(), 'budgets', req.params.id, { limitAmount: 'limit_amount' }, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'budget not found' })
  res.json(row)
})

walletRouter.delete('/budgets/:id', (req, res) => {
  getDb().prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Recurring transactions ───────────────────────────

const RECURRING_COLS: Record<string, string> = {
  accountId: 'account_id',
  amount: 'amount',
  merchant: 'merchant',
  type: 'type',
  categoryId: 'category_id',
  frequency: 'frequency',
  nextDueDate: 'next_due_date',
}

walletRouter.get('/recurring-transactions', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM recurring_transactions ORDER BY next_due_date ASC').all())
})

walletRouter.post('/recurring-transactions', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO recurring_transactions
         (id, account_id, amount, merchant, type, category_id, frequency, next_due_date, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @accountId, @amount, @merchant, @type, @categoryId, @frequency, @nextDueDate,
               datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({
      accountId: b.accountId,
      amount: normalizeBind(b.amount),
      merchant: b.merchant ?? '',
      type: b.type ?? 'expense',
      categoryId: b.categoryId ?? null,
      frequency: b.frequency,
      nextDueDate: b.nextDueDate,
    })
  res.status(201).json(row)
})

walletRouter.patch('/recurring-transactions/:id', (req, res) => {
  const row = updateRow(getDb(), 'recurring_transactions', req.params.id, RECURRING_COLS, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'recurring transaction not found' })
  res.json(row)
})

walletRouter.delete('/recurring-transactions/:id', (req, res) => {
  getDb().prepare('DELETE FROM recurring_transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Goals ────────────────────────────────────────────

const GOAL_COLS: Record<string, string> = {
  name: 'name',
  targetAmount: 'target_amount',
  accountId: 'account_id',
}

walletRouter.get('/goals', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM goals ORDER BY created_at ASC').all())
})

walletRouter.post('/goals', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO goals (id, name, target_amount, account_id, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @name, @targetAmount, @accountId, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({ name: b.name, targetAmount: normalizeBind(b.targetAmount), accountId: b.accountId })
  res.status(201).json(row)
})

walletRouter.patch('/goals/:id', (req, res) => {
  const row = updateRow(getDb(), 'goals', req.params.id, GOAL_COLS, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'goal not found' })
  res.json(row)
})

walletRouter.delete('/goals/:id', (req, res) => {
  getDb().prepare('DELETE FROM goals WHERE id = ?').run(req.params.id)
  res.status(204).end()
})
