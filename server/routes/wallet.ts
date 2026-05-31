import { Router } from 'express'
import { getDb } from '../db.ts'
import { updateRow, normalizeBind, ownsAllRefs } from '../lib.ts'

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
  openingBalance: 'opening_balance',
}

walletRouter.get('/accounts', (req, res) => {
  res.json(
    getDb().prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(req.session.userId!),
  )
})

walletRouter.post('/accounts', (req, res) => {
  const b = req.body ?? {}
  const row = getDb()
    .prepare(
      `INSERT INTO accounts (id, user_id, name, description, currency, type, color, icon, opening_balance, created_at)
       VALUES (lower(hex(randomblob(16))), @userId, @name, @description, @currency, @type, @color, @icon, @openingBalance, datetime('now'))
       RETURNING *`,
    )
    .get({
      userId: req.session.userId!,
      name: b.name,
      description: b.description ?? '',
      currency: b.currency ?? 'MYR',
      type: b.type ?? 'cash',
      color: b.color ?? '#1D9E75',
      icon: b.icon ?? 'wallet',
      openingBalance: normalizeBind(b.openingBalance ?? 0),
    })
  res.status(201).json(row)
})

walletRouter.patch('/accounts/:id', (req, res) => {
  // accounts has no updated_at column.
  const row = updateRow(getDb(), 'accounts', req.params.id, req.session.userId!, ACCOUNT_COLS, req.body ?? {}, {
    touchUpdatedAt: false,
  })
  if (!row) return res.status(404).json({ error: 'account not found' })
  res.json(row)
})

walletRouter.delete('/accounts/:id', (req, res) => {
  getDb().prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
})

// Balance = opening balance + income − expense − transfers out + transfers in.
walletRouter.get('/accounts/:id/balance', (req, res) => {
  const db = getDb()
  const id = req.params.id
  const userId = req.session.userId!
  const acct = db
    .prepare('SELECT opening_balance FROM accounts WHERE id = @id AND user_id = @userId')
    .get({ id, userId }) as { opening_balance: number } | undefined
  if (!acct) return res.status(404).json({ error: 'account not found' })
  const opening = acct.opening_balance ?? 0
  const total = (clause: string) =>
    (db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id = @userId AND ${clause}`)
      .get({ id, userId }) as { total: number }).total ?? 0
  const income = total(`account_id = @id AND type = 'income'`)
  const expense = total(`account_id = @id AND type = 'expense'`)
  const transferOut = total(`account_id = @id AND type = 'transfer'`)
  const transferIn = total(`destination_account_id = @id AND type = 'transfer'`)
  res.json({ balance: opening + income - expense - transferOut + transferIn })
})

// ── Categories ────────────────────────────────────────

walletRouter.get('/categories', (req, res) => {
  res.json(
    getDb().prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC').all(req.session.userId!),
  )
})

walletRouter.post('/categories', (req, res) => {
  const b = req.body ?? {}
  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const validTypes = new Set(['income', 'expense', 'both'])
  if (!validTypes.has(b.type)) {
    return res.status(400).json({ error: 'type must be income, expense, or both' })
  }
  const row = getDb()
    .prepare(
      `INSERT INTO categories (id, user_id, name, icon, color, type)
       VALUES (lower(hex(randomblob(16))), @userId, @name, @icon, @color, @type)
       RETURNING *`,
    )
    .get({
      userId: req.session.userId!,
      name: b.name.trim(),
      icon: b.icon ?? 'tag',
      color: b.color ?? '#378ADD',
      type: b.type,
    })
  res.status(201).json(row)
})

walletRouter.get('/categories/:id/usage', (req, res) => {
  const count = (getDb()
    .prepare('SELECT COUNT(*) as cnt FROM transactions WHERE category_id = ? AND user_id = ?')
    .get(req.params.id, req.session.userId!) as { cnt: number }).cnt
  res.json({ count })
})

walletRouter.delete('/categories/:id', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!cat) return res.status(404).json({ error: 'category not found' })
  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, userId)
  res.status(204).end()
})

// ── Tags ──────────────────────────────────────────────

walletRouter.get('/tags', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT je.value AS tag
       FROM transactions t, json_each(t.tag) je
       WHERE t.user_id = ? AND json_valid(t.tag) AND json_type(t.tag) = 'array' AND t.tag != '[]'
       ORDER BY je.value`,
    )
    .all(req.session.userId!) as { tag: string }[]
  res.json(rows.map((r) => r.tag))
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

function insertTransaction(b: Record<string, unknown>, userId: string) {
  return getDb()
    .prepare(
      `INSERT INTO transactions
         (id, user_id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
       VALUES
         (lower(hex(randomblob(16))), @userId, @accountId, @destinationAccountId, @date, @merchant, @description,
          @amount, @type, @categoryId, @tag, @importHash, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({
      userId,
      accountId: b.accountId,
      destinationAccountId: b.destinationAccountId ?? null,
      date: b.date,
      merchant: b.merchant ?? '',
      description: b.description ?? '',
      amount: normalizeBind(b.amount),
      type: b.type,
      categoryId: b.categoryId ?? null,
      tag: Array.isArray(b.tag) ? JSON.stringify(b.tag) : (b.tag ?? '[]'),
      importHash: b.importHash ?? '',
    })
}

walletRouter.get('/transactions', (req, res) => {
  const q = req.query
  const conditions: string[] = ['user_id = @userId']
  const params: Record<string, unknown> = { userId: req.session.userId! }

  if (str(q.dateFrom)) { conditions.push('date >= @dateFrom'); params.dateFrom = q.dateFrom }
  if (str(q.dateTo)) { conditions.push('date <= @dateTo'); params.dateTo = q.dateTo }
  if (str(q.type) && q.type !== 'all') { conditions.push('type = @type'); params.type = q.type }
  if (str(q.categoryId)) { conditions.push('category_id = @categoryId'); params.categoryId = q.categoryId }
  if (str(q.accountId)) {
    conditions.push('(account_id = @accountId OR destination_account_id = @accountId)')
    params.accountId = q.accountId
  }
  const rawTags = q.tags
    ? (Array.isArray(q.tags) ? q.tags : [q.tags]).filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  // Multiple tags use OR logic: a transaction matching ANY selected tag is returned.
  if (rawTags.length > 0) {
    const tagClauses = rawTags.map((_, i) => `EXISTS (SELECT 1 FROM json_each(transactions.tag) WHERE value = @tag${i})`)
    conditions.push(`(${tagClauses.join(' OR ')})`)
    for (let i = 0; i < rawTags.length; i++) params[`tag${i}`] = rawTags[i]
  }

  const rows = getDb()
    .prepare(`SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC, created_at DESC`)
    .all(params)
  res.json(rows)
})

// Joined rows for export. Accepts the same filter params as GET /transactions
// so the export respects the user's active filters.
walletRouter.get('/transactions/export', (req, res) => {
  const q = req.query
  const conditions: string[] = ['t.user_id = @userId']
  const params: Record<string, unknown> = { userId: req.session.userId! }

  if (str(q.dateFrom)) { conditions.push('t.date >= @dateFrom'); params.dateFrom = q.dateFrom }
  if (str(q.dateTo)) { conditions.push('t.date <= @dateTo'); params.dateTo = q.dateTo }
  if (str(q.type) && q.type !== 'all') { conditions.push('t.type = @type'); params.type = q.type }
  if (str(q.categoryId)) { conditions.push('t.category_id = @categoryId'); params.categoryId = q.categoryId }
  if (str(q.accountId)) {
    conditions.push('(t.account_id = @accountId OR t.destination_account_id = @accountId)')
    params.accountId = q.accountId
  }
  const rawTags = q.tags
    ? (Array.isArray(q.tags) ? q.tags : [q.tags]).filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  if (rawTags.length > 0) {
    const tagClauses = rawTags.map((_, i) => `EXISTS (SELECT 1 FROM json_each(t.tag) WHERE value = @tag${i})`)
    conditions.push(`(${tagClauses.join(' OR ')})`)
    for (let i = 0; i < rawTags.length; i++) params[`tag${i}`] = rawTags[i]
  }

  // If caller passes specific IDs, restrict to those (comma-separated).
  const ids = str(q.ids as string)
  if (ids) {
    const idList = ids.split(',').filter(Boolean)
    if (idList.length > 0) {
      const placeholders = idList.map((_, i) => `@id${i}`).join(', ')
      conditions.push(`t.id IN (${placeholders})`)
      idList.forEach((id, i) => { params[`id${i}`] = id })
    }
  }

  const rows = getDb()
    .prepare(
      `SELECT t.date, t.merchant, t.description, t.amount, t.type,
              c.name AS category_name, a.name AS account_name, t.tag
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.date DESC, t.created_at DESC`,
    )
    .all(params)
  res.json(rows)
})

// Returns the subset of the given hashes that already exist for this user.
// Batched to stay well under SQLite's bound-parameter limit on large imports.
walletRouter.post('/transactions/check-duplicates', (req, res) => {
  const hashes: string[] = Array.isArray(req.body?.hashes) ? req.body.hashes : []
  if (hashes.length === 0) return res.json([])
  const userId = req.session.userId!
  const db = getDb()
  const found = new Set<string>()
  const BATCH = 500
  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT DISTINCT import_hash FROM transactions WHERE user_id = ? AND import_hash IN (${placeholders})`)
      .all(userId, ...batch) as { import_hash: string }[]
    for (const r of rows) found.add(r.import_hash)
  }
  res.json([...found])
})

// Bulk insert (CSV import). Returns the created rows.
walletRouter.post('/transactions/import', (req, res) => {
  const items: Record<string, unknown>[] = Array.isArray(req.body) ? req.body : []
  const userId = req.session.userId!
  const db = getDb()
  for (const b of items) {
    if (!ownsAllRefs(db, userId, [['accounts', b.accountId], ['accounts', b.destinationAccountId], ['categories', b.categoryId]])) {
      return res.status(400).json({ error: 'invalid account or category reference' })
    }
  }
  const insertMany = db.transaction((rows: Record<string, unknown>[]) =>
    rows.map((b) => insertTransaction(b, userId)),
  )
  res.status(201).json(insertMany(items))
})

walletRouter.post('/transactions', (req, res) => {
  const b = req.body ?? {}
  if (!ownsAllRefs(getDb(), req.session.userId!, [['accounts', b.accountId], ['accounts', b.destinationAccountId], ['categories', b.categoryId]])) {
    return res.status(400).json({ error: 'invalid account or category reference' })
  }
  res.status(201).json(insertTransaction(b, req.session.userId!))
})

walletRouter.patch('/transactions/:id', (req, res) => {
  const b = req.body ?? {}
  const refs: Array<[string, unknown]> = []
  if ('accountId' in b) refs.push(['accounts', b.accountId])
  if ('destinationAccountId' in b) refs.push(['accounts', b.destinationAccountId])
  if ('categoryId' in b) refs.push(['categories', b.categoryId])
  if (!ownsAllRefs(getDb(), req.session.userId!, refs)) {
    return res.status(400).json({ error: 'invalid account or category reference' })
  }
  const row = updateRow(getDb(), 'transactions', req.params.id, req.session.userId!, TRANSACTION_COLS, b)
  if (!row) return res.status(404).json({ error: 'transaction not found' })
  res.json(row)
})

walletRouter.delete('/transactions/:id', (req, res) => {
  getDb().prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
})

// ── Budgets ──────────────────────────────────────────

walletRouter.get('/budgets', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at ASC').all(req.session.userId!))
})

walletRouter.post('/budgets', (req, res) => {
  const b = req.body ?? {}
  if (!ownsAllRefs(getDb(), req.session.userId!, [['categories', b.categoryId]])) {
    return res.status(400).json({ error: 'invalid category reference' })
  }
  const row = getDb()
    .prepare(
      `INSERT INTO budgets (id, user_id, category_id, limit_amount, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @userId, @categoryId, @limitAmount, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({ userId: req.session.userId!, categoryId: b.categoryId, limitAmount: normalizeBind(b.limitAmount) })
  res.status(201).json(row)
})

walletRouter.patch('/budgets/:id', (req, res) => {
  const row = updateRow(getDb(), 'budgets', req.params.id, req.session.userId!, { limitAmount: 'limit_amount' }, req.body ?? {})
  if (!row) return res.status(404).json({ error: 'budget not found' })
  res.json(row)
})

walletRouter.delete('/budgets/:id', (req, res) => {
  getDb().prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
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

walletRouter.get('/recurring-transactions', (req, res) => {
  res.json(
    getDb()
      .prepare('SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_due_date ASC')
      .all(req.session.userId!),
  )
})

// Recurring rules only post income or expense (never transfers — a transfer
// needs a destination account these rules don't carry) and repeat monthly or
// weekly. Guard both so a malformed rule can't post corrupt transactions.
const RECURRING_TYPES = new Set(['income', 'expense'])
const RECURRING_FREQS = new Set(['monthly', 'weekly'])

walletRouter.post('/recurring-transactions', (req, res) => {
  const b = req.body ?? {}
  if (!ownsAllRefs(getDb(), req.session.userId!, [['accounts', b.accountId], ['categories', b.categoryId]])) {
    return res.status(400).json({ error: 'invalid account or category reference' })
  }
  if (b.type != null && !RECURRING_TYPES.has(b.type)) {
    return res.status(400).json({ error: 'recurring type must be income or expense' })
  }
  if (!RECURRING_FREQS.has(b.frequency)) {
    return res.status(400).json({ error: 'recurring frequency must be monthly or weekly' })
  }
  const row = getDb()
    .prepare(
      `INSERT INTO recurring_transactions
         (id, user_id, account_id, amount, merchant, type, category_id, frequency, next_due_date, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @userId, @accountId, @amount, @merchant, @type, @categoryId, @frequency, @nextDueDate,
               datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({
      userId: req.session.userId!,
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

// Advance an ISO date (YYYY-MM-DD) by one recurrence period. Monthly clamps to
// the last valid day of the target month (e.g. 31 Jan → 28/29 Feb).
function advanceDate(dateStr: string, frequency: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + 7)
    return dt.toISOString().slice(0, 10)
  }
  let ny = y
  let nm = m + 1
  if (nm > 12) { nm = 1; ny += 1 }
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const nd = Math.min(d, lastDay)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

// Local calendar date (YYYY-MM-DD), matching the client's todayISO() — NOT UTC.
// On a home-network server the local timezone is the user's, so recurring posts
// are dated the user's "today", consistent with manually entered transactions.
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface RecurringRecord {
  id: string
  account_id: string
  amount: number
  merchant: string
  type: string
  category_id: string | null
  frequency: string
  next_due_date: string
}

// Process every rule that is due on/before today, posting a real transaction for
// each missed occurrence (catch-up) and advancing next_due_date past today.
// Returns how many transactions were posted.
walletRouter.post('/recurring-transactions/process', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const today = todayStr()
  const due = db
    .prepare('SELECT * FROM recurring_transactions WHERE user_id = ? AND next_due_date <= ?')
    .all(userId, today) as RecurringRecord[]

  let posted = 0
  const run = db.transaction(() => {
    for (const rule of due) {
      let next = rule.next_due_date
      let guard = 0
      while (next <= today && guard < 120) {
        insertTransaction(
          {
            accountId: rule.account_id,
            date: next,
            merchant: rule.merchant,
            description: '',
            amount: rule.amount,
            type: rule.type,
            categoryId: rule.category_id,
          },
          userId,
        )
        next = advanceDate(next, rule.frequency)
        posted++
        guard++
      }
      db.prepare(
        `UPDATE recurring_transactions SET next_due_date = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      ).run(next, rule.id, userId)
    }
  })
  run()
  res.json({ posted })
})

// Post a single rule immediately (dated today) and push its schedule forward one
// period. Used by the "Post now" action.
walletRouter.post('/recurring-transactions/:id/post', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const rule = db
    .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as RecurringRecord | undefined
  if (!rule) return res.status(404).json({ error: 'recurring transaction not found' })

  const today = todayStr()
  insertTransaction(
    {
      accountId: rule.account_id,
      date: today,
      merchant: rule.merchant,
      description: '',
      amount: rule.amount,
      type: rule.type,
      categoryId: rule.category_id,
    },
    userId,
  )
  // Only advance the schedule when the rule was actually due. Posting an early,
  // ad-hoc occurrence must not consume (skip) the upcoming scheduled one.
  const next =
    rule.next_due_date <= today ? advanceDate(rule.next_due_date, rule.frequency) : rule.next_due_date
  const row = db
    .prepare(
      `UPDATE recurring_transactions SET next_due_date = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? RETURNING *`,
    )
    .get(next, rule.id, userId)
  res.json(row)
})

walletRouter.patch('/recurring-transactions/:id', (req, res) => {
  const b = req.body ?? {}
  if ('type' in b && !RECURRING_TYPES.has(b.type)) {
    return res.status(400).json({ error: 'recurring type must be income or expense' })
  }
  if ('frequency' in b && !RECURRING_FREQS.has(b.frequency)) {
    return res.status(400).json({ error: 'recurring frequency must be monthly or weekly' })
  }
  const refs: Array<[string, unknown]> = []
  if ('accountId' in b) refs.push(['accounts', b.accountId])
  if ('categoryId' in b) refs.push(['categories', b.categoryId])
  if (!ownsAllRefs(getDb(), req.session.userId!, refs)) {
    return res.status(400).json({ error: 'invalid account or category reference' })
  }
  const row = updateRow(getDb(), 'recurring_transactions', req.params.id, req.session.userId!, RECURRING_COLS, b)
  if (!row) return res.status(404).json({ error: 'recurring transaction not found' })
  res.json(row)
})

walletRouter.delete('/recurring-transactions/:id', (req, res) => {
  getDb().prepare('DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
})

// ── Goals ────────────────────────────────────────────

const GOAL_COLS: Record<string, string> = {
  name: 'name',
  targetAmount: 'target_amount',
  accountId: 'account_id',
}

walletRouter.get('/goals', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at ASC').all(req.session.userId!))
})

walletRouter.post('/goals', (req, res) => {
  const b = req.body ?? {}
  if (!ownsAllRefs(getDb(), req.session.userId!, [['accounts', b.accountId]])) {
    return res.status(400).json({ error: 'invalid account reference' })
  }
  const row = getDb()
    .prepare(
      `INSERT INTO goals (id, user_id, name, target_amount, account_id, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), @userId, @name, @targetAmount, @accountId, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    .get({ userId: req.session.userId!, name: b.name, targetAmount: normalizeBind(b.targetAmount), accountId: b.accountId })
  res.status(201).json(row)
})

walletRouter.patch('/goals/:id', (req, res) => {
  const b = req.body ?? {}
  if ('accountId' in b && !ownsAllRefs(getDb(), req.session.userId!, [['accounts', b.accountId]])) {
    return res.status(400).json({ error: 'invalid account reference' })
  }
  const row = updateRow(getDb(), 'goals', req.params.id, req.session.userId!, GOAL_COLS, b)
  if (!row) return res.status(404).json({ error: 'goal not found' })
  res.json(row)
})

walletRouter.delete('/goals/:id', (req, res) => {
  getDb().prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId!)
  res.status(204).end()
})
