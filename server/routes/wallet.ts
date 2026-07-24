import { Router } from 'express'
import { getDb } from '../db.ts'
import { updateRow, normalizeBind, ownsAllRefs, splitEqually } from '../lib.ts'
import { visibleAccountIds, canWriteAccount, isGroupMember, coGroupUserIds } from '../lib/sharing.ts'

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

const ACCOUNT_TYPES = new Set(['cash', 'card', 'e-wallet', 'bank', 'investment', 'other'])

// B-21/CD-11: validate account fields on both create and edit so the API can't
// store a blank name or a non-numeric opening balance (which SQLite would then
// silently coerce to 0 in the balance sum) the way the UI forms already prevent.
function accountInputError(b: Record<string, unknown>, partial: boolean): string | null {
  const has = (k: string) => k in b
  if (!partial || has('name')) {
    if (typeof b.name !== 'string' || !b.name.trim()) return 'name is required'
  }
  if (has('type') && (typeof b.type !== 'string' || !ACCOUNT_TYPES.has(b.type))) {
    return 'type must be one of: cash, card, e-wallet, bank, investment, other'
  }
  if (has('openingBalance')) {
    const n = typeof b.openingBalance === 'number' || typeof b.openingBalance === 'string'
      ? Number(b.openingBalance) : NaN
    if (!Number.isFinite(n)) return 'openingBalance must be a number'
  }
  return null
}

walletRouter.get('/accounts', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!

  // Own accounts
  const own = db
    .prepare('SELECT *, 0 AS is_shared, NULL AS shared_by_user_id, NULL AS shared_by_username FROM accounts WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as Record<string, unknown>[]

  // Shared-in accounts (visible via a group the user belongs to)
  const shared = db
    .prepare(
      `SELECT a.*, 1 AS is_shared, a.user_id AS shared_by_user_id, u.username AS shared_by_username,
              MAX(acs.can_write) AS can_write
       FROM account_shares acs
       JOIN groups g ON g.id = acs.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       JOIN accounts a ON a.id = acs.account_id
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id != ?
       GROUP BY a.id
       ORDER BY a.created_at ASC`,
    )
    .all(userId, userId) as Record<string, unknown>[]

  res.json([...own, ...shared])
})

walletRouter.post('/accounts', (req, res) => {
  const b = req.body ?? {}
  const err = accountInputError(b, false)
  if (err) return res.status(400).json({ error: err })
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
  const err = accountInputError(req.body ?? {}, true)
  if (err) return res.status(400).json({ error: err })
  // accounts has no updated_at column.
  const row = updateRow(getDb(), 'accounts', req.params.id, req.session.userId!, ACCOUNT_COLS, req.body ?? {}, {
    touchUpdatedAt: false,
  })
  if (!row) return res.status(404).json({ error: 'account not found' })
  res.json(row)
})

walletRouter.delete('/accounts/:id', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!acct) return res.status(204).end() // idempotent: nothing owned to delete

  // B-05: deleting an account cascades its transactions (and their shares) away.
  // Don't let that silently erase live household debts or other members' history.
  const outstandingShare = db
    .prepare(
      `SELECT 1 FROM transaction_shares ts
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.account_id = ? AND ts.settled_at IS NULL AND ts.user_id != t.user_id
       LIMIT 1`,
    )
    .get(req.params.id)
  if (outstandingShare) {
    return res.status(409).json({ error: 'settle the outstanding splits on this account before deleting it' })
  }
  const othersTxn = db
    .prepare('SELECT 1 FROM transactions WHERE account_id = ? AND user_id != ? LIMIT 1')
    .get(req.params.id, userId)
  if (othersTxn) {
    return res.status(409).json({ error: 'this shared account has transactions from other members; unshare it first' })
  }

  db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, userId)
  res.status(204).end()
})

// C1: All visible account balances in one query. The per-account math below
// (`/:id/balance`) is the reference — the CASE arms here must stay equivalent:
// balance = opening balance + income − expense − transfers out + transfers in.
walletRouter.get('/accounts/balances', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const visible = visibleAccountIds(db, userId)
  if (visible.length === 0) return res.json([])
  const placeholders = visible.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT a.id,
              COALESCE(a.opening_balance, 0)
              + COALESCE((SELECT SUM(CASE t.type
                                       WHEN 'income' THEN t.amount
                                       WHEN 'expense' THEN -t.amount
                                       WHEN 'transfer' THEN -t.amount
                                       ELSE 0 END)
                          FROM transactions t WHERE t.account_id = a.id), 0)
              + COALESCE((SELECT SUM(t.amount)
                          FROM transactions t
                          WHERE t.destination_account_id = a.id AND t.type = 'transfer'), 0)
              AS balance
       FROM accounts a
       WHERE a.id IN (${placeholders})`,
    )
    .all(...visible) as { id: string; balance: number }[]
  res.json(rows)
})

// Balance = opening balance + income − expense − transfers out + transfers in.
// Kept for per-card fetches (AccountCard) — see the batched route above.
walletRouter.get('/accounts/:id/balance', (req, res) => {
  const db = getDb()
  const id = req.params.id
  const userId = req.session.userId!
  // Allow both own accounts and shared-in accounts
  const visible = visibleAccountIds(db, userId)
  const acct = visible.includes(id)
    ? db.prepare('SELECT opening_balance FROM accounts WHERE id = ?').get(id) as { opening_balance: number } | undefined
    : undefined
  if (!acct) return res.status(404).json({ error: 'account not found' })
  const opening = acct.opening_balance ?? 0
  const total = (clause: string) =>
    (db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE ${clause}`)
      .get({ id }) as { total: number }).total ?? 0
  const income = total(`account_id = @id AND type = 'income'`)
  const expense = total(`account_id = @id AND type = 'expense'`)
  const transferOut = total(`account_id = @id AND type = 'transfer'`)
  const transferIn = total(`destination_account_id = @id AND type = 'transfer'`)
  res.json({ balance: opening + income - expense - transferOut + transferIn })
})

// ── Account shares ────────────────────────────────────

walletRouter.get('/accounts/:id/shares', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!acct) return res.status(404).json({ error: 'account not found' })
  const rows = db
    .prepare(
      `SELECT acs.account_id, acs.group_id, acs.can_write, acs.shared_at, g.name AS group_name
       FROM account_shares acs
       JOIN groups g ON g.id = acs.group_id
       WHERE acs.account_id = ?`,
    )
    .all(req.params.id)
  res.json(rows)
})

walletRouter.post('/accounts/:id/shares', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!acct) return res.status(404).json({ error: 'account not found' })
  const { groupId, canWrite } = req.body ?? {}
  if (!groupId) return res.status(400).json({ error: 'groupId is required' })
  const group = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)
  if (!group) return res.status(403).json({ error: 'you must be a member of the group' })
  const row = db
    .prepare(
      `INSERT OR REPLACE INTO account_shares (account_id, group_id, can_write, shared_at)
       VALUES (?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    .get(req.params.id, groupId, canWrite ? 1 : 0)
  res.status(201).json(row)
})

walletRouter.patch('/accounts/:id/shares/:groupId', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!acct) return res.status(404).json({ error: 'account not found' })
  const { canWrite } = req.body ?? {}
  const row = db
    .prepare('UPDATE account_shares SET can_write = ? WHERE account_id = ? AND group_id = ? RETURNING *')
    .get(canWrite ? 1 : 0, req.params.id, req.params.groupId)
  if (!row) return res.status(404).json({ error: 'share not found' })
  res.json(row)
})

walletRouter.delete('/accounts/:id/shares/:groupId', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, userId)
  if (!acct) return res.status(404).json({ error: 'account not found' })
  // C-10: Verify caller is a member of the group being unshared from
  if (!isGroupMember(db, userId, req.params.groupId)) {
    return res.status(403).json({ error: 'you are not a member of this group' })
  }
  db.prepare('DELETE FROM account_shares WHERE account_id = ? AND group_id = ?').run(req.params.id, req.params.groupId)
  res.status(204).end()
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

// C2: transaction payload validation. `partial` (PATCH) only checks fields
// present in the body; `existing` supplies the row's current values so the
// cross-field transfer rule still holds after a partial update.
const TXN_TYPES = new Set(['income', 'expense', 'transfer'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function transactionInputError(
  b: Record<string, unknown>,
  opts: {
    partial?: boolean
    existing?: { type: string; account_id: string; destination_account_id: string | null }
  } = {},
): string | null {
  const partial = opts.partial ?? false
  const has = (k: string) => k in b && b[k] !== undefined

  if (!partial || has('type')) {
    if (typeof b.type !== 'string' || !TXN_TYPES.has(b.type)) {
      return 'type must be income, expense, or transfer'
    }
  }
  if (!partial || has('amount')) {
    const amt = typeof b.amount === 'number' || typeof b.amount === 'string' ? Number(b.amount) : NaN
    if (!Number.isFinite(amt) || amt <= 0) return 'amount must be a positive number'
  }
  if (!partial || has('date')) {
    if (typeof b.date !== 'string' || !ISO_DATE_RE.test(b.date) || Number.isNaN(Date.parse(b.date))) {
      return 'date must be an ISO date (YYYY-MM-DD)'
    }
  }
  if (!partial || has('accountId')) {
    if (typeof b.accountId !== 'string' || b.accountId.length === 0) {
      return 'accountId is required'
    }
  }

  // Transfers need a destination distinct from the source account.
  const type = has('type') ? b.type : opts.existing?.type
  const accountId = has('accountId') ? b.accountId : opts.existing?.account_id
  const dest = has('destinationAccountId') ? b.destinationAccountId : opts.existing?.destination_account_id
  if (type === 'transfer') {
    if (typeof dest !== 'string' || dest.length === 0) {
      return 'transfer requires a destinationAccountId'
    }
    if (dest === accountId) {
      return 'transfer destination must differ from the source account'
    }
  }
  return null
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

// view scoping ('mine' | 'shared-with-me' | 'shared-with-others' | 'all'),
// shared by GET /transactions and GET /transactions/export so the exported
// rows always match the on-screen selection (§1.2). `alias` is the
// transactions table name/alias in the caller's query; extra bind params for
// the 'all' view are written into `params`.
function viewCondition(
  db: ReturnType<typeof getDb>,
  userId: string,
  view: string,
  alias: string,
  params: Record<string, unknown>,
): string {
  if (view === 'mine') {
    // Own transactions only (whether split or not)
    return `${alias}.user_id = @userId`
  }
  if (view === 'shared-with-me') {
    // Transactions created by others where I have a share line
    return `${alias}.user_id != @userId AND EXISTS (SELECT 1 FROM transaction_shares ts WHERE ts.transaction_id = ${alias}.id AND ts.user_id = @userId)`
  }
  if (view === 'shared-with-others') {
    // My transactions that have been shared with others
    return `${alias}.user_id = @userId AND EXISTS (SELECT 1 FROM transaction_shares ts WHERE ts.transaction_id = ${alias}.id AND ts.user_id != @userId)`
  }
  // All visible: own transactions + transactions on shared accounts
  const visible = visibleAccountIds(db, userId)
  if (visible.length === 0) return `${alias}.user_id = @userId`
  const placeholders = visible.map((_, i) => `@aid${i}`).join(', ')
  visible.forEach((id, i) => { params[`aid${i}`] = id })
  return `(${alias}.user_id = @userId OR ${alias}.account_id IN (${placeholders}) OR ${alias}.destination_account_id IN (${placeholders}))`
}

walletRouter.get('/transactions', (req, res) => {
  const q = req.query
  const userId = req.session.userId!
  const db = getDb()

  const view = str(q.view) ?? 'all'
  const params: Record<string, unknown> = { userId }
  const conditions: string[] = [viewCondition(db, userId, view, 'transactions', params)]

  if (str(q.dateFrom)) { conditions.push('date >= @dateFrom'); params.dateFrom = q.dateFrom }
  if (str(q.dateTo)) { conditions.push('date <= @dateTo'); params.dateTo = q.dateTo }
  if (str(q.type) && q.type !== 'all') { conditions.push('type = @type'); params.type = q.type }
  if (str(q.categoryId)) { conditions.push('category_id = @categoryId'); params.categoryId = q.categoryId }
  if (str(q.accountId)) {
    conditions.push('(account_id = @accountId OR destination_account_id = @accountId)')
    params.accountId = q.accountId
  }
  // B1: Free-text search on merchant/description
  if (str(q.q)) {
    conditions.push('(merchant LIKE @q OR description LIKE @q)')
    params.q = `%${q.q}%`
  }
  const rawTags = q.tags
    ? (Array.isArray(q.tags) ? q.tags : [q.tags]).filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  // Multiple tags use OR logic: a transaction matching ANY selected tag is returned.
  // Guard with CASE so json_each never receives invalid/empty JSON (rows with tag=''
  // or non-array values would otherwise throw a SQLite runtime error).
  if (rawTags.length > 0) {
    const safeTag = `CASE WHEN json_valid(transactions.tag) AND json_type(transactions.tag)='array' THEN transactions.tag ELSE '[]' END`
    const tagClauses = rawTags.map((_, i) => `EXISTS (SELECT 1 FROM json_each(${safeTag}) WHERE value = @tag${i})`)
    conditions.push(`(${tagClauses.join(' OR ')})`)
    for (let i = 0; i < rawTags.length; i++) params[`tag${i}`] = rawTags[i]
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(`
      SELECT transactions.*,
        CASE WHEN EXISTS (SELECT 1 FROM transaction_shares ts WHERE ts.transaction_id = transactions.id) THEN 1 ELSE 0 END AS has_shares
      FROM transactions ${where} ORDER BY date DESC, created_at DESC
    `)
    .all(params)
  res.json(rows)
})

// Joined rows for export. Accepts the same filter params as GET /transactions
// so the export respects the user's active filters.
walletRouter.get('/transactions/export', (req, res) => {
  const q = req.query
  const userId = req.session.userId!
  const params: Record<string, unknown> = { userId }
  // §1.2: same view scoping as GET /transactions — the list view ("all") also
  // shows other members' transactions on shared-in accounts, so a hard
  // user_id-only scope silently dropped selected rows from the export.
  const view = str(q.view) ?? 'all'
  const conditions: string[] = [viewCondition(getDb(), userId, view, 't', params)]

  if (str(q.dateFrom)) { conditions.push('t.date >= @dateFrom'); params.dateFrom = q.dateFrom }
  if (str(q.dateTo)) { conditions.push('t.date <= @dateTo'); params.dateTo = q.dateTo }
  if (str(q.type) && q.type !== 'all') { conditions.push('t.type = @type'); params.type = q.type }
  if (str(q.categoryId)) { conditions.push('t.category_id = @categoryId'); params.categoryId = q.categoryId }
  if (str(q.accountId)) {
    conditions.push('(t.account_id = @accountId OR t.destination_account_id = @accountId)')
    params.accountId = q.accountId
  }
  // B1: Free-text search on merchant/description for export
  if (str(q.q)) {
    conditions.push('(t.merchant LIKE @q OR t.description LIKE @q)')
    params.q = `%${q.q}%`
  }
  const rawTags = q.tags
    ? (Array.isArray(q.tags) ? q.tags : [q.tags]).filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  if (rawTags.length > 0) {
    const safeTag = `CASE WHEN json_valid(t.tag) AND json_type(t.tag)='array' THEN t.tag ELSE '[]' END`
    const tagClauses = rawTags.map((_, i) => `EXISTS (SELECT 1 FROM json_each(${safeTag}) WHERE value = @tag${i})`)
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
  for (let i = 0; i < items.length; i++) {
    const err = transactionInputError(items[i])
    if (err) return res.status(400).json({ error: `row ${i + 1}: ${err}` })
  }
  // Match manual add (POST /transactions): importing into a writable shared-in
  // account is allowed, not just own accounts. Category must still be owned and
  // any transfer destination must be writable (B-07) — per-user scoping is preserved.
  for (let i = 0; i < items.length; i++) {
    const b = items[i]
    const accountId = String(b.accountId ?? '')
    if (!accountId || !canWriteAccount(db, userId, accountId)) {
      return res.status(403).json({ error: `row ${i + 1}: no write permission on this account` })
    }
    if (!ownsAllRefs(db, userId, [['categories', b.categoryId]])) {
      return res.status(400).json({ error: `row ${i + 1}: invalid category reference` })
    }
    if (b.destinationAccountId && !canWriteAccount(db, userId, String(b.destinationAccountId))) {
      return res.status(400).json({ error: `row ${i + 1}: no write permission on the destination account` })
    }
  }
  const insertMany = db.transaction((rows: Record<string, unknown>[]) =>
    rows.map((b) => insertTransaction(b, userId)),
  )
  res.status(201).json(insertMany(items))
})

walletRouter.post('/transactions', (req, res) => {
  const b = req.body ?? {}
  const db = getDb()
  const userId = req.session.userId!

  const inputErr = transactionInputError(b)
  if (inputErr) return res.status(400).json({ error: inputErr })

  // Allow writing to shared accounts with can_write permission
  const accountId = String(b.accountId ?? '')
  if (accountId && !canWriteAccount(db, userId, accountId)) {
    return res.status(403).json({ error: 'no write permission on this account' })
  }
  if (!ownsAllRefs(db, userId, [['categories', b.categoryId]])) {
    return res.status(400).json({ error: 'invalid category reference' })
  }
  // B-07: a transfer moves money INTO the destination, so it needs write
  // permission there — a read-only shared-in account must not be a target.
  if (b.destinationAccountId && !canWriteAccount(db, userId, String(b.destinationAccountId))) {
    return res.status(400).json({ error: 'no write permission on the destination account' })
  }

  // When posting to a shared account, the transaction user_id is the caller
  res.status(201).json(insertTransaction(b, userId))
})

walletRouter.patch('/transactions/:id', (req, res) => {
  const b = req.body ?? {}
  const db = getDb()
  const userId = req.session.userId!

  // Caller must own the transaction or have write permission on its account
  const existing = db
    .prepare('SELECT user_id, account_id, type, destination_account_id FROM transactions WHERE id = ?')
    .get(req.params.id) as
      | { user_id: string; account_id: string; type: string; destination_account_id: string | null }
      | undefined
  if (!existing) return res.status(404).json({ error: 'transaction not found' })

  const canEdit = existing.user_id === userId || canWriteAccount(db, userId, existing.account_id)
  if (!canEdit) return res.status(403).json({ error: 'no permission to edit this transaction' })

  const inputErr = transactionInputError(b, { partial: true, existing })
  if (inputErr) return res.status(400).json({ error: inputErr })

  // B-03: a moved transaction must land on an account the caller can write —
  // otherwise a member could re-point their transaction at anyone's account
  // (draining that balance) since the edit check only covered the OLD account.
  if ('accountId' in b && String(b.accountId) !== existing.account_id) {
    if (!canWriteAccount(db, userId, String(b.accountId))) {
      return res.status(403).json({ error: 'no write permission on the destination account' })
    }
  }
  if ('destinationAccountId' in b && b.destinationAccountId &&
      String(b.destinationAccountId) !== (existing.destination_account_id ?? '')) {
    if (!canWriteAccount(db, userId, String(b.destinationAccountId))) {
      return res.status(400).json({ error: 'no write permission on the destination account' })
    }
  }

  // Scope updateRow by original owner's user_id
  const refs: Array<[string, unknown]> = []
  if ('categoryId' in b) refs.push(['categories', b.categoryId])
  if (!ownsAllRefs(db, userId, refs)) {
    return res.status(400).json({ error: 'invalid category reference' })
  }

  // If amount changed and splits exist, auto-rescale the shares proportionally.
  if ('amount' in b && b.amount !== undefined) {
    const oldTxn = db
      .prepare('SELECT amount FROM transactions WHERE id = ?')
      .get(req.params.id) as { amount: number } | undefined
    if (oldTxn && oldTxn.amount !== b.amount) {
      const shareRows = db
        .prepare('SELECT id, share_amount FROM transaction_shares WHERE transaction_id = ? ORDER BY created_at ASC')
        .all(req.params.id) as { id: string; share_amount: number }[]
      if (shareRows.length > 0) {
        // B-06: never rewrite a settled/partially-paid split — the recorded
        // settlement would no longer match the share it cleared.
        if (hasSettledShare(db, req.params.id)) {
          return res.status(409).json({ error: 'cannot change the amount of a transaction with settled splits; undo the settlement first' })
        }
        const newAmount = Number(b.amount)
        // B-06: reject an amount too small to keep every split positive.
        if (newAmount < shareRows.length * 0.01) {
          return res.status(400).json({ error: 'amount is too small to keep every split positive' })
        }
        let allocated = 0
        const scaledShares: Array<{ id: string; amount: number }> = []
        for (let i = 0; i < shareRows.length; i++) {
          const row = shareRows[i]
          if (i === shareRows.length - 1) {
            scaledShares.push({ id: row.id, amount: Math.round((newAmount - allocated) * 100) / 100 })
          } else {
            const scaled = Math.max(0.01, Math.round((row.share_amount / oldTxn.amount) * newAmount * 100) / 100)
            scaledShares.push({ id: row.id, amount: scaled })
            allocated += scaled
          }
        }
        // If rounding/clamping pushed the remainder non-positive, reject rather than
        // write a zero/negative share.
        if (scaledShares.some((s) => s.amount <= 0)) {
          return res.status(400).json({ error: 'amount is too small to keep every split positive' })
        }
        const updShare = db.prepare('UPDATE transaction_shares SET share_amount = ? WHERE id = ?')
        for (const s of scaledShares) updShare.run(s.amount, s.id)
      }
    }
  }

  const row = updateRow(db, 'transactions', req.params.id, existing.user_id, TRANSACTION_COLS, b)
  if (!row) return res.status(404).json({ error: 'transaction not found' })
  res.json(row)
})

walletRouter.delete('/transactions/:id', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const existing = db
    .prepare('SELECT user_id, account_id FROM transactions WHERE id = ?')
    .get(req.params.id) as { user_id: string; account_id: string } | undefined
  if (!existing) return res.status(204).end()
  const canDel = existing.user_id === userId || canWriteAccount(db, userId, existing.account_id)
  if (!canDel) return res.status(403).json({ error: 'no permission to delete this transaction' })
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Transaction shares (splits) ───────────────────────

// True if any share on this transaction has been settled or partially paid.
// Used to protect settled splits from being rewritten (B-04, B-06).
function hasSettledShare(db: ReturnType<typeof getDb>, transactionId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM transaction_shares
       WHERE transaction_id = ? AND (settled_at IS NOT NULL OR settled_amount > 0)
       LIMIT 1`,
    )
    .get(transactionId)
}

walletRouter.get('/transactions/:id/shares', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  // Caller must be the owner or have a share line
  const txn = db
    .prepare('SELECT user_id FROM transactions WHERE id = ?')
    .get(req.params.id) as { user_id: string } | undefined
  if (!txn) return res.status(404).json({ error: 'transaction not found' })
  const hasShare = db.prepare('SELECT 1 FROM transaction_shares WHERE transaction_id = ? AND user_id = ?').get(req.params.id, userId)
  if (txn.user_id !== userId && !hasShare) {
    return res.status(403).json({ error: 'not authorised to view shares for this transaction' })
  }
  const rows = db
    .prepare(
      `SELECT ts.id, ts.transaction_id, ts.user_id, ts.share_amount, ts.note, ts.settled_at, ts.created_at, u.username
       FROM transaction_shares ts
       JOIN users u ON u.id = ts.user_id
       WHERE ts.transaction_id = ?
       ORDER BY ts.share_amount DESC`,
    )
    .all(req.params.id)
  res.json(rows)
})

// Quick single-transaction share — share with one recipient (full amount or split)
walletRouter.post('/transactions/:id/share', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const { recipientId, splitMode, shareAmounts } = req.body ?? {}

  // 1. Validate transaction exists and caller owns it
  const txn = db.prepare('SELECT id, user_id, amount FROM transactions WHERE id = ?').get(req.params.id) as { id: string; user_id: string; amount: number } | undefined
  if (!txn) return res.status(404).json({ error: 'transaction not found' })
  if (txn.user_id !== userId) {
    return res.status(403).json({ error: 'only the transaction owner can share' })
  }

  // B-04: re-splitting replaces every share row, which would erase settlement
  // history and resurrect an already-paid debt. Block it while any share on this
  // transaction has been settled or partially paid.
  if (hasSettledShare(db, req.params.id)) {
    return res.status(409).json({ error: 'this split has been (partly) settled; undo the settlement before changing it' })
  }

  // 2. Validate recipient is a co-group member
  const allowedIds = new Set(coGroupUserIds(db, txn.user_id))
  if (!allowedIds.has(String(recipientId))) {
    return res.status(400).json({ error: 'recipient is not a group co-member' })
  }

  // 3. Validate splitMode
  const validModes = ['none', 'equal', 'custom'] as const
  if (!(validModes as readonly string[]).includes(splitMode)) {
    return res.status(400).json({ error: 'splitMode must be "none", "equal", or "custom"' })
  }

  // 4. Calculate share amounts based on splitMode
  let shares: Array<{ userId: string; shareAmount: number; note?: string }> = []

  if (splitMode === 'none') {
    // Recipient owes 100% of the amount
    shares = [{ userId: recipientId, shareAmount: txn.amount, note: '' }]
  } else if (splitMode === 'equal') {
    // Split equally between owner + recipient (2 people)
    const [ownerShare, recipientShare] = splitEqually(txn.amount, 2)
    shares = [
      { userId: userId, shareAmount: ownerShare, note: '' },
      { userId: recipientId, shareAmount: recipientShare, note: '' },
    ]
  } else if (splitMode === 'custom') {
    // Use provided shareAmounts array
    if (!Array.isArray(shareAmounts) || shareAmounts.length !== 2) {
      return res.status(400).json({ error: 'shareAmounts must be array of 2 amounts' })
    }
    for (const amt of shareAmounts) {
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'each share amount must be a positive finite number' })
      }
    }
    const sum = shareAmounts.reduce((acc: number, a: number) => acc + a, 0)
    if (Math.abs(sum - txn.amount) > 0.015) {
      return res.status(400).json({ error: `amounts must sum to ${txn.amount}; got ${sum}` })
    }
    shares = [
      { userId: userId, shareAmount: shareAmounts[0], note: '' },
      { userId: recipientId, shareAmount: shareAmounts[1], note: '' },
    ]
  }

  // 5. Atomically insert share rows
  const result = db.transaction(() => {
    db.prepare('DELETE FROM transaction_shares WHERE transaction_id = ?').run(req.params.id)
    const insert = db.prepare(
      `INSERT INTO transaction_shares (id, transaction_id, user_id, share_amount, note, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    return shares.map((s) => insert.get(req.params.id, s.userId, s.shareAmount, s.note ?? ''))
  })()

  res.status(201).json(result)
})

// ── Bulk transaction shares ───────────────────────────
// POST /transactions/shares — Share multiple transactions at once.
// Body: { transactions: Array<{ transactionId: string; shares: Array<{ userId, shareAmount, note? }> }> }
walletRouter.post('/transactions/shares', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!

  type ShareEntry = { userId: string; shareAmount: number; note?: string }
  type TxnPayload = { transactionId: string; shares: ShareEntry[] }
  const { transactions }: { transactions: TxnPayload[] } = req.body ?? {}

  // 1. Top-level shape check (Issue 12)
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'transactions array is required and must be non-empty' })
  }

  // 2. Unbounded IN clause guard (Issue 10)
  if (transactions.length > 500) {
    return res.status(400).json({ error: 'cannot share more than 500 transactions at once' })
  }

  // 3. Per-element structural validation (Issue 12)
  for (const tx of transactions) {
    if (typeof tx.transactionId !== 'string' || tx.transactionId.length === 0) {
      return res.status(400).json({ error: 'each transactionId must be a non-empty string' })
    }
    if (!Array.isArray(tx.shares) || tx.shares.length === 0) {
      return res.status(400).json({ error: `shares array is required for transaction ${tx.transactionId}` })
    }
  }

  // 4. Share amount positivity check
  for (const tx of transactions) {
    for (const s of tx.shares) {
      const amt = Number(s.shareAmount)
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'each share amount must be a positive number' })
      }
    }
  }

  // 5. Fetch all transactions in one query
  const transactionIds = transactions.map((tx) => tx.transactionId)
  const placeholders = transactionIds.map(() => '?').join(',')
  const txnRows = db
    .prepare(`SELECT id, user_id, amount, account_id FROM transactions WHERE id IN (${placeholders})`)
    .all(...transactionIds) as Array<{ id: string; user_id: string; amount: number; account_id: string }>
  const txnMap = new Map(txnRows.map((t) => [t.id, t]))

  if (txnMap.size !== transactionIds.length) {
    return res.status(400).json({ error: 'one or more transactions not found' })
  }

  // 6. Owner-only auth check — only the transaction owner may set bulk splits (Issue 3)
  for (const tx of transactions) {
    const txn = txnMap.get(tx.transactionId)!
    if (txn.user_id !== userId) {
      return res.status(403).json({ error: `only the owner can share transaction ${tx.transactionId}` })
    }
  }

  // 7. Co-group membership check per transaction (S-3)
  for (const tx of transactions) {
    const txn = txnMap.get(tx.transactionId)!
    const allowedIds = new Set(coGroupUserIds(db, txn.user_id))
    for (const s of tx.shares) {
      if (!allowedIds.has(String(s.userId))) {
        return res.status(400).json({
          error: `user ${s.userId} is not a group co-member with transaction ${tx.transactionId}'s owner`,
        })
      }
    }
  }

  // 8. Sum validation BEFORE opening db.transaction() (Issue 2)
  for (const tx of transactions) {
    const txn = txnMap.get(tx.transactionId)!
    const sum = tx.shares.reduce((acc, s) => acc + Number(s.shareAmount), 0)
    if (Math.abs(sum - txn.amount) > 0.015) {
      return res.status(400).json({
        error: `share amounts for transaction ${tx.transactionId} must sum to ${txn.amount}; got ${sum}`,
      })
    }
  }

  // 8b. B-04: refuse to replace shares that have been (partly) settled.
  for (const tx of transactions) {
    if (hasSettledShare(db, tx.transactionId)) {
      return res.status(409).json({
        error: `transaction ${tx.transactionId} has a settled split; undo the settlement before re-sharing`,
      })
    }
  }

  // 9. Atomic DB writes — only INSERT/DELETE inside, no throwing (Issue 2)
  db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO transaction_shares (id, transaction_id, user_id, share_amount, note, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))`,
    )
    for (const tx of transactions) {
      db.prepare('DELETE FROM transaction_shares WHERE transaction_id = ?').run(tx.transactionId)
      for (const s of tx.shares) {
        insert.run(tx.transactionId, s.userId, s.shareAmount, s.note ?? '')
      }
    }
  })()

  res.status(201).json({ message: 'transactions shared successfully', transactionIds })
})

// Batch share status check — returns { transactionId, hasShares } for each ID
walletRouter.post('/transactions/shares/status', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!
  const { transactionIds }: { transactionIds: string[] } = req.body ?? {}

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    return res.json([])
   }

  if (transactionIds.length > 500) {
    return res.status(400).json({ error: 'cannot check more than 500 transactions at once' })
  }

  // Only return share status for transactions the caller owns
  const placeholders = transactionIds.map(() => '?').join(',')
  const ownedRows = db.prepare(
    `SELECT id FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
  ).all(...transactionIds, userId) as Array<{ id: string }>
  const ownedIds = new Set(ownedRows.map((r) => r.id))

  // B-08: match the transaction list's own EXISTS check — a "Keep as-is" share
  // writes only the recipient's row, so filtering by the owner's user_id here made
  // the status say hasShares:false while the list badged the row as split. Owner
  // scoping is already enforced by the ownedIds filter below.
  const rows = db.prepare(`
      SELECT DISTINCT transaction_id
      FROM transaction_shares
      WHERE transaction_id IN (${placeholders})
     `).all(...transactionIds) as Array<{ transaction_id: string }>
  const sharedIds = new Set(rows.map((r) => r.transaction_id))

  const result = transactionIds
    .filter((id) => ownedIds.has(id))
    .map((id) => ({
      transactionId: id,
      hasShares: sharedIds.has(id),
    }))

  res.json(result)
})

// ── Budgets ──────────────────────────────────────────

walletRouter.get('/budgets', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at ASC').all(req.session.userId!))
})

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// B-15 residual: budgets must count only the caller's EFFECTIVE spend — when
// a transaction they own has been split, their own `share_amount` (0 if they
// have no share row), not the full transaction amount. Computed as one
// set-based aggregate (see server/lib/sharing.ts effectiveAmount(), whose
// per-transaction logic this mirrors) rather than a per-row loop over a
// month of transactions.
walletRouter.get('/budgets/spending', (req, res) => {
  const db = getDb()
  const userId = req.session.userId!

  const monthParam = str(req.query.month)
  const month = monthParam ?? todayStr().slice(0, 7)
  if (!MONTH_RE.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' })
  }

  const rows = db
    .prepare(
      `SELECT t.category_id AS categoryId,
              SUM(
                CASE
                  WHEN EXISTS (SELECT 1 FROM transaction_shares ts WHERE ts.transaction_id = t.id)
                    THEN COALESCE(own.share_amount, 0)
                  ELSE t.amount
                END
              ) AS spent
       FROM transactions t
       LEFT JOIN transaction_shares own
         ON own.transaction_id = t.id AND own.user_id = @userId
       WHERE t.user_id = @userId
         AND t.type = 'expense'
         AND t.category_id IS NOT NULL
         AND t.date LIKE @monthPrefix
       GROUP BY t.category_id`,
    )
    .all({ userId, monthPrefix: `${month}-%` }) as { categoryId: string; spent: number }[]

  res.json(rows)
})

// C2: shared minimal check for budget limits and goal targets.
function positiveAmountError(v: unknown, field: string): string | null {
  const amt = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(amt) || amt <= 0) return `${field} must be a positive number`
  return null
}

walletRouter.post('/budgets', (req, res) => {
  const b = req.body ?? {}
  const amtErr = positiveAmountError(b.limitAmount, 'limitAmount')
  if (amtErr) return res.status(400).json({ error: amtErr })
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
  const b = req.body ?? {}
  if ('limitAmount' in b) {
    const amtErr = positiveAmountError(b.limitAmount, 'limitAmount')
    if (amtErr) return res.status(400).json({ error: amtErr })
  }
  const row = updateRow(getDb(), 'budgets', req.params.id, req.session.userId!, { limitAmount: 'limit_amount' }, b)
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

// §1.3: a rule with a bad amount or due date would auto-post corrupt
// transactions on every boot via /recurring-transactions/process, so both are
// validated like transactions (C2) — not left to the client-side form guard.
function isoDateError(v: unknown, field: string): string | null {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    return `${field} must be an ISO date (YYYY-MM-DD)`
  }
  return null
}

// B-20: a next-due-date far in the past would catch-up-post a burst of back-dated
// transactions (capped at 120) on the next boot — almost always a fat-finger.
// Reject anything more than a year before today; legitimate catch-up is recent.
function farPastDueError(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  if (v < oneYearAgo.toISOString().slice(0, 10)) {
    return 'next due date is too far in the past (more than a year ago)'
  }
  return null
}

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
  const amtErr = positiveAmountError(b.amount, 'amount')
  if (amtErr) return res.status(400).json({ error: amtErr })
  const dateErr = isoDateError(b.nextDueDate, 'nextDueDate') ?? farPastDueError(b.nextDueDate)
  if (dateErr) return res.status(400).json({ error: dateErr })
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
  const lastDayThis = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lastDayNext = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  // B-10: keep an end-of-month rule anchored to month-end (31 Jan → 28/29 Feb →
  // 31 Mar → 30 Apr …) instead of drifting to the 28th forever after the first
  // short month. A mid-month day just clamps to the next month's length.
  const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
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
  if ('amount' in b) {
    const amtErr = positiveAmountError(b.amount, 'amount')
    if (amtErr) return res.status(400).json({ error: amtErr })
  }
  if ('nextDueDate' in b) {
    const dateErr = isoDateError(b.nextDueDate, 'nextDueDate') ?? farPastDueError(b.nextDueDate)
    if (dateErr) return res.status(400).json({ error: dateErr })
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
  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const amtErr = positiveAmountError(b.targetAmount, 'targetAmount')
  if (amtErr) return res.status(400).json({ error: amtErr })
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
  if ('targetAmount' in b) {
    const amtErr = positiveAmountError(b.targetAmount, 'targetAmount')
    if (amtErr) return res.status(400).json({ error: amtErr })
  }
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
