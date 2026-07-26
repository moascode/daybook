import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import {
  normalizeBind,
  ownedIdSet,
  ownsAllRefs,
  splitEqually,
  todayStr,
  updateRow,
  updateRowStmt,
} from '../lib.ts'
import {
  canWriteAccount,
  coGroupUserIds,
  isGroupMember,
  visibleAccountIds,
  writableAccountIds,
} from '../lib/sharing.ts'

// Port of server/routes/wallet.ts. Being the largest route module by far
// (1,461 lines, 68 .prepare() sites), it lands in increments:
//
//   Part A (this)  accounts, account shares, categories, tags
//   Part B         transactions — list/export/import/CRUD/link-transfer/splits
//   Part C         budgets, recurring transactions, goals
//
// Split by concern rather than by line count: Part A has no db.transaction()
// sites at all, so it is a pure mechanical port and a safe place to prove the
// account-visibility helpers behave the same on D1.
export const wallet = new Hono<AppEnv>()

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
    const n =
      typeof b.openingBalance === 'number' || typeof b.openingBalance === 'string'
        ? Number(b.openingBalance)
        : NaN
    if (!Number.isFinite(n)) return 'openingBalance must be a number'
  }
  return null
}

/** Body reader shared by every write route here. */
const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

wallet.get('/accounts', async (c) => {
  const userId = c.get('userId')

  const own = await c.env.DB.prepare(
    `SELECT *, 0 AS is_shared, NULL AS shared_by_user_id, NULL AS shared_by_username
     FROM accounts WHERE user_id = ? ORDER BY created_at ASC`,
  )
    .bind(userId)
    .all()

  // Shared-in accounts (visible via a group the user belongs to).
  const shared = await c.env.DB.prepare(
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
    .bind(userId, userId)
    .all()

  return c.json([...own.results, ...shared.results])
})

wallet.post('/accounts', async (c) => {
  const b = await body(c)
  const err = accountInputError(b, false)
  if (err) return c.json({ error: err }, 400)

  const row = await c.env.DB.prepare(
    `INSERT INTO accounts
       (id, user_id, name, description, currency, type, color, icon, opening_balance, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     RETURNING *`,
  )
    // userId, name, description, currency, type, color, icon, openingBalance
    .bind(
      c.get('userId'),
      b.name,
      b.description ?? '',
      b.currency ?? 'MYR',
      b.type ?? 'cash',
      b.color ?? '#1D9E75',
      b.icon ?? 'wallet',
      normalizeBind(b.openingBalance ?? 0),
    )
    .first()

  return c.json(row, 201)
})

wallet.patch('/accounts/:id', async (c) => {
  const b = await body(c)
  const err = accountInputError(b, true)
  if (err) return c.json({ error: err }, 400)

  // accounts has no updated_at column.
  const row = await updateRow(
    c.env.DB,
    'accounts',
    c.req.param('id'),
    c.get('userId'),
    ACCOUNT_COLS,
    b,
    { touchUpdatedAt: false },
  )
  if (!row) return c.json({ error: 'account not found' }, 404)
  return c.json(row)
})

wallet.delete('/accounts/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const acct = await c.env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  if (!acct) return c.body(null, 204) // idempotent: nothing owned to delete

  // B-05: deleting an account cascades its transactions (and their splits) away.
  // Don't let that silently erase live household debts or other members' history.
  const outstandingSplit = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM transaction_splits ts
     JOIN transactions t ON t.id = ts.transaction_id
     WHERE t.account_id = ? AND ts.settled_at IS NULL AND ts.user_id != t.user_id
     LIMIT 1`,
  )
    .bind(id)
    .first()
  if (outstandingSplit) {
    return c.json(
      { error: 'settle the outstanding splits on this account before deleting it' },
      409,
    )
  }

  const othersTxn = await c.env.DB.prepare(
    'SELECT 1 AS ok FROM transactions WHERE account_id = ? AND user_id != ? LIMIT 1',
  )
    .bind(id, userId)
    .first()
  if (othersTxn) {
    return c.json(
      { error: 'this shared account has transactions from other members; unshare it first' },
      409,
    )
  }

  await c.env.DB.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  return c.body(null, 204)
})

// C1: All visible account balances in one query. The per-account math below
// (`/:id/balance`) is the reference — the CASE arms here must stay equivalent:
// balance = opening balance + income − expense − transfers out + transfers in.
//
// Registered before `/accounts/:id/balance`; the two do not collide (2 segments
// vs 3) but keeping the original order avoids relying on that.
wallet.get('/accounts/balances', async (c) => {
  const visible = await visibleAccountIds(c.env.DB, c.get('userId'))
  if (visible.length === 0) return c.json([])

  const placeholders = visible.map(() => '?').join(', ')
  const { results } = await c.env.DB.prepare(
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
    .bind(...visible)
    .all()

  return c.json(results)
})

// Balance = opening balance + income − expense − transfers out + transfers in.
// Kept for per-card fetches (AccountCard) — see the batched route above.
wallet.get('/accounts/:id/balance', async (c) => {
  const id = c.req.param('id')

  // Allow both own accounts and shared-in accounts.
  const visible = await visibleAccountIds(c.env.DB, c.get('userId'))
  if (!visible.includes(id)) return c.json({ error: 'account not found' }, 404)

  const acct = await c.env.DB.prepare('SELECT opening_balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ opening_balance: number }>()
  if (!acct) return c.json({ error: 'account not found' }, 404)

  // The server ran four separate queries through a helper bound with a named
  // @id. One query with four conditional sums replaces them: same arithmetic,
  // one round trip instead of four — which matters more on D1 than it did
  // in-process.
  //
  // `id` is bound six times rather than reusing `?1`, matching the decision in
  // lib/sharing.ts: the numbered-parameter form is not exercised anywhere in
  // this codebase, and this query decides an account balance.
  const totals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN account_id = ? AND type = 'income'   THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN account_id = ? AND type = 'expense'  THEN amount END), 0) AS expense,
       COALESCE(SUM(CASE WHEN account_id = ? AND type = 'transfer' THEN amount END), 0) AS transfer_out,
       COALESCE(SUM(CASE WHEN destination_account_id = ? AND type = 'transfer' THEN amount END), 0) AS transfer_in
     FROM transactions
     WHERE account_id = ? OR destination_account_id = ?`,
  )
    .bind(id, id, id, id, id, id)
    .first<{ income: number; expense: number; transfer_out: number; transfer_in: number }>()

  const opening = acct.opening_balance ?? 0
  return c.json({
    balance:
      opening +
      (totals?.income ?? 0) -
      (totals?.expense ?? 0) -
      (totals?.transfer_out ?? 0) +
      (totals?.transfer_in ?? 0),
  })
})

// ── Account shares ────────────────────────────────────

/** Every share route is owner-only: shares are granted by the account's owner. */
async function ownedAccount(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  return !!row
}

wallet.get('/accounts/:id/shares', async (c) => {
  const id = c.req.param('id')
  if (!(await ownedAccount(c.env.DB, id, c.get('userId')))) {
    return c.json({ error: 'account not found' }, 404)
  }
  const { results } = await c.env.DB.prepare(
    `SELECT acs.account_id, acs.group_id, acs.can_write, acs.shared_at, g.name AS group_name
     FROM account_shares acs
     JOIN groups g ON g.id = acs.group_id
     WHERE acs.account_id = ?`,
  )
    .bind(id)
    .all()
  return c.json(results)
})

wallet.post('/accounts/:id/shares', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!(await ownedAccount(c.env.DB, id, userId))) {
    return c.json({ error: 'account not found' }, 404)
  }

  const b = await body(c)
  const groupId = b.groupId
  if (!groupId) return c.json({ error: 'groupId is required' }, 400)

  if (!(await isGroupMember(c.env.DB, userId, String(groupId)))) {
    return c.json({ error: 'you must be a member of the group' }, 403)
  }

  const row = await c.env.DB.prepare(
    `INSERT OR REPLACE INTO account_shares (account_id, group_id, can_write, shared_at)
     VALUES (?, ?, ?, datetime('now'))
     RETURNING *`,
  )
    .bind(id, groupId, b.canWrite ? 1 : 0)
    .first()
  return c.json(row, 201)
})

wallet.patch('/accounts/:id/shares/:groupId', async (c) => {
  const id = c.req.param('id')
  if (!(await ownedAccount(c.env.DB, id, c.get('userId')))) {
    return c.json({ error: 'account not found' }, 404)
  }
  const b = await body(c)
  const row = await c.env.DB.prepare(
    'UPDATE account_shares SET can_write = ? WHERE account_id = ? AND group_id = ? RETURNING *',
  )
    .bind(b.canWrite ? 1 : 0, id, c.req.param('groupId'))
    .first()
  if (!row) return c.json({ error: 'share not found' }, 404)
  return c.json(row)
})

wallet.delete('/accounts/:id/shares/:groupId', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const groupId = c.req.param('groupId')

  if (!(await ownedAccount(c.env.DB, id, userId))) {
    return c.json({ error: 'account not found' }, 404)
  }
  // C-10: verify the caller is a member of the group being unshared from.
  if (!(await isGroupMember(c.env.DB, userId, groupId))) {
    return c.json({ error: 'you are not a member of this group' }, 403)
  }

  await c.env.DB.prepare('DELETE FROM account_shares WHERE account_id = ? AND group_id = ?')
    .bind(id, groupId)
    .run()
  return c.body(null, 204)
})

// ── Categories ────────────────────────────────────────

wallet.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

wallet.post('/categories', async (c) => {
  const b = await body(c)
  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  const validTypes = new Set(['income', 'expense', 'both'])
  if (typeof b.type !== 'string' || !validTypes.has(b.type)) {
    return c.json({ error: 'type must be income, expense, or both' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO categories (id, user_id, name, icon, color, type)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    // userId, name, icon, color, type
    .bind(c.get('userId'), b.name.trim(), b.icon ?? 'tag', b.color ?? '#378ADD', b.type)
    .first()
  return c.json(row, 201)
})

wallet.get('/categories/:id/usage', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM transactions WHERE category_id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), c.get('userId'))
    .first<{ cnt: number }>()
  return c.json({ count: row?.cnt ?? 0 })
})

wallet.delete('/categories/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  if (!cat) return c.json({ error: 'category not found' }, 404)

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  return c.body(null, 204)
})

// ── Tags ──────────────────────────────────────────────

wallet.get('/tags', async (c) => {
  // `tag` holds a JSON array despite the singular column name (see CLAUDE.md §6).
  // json_each() throws on a non-array, hence the json_valid/json_type guards —
  // migrations 0002/0003 normalised the legacy rows that used to break this.
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT je.value AS tag
     FROM transactions t, json_each(t.tag) je
     WHERE t.user_id = ? AND json_valid(t.tag) AND json_type(t.tag) = 'array' AND t.tag != '[]'
     ORDER BY je.value`,
  )
    .bind(c.get('userId'))
    .all<{ tag: string }>()
  return c.json(results.map((r) => r.tag))
})

// ── Shared transaction helpers ───────────────────────
// insertTransaction is used by the recurring-rule routes below and by the
// transaction routes in Part B.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Non-empty string from a query param, else undefined. */
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

/**
 * Build the INSERT for a transaction. Returns a prepared statement rather than
 * executing it, so callers can either run it directly or fold it into a
 * batch() — the recurring processor below needs the latter.
 */
function insertTransactionStmt(
  db: D1Database,
  b: Record<string, unknown>,
  userId: string,
) {
  return db
    .prepare(
      `INSERT INTO transactions
         (id, user_id, account_id, destination_account_id, date, merchant, description,
          amount, type, category_id, tag, import_hash, created_at, updated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    // userId, accountId, destinationAccountId, date, merchant, description,
    // amount, type, categoryId, tag, importHash
    .bind(
      userId,
      b.accountId,
      b.destinationAccountId ?? null,
      b.date,
      b.merchant ?? '',
      b.description ?? '',
      normalizeBind(b.amount),
      b.type,
      b.categoryId ?? null,
      Array.isArray(b.tag) ? JSON.stringify(b.tag) : (b.tag ?? '[]'),
      b.importHash ?? '',
    )
}


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
    const amt =
      typeof b.amount === 'number' || typeof b.amount === 'string' ? Number(b.amount) : NaN
    if (!Number.isFinite(amt) || amt <= 0) return 'amount must be a positive number'
  }
  if (!partial || has('date')) {
    if (
      typeof b.date !== 'string' ||
      !ISO_DATE_RE.test(b.date) ||
      Number.isNaN(Date.parse(b.date))
    ) {
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
  const dest = has('destinationAccountId')
    ? b.destinationAccountId
    : opts.existing?.destination_account_id
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

/**
 * view scoping ('mine' | 'shared-with-me' | 'shared-with-others' | 'all'),
 * shared by GET /transactions and GET /transactions/export so the exported rows
 * always match the on-screen selection (§1.2).
 *
 * The server built a named-parameter object here. D1 is positional, so this
 * **pushes its binds onto `binds` in exactly the order its placeholders appear
 * in the returned SQL** — and every caller must keep appending conditions and
 * binds in lockstep after it. Getting that order wrong silently filters by the
 * wrong value rather than erroring, which is why the filter builders below
 * always push the two together.
 */
async function viewCondition(
  db: D1Database,
  userId: string,
  view: string,
  alias: string,
  binds: unknown[],
): Promise<string> {
  if (view === 'mine') {
    binds.push(userId)
    return `${alias}.user_id = ?`
  }
  if (view === 'shared-with-me') {
    // Transactions created by others where I have a split line.
    binds.push(userId, userId)
    return `${alias}.user_id != ? AND EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = ${alias}.id AND ts.user_id = ?)`
  }
  if (view === 'shared-with-others') {
    // My transactions that have been shared with others.
    binds.push(userId, userId)
    return `${alias}.user_id = ? AND EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = ${alias}.id AND ts.user_id != ?)`
  }
  // All visible: own transactions + transactions on shared accounts.
  const visible = await visibleAccountIds(db, userId)
  if (visible.length === 0) {
    binds.push(userId)
    return `${alias}.user_id = ?`
  }
  const placeholders = visible.map(() => '?').join(', ')
  binds.push(userId, ...visible, ...visible)
  return `(${alias}.user_id = ? OR ${alias}.account_id IN (${placeholders}) OR ${alias}.destination_account_id IN (${placeholders}))`
}

/** Tag values from a repeatable `tags` query param. */
function tagsFrom(c: { req: { queries: (k: string) => string[] | undefined } }): string[] {
  return (c.req.queries('tags') ?? []).filter((t) => typeof t === 'string' && t.length > 0)
}

/**
 * Shared filter builder for the list and export routes. Appends to `conditions`
 * and `binds` together so their order can never drift apart.
 */
function applyFilters(
  c: { req: { query: (k: string) => string | undefined; queries: (k: string) => string[] | undefined } },
  alias: string,
  conditions: string[],
  binds: unknown[],
): void {
  const col = (name: string) => (alias ? `${alias}.${name}` : name)

  const dateFrom = str(c.req.query('dateFrom'))
  if (dateFrom) { conditions.push(`${col('date')} >= ?`); binds.push(dateFrom) }

  const dateTo = str(c.req.query('dateTo'))
  if (dateTo) { conditions.push(`${col('date')} <= ?`); binds.push(dateTo) }

  const type = str(c.req.query('type'))
  if (type && type !== 'all') { conditions.push(`${col('type')} = ?`); binds.push(type) }

  const categoryId = str(c.req.query('categoryId'))
  if (categoryId) { conditions.push(`${col('category_id')} = ?`); binds.push(categoryId) }

  const accountId = str(c.req.query('accountId'))
  if (accountId) {
    conditions.push(`(${col('account_id')} = ? OR ${col('destination_account_id')} = ?)`)
    binds.push(accountId, accountId)
  }

  // B1: free-text search on merchant/description.
  const q = str(c.req.query('q'))
  if (q) {
    conditions.push(`(${col('merchant')} LIKE ? OR ${col('description')} LIKE ?)`)
    binds.push(`%${q}%`, `%${q}%`)
  }

  // Multiple tags use OR logic: a transaction matching ANY selected tag is
  // returned. The CASE guard keeps json_each away from invalid/empty JSON —
  // rows with tag='' or a non-array value would otherwise raise a SQLite
  // runtime error (the reason migrations 0002/0003 exist).
  const tags = tagsFrom(c)
  if (tags.length > 0) {
    const tagCol = col('tag')
    const safeTag = `CASE WHEN json_valid(${tagCol}) AND json_type(${tagCol})='array' THEN ${tagCol} ELSE '[]' END`
    const clauses = tags.map(() => `EXISTS (SELECT 1 FROM json_each(${safeTag}) WHERE value = ?)`)
    conditions.push(`(${clauses.join(' OR ')})`)
    binds.push(...tags)
  }
}

wallet.get('/transactions', async (c) => {
  const userId = c.get('userId')
  const view = str(c.req.query('view')) ?? 'all'

  const binds: unknown[] = []
  const conditions: string[] = [
    await viewCondition(c.env.DB, userId, view, 'transactions', binds),
  ]
  applyFilters(c, 'transactions', conditions, binds)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { results } = await c.env.DB.prepare(
    `SELECT transactions.*,
       CASE WHEN EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = transactions.id)
            THEN 1 ELSE 0 END AS has_splits
     FROM transactions ${where} ORDER BY date DESC, created_at DESC`,
  )
    .bind(...binds)
    .all()

  return c.json(results)
})

// Joined rows for export. Accepts the same filter params as GET /transactions
// so the export respects the user's active filters.
wallet.get('/transactions/export', async (c) => {
  const userId = c.get('userId')
  // §1.2: same view scoping as GET /transactions — the list view ("all") also
  // shows other members' transactions on shared-in accounts, so a hard
  // user_id-only scope silently dropped selected rows from the export.
  const view = str(c.req.query('view')) ?? 'all'

  const binds: unknown[] = []
  const conditions: string[] = [await viewCondition(c.env.DB, userId, view, 't', binds)]
  applyFilters(c, 't', conditions, binds)

  // If the caller passes specific IDs, restrict to those (comma-separated).
  const ids = str(c.req.query('ids'))
  if (ids) {
    const idList = ids.split(',').filter(Boolean)
    if (idList.length > 0) {
      conditions.push(`t.id IN (${idList.map(() => '?').join(', ')})`)
      binds.push(...idList)
    }
  }

  const { results } = await c.env.DB.prepare(
    `SELECT t.date, t.merchant, t.description, t.amount, t.type,
            c.name AS category_name, a.name AS account_name, t.tag
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.date DESC, t.created_at DESC`,
  )
    .bind(...binds)
    .all()

  return c.json(results)
})

// Returns the subset of the given hashes that already exist for this user.
// Batched to stay well under SQLite's bound-parameter limit on large imports.
// A hash counts as a duplicate if it is on a live transaction OR was absorbed
// into a merged transfer (absorbed_import_hashes) — otherwise re-importing a
// statement would re-create the leg that link-as-transfer deleted.
wallet.post('/transactions/check-duplicates', async (c) => {
  const b = await body(c)
  const hashes: string[] = Array.isArray(b.hashes) ? b.hashes : []
  if (hashes.length === 0) return c.json([])

  const userId = c.get('userId')
  const found = new Set<string>()
  const BATCH = 500

  // The chunks are independent, so they go out as one batch() rather than
  // sequential awaits — N/500 round trips become one.
  const stmts = []
  for (let i = 0; i < hashes.length; i += BATCH) {
    const chunk = hashes.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '?').join(', ')
    stmts.push(
      c.env.DB
        .prepare(
          `SELECT import_hash AS hash FROM transactions WHERE user_id = ? AND import_hash IN (${placeholders})
           UNION
           SELECT hash FROM absorbed_import_hashes WHERE user_id = ? AND hash IN (${placeholders})`,
        )
        .bind(userId, ...chunk, userId, ...chunk),
    )
  }

  const results = await c.env.DB.batch<{ hash: string }>(stmts)
  for (const r of results) for (const row of r.results) found.add(row.hash)

  return c.json([...found])
})

// Bulk insert (CSV import). Returns the created rows.
wallet.post('/transactions/import', async (c) => {
  const parsed = await c.req.json().catch(() => [])
  const items: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : []
  const userId = c.get('userId')

  for (let i = 0; i < items.length; i++) {
    const err = transactionInputError(items[i])
    if (err) return c.json({ error: `row ${i + 1}: ${err}` }, 400)
  }

  // ── The S2 N+1 fix ──────────────────────────────────
  //
  // The server checks canWriteAccount() and ownsAllRefs() **per row**
  // (server/routes/wallet.ts:583-595). Each is 1-2 queries, so a 500-row import
  // issues 1,000-1,500 of them. In-process under better-sqlite3 that is free;
  // on D1 every one is a network round trip, and the import would time out long
  // before it finished. See docs/option-2-spike-findings.md §S2.
  //
  // Both permission sets are bounded by the user's own accounts and categories,
  // not by the import size — so they are read ONCE and checked in memory.
  const [writable, ownedCategories] = await Promise.all([
    writableAccountIds(c.env.DB, userId),
    ownedIdSet(c.env.DB, 'categories', userId),
  ])

  // Match manual add (POST /transactions): importing into a writable shared-in
  // account is allowed, not just own accounts. Category must still be owned and
  // any transfer destination must be writable (B-07) — per-user scoping is
  // preserved exactly; only the number of queries changes.
  for (let i = 0; i < items.length; i++) {
    const b = items[i]
    const accountId = String(b.accountId ?? '')
    if (!accountId || !writable.has(accountId)) {
      return c.json({ error: `row ${i + 1}: no write permission on this account` }, 403)
    }
    if (b.categoryId != null && !ownedCategories.has(String(b.categoryId))) {
      return c.json({ error: `row ${i + 1}: invalid category reference` }, 400)
    }
    if (b.destinationAccountId && !writable.has(String(b.destinationAccountId))) {
      return c.json({ error: `row ${i + 1}: no write permission on the destination account` }, 400)
    }
  }

  if (items.length === 0) return c.json([], 201)

  // S2 measured 5,000 rows in a single batch with ~10x headroom, and a real
  // statement is 50-500 rows — so one batch is enough.
  const results = await c.env.DB.batch(
    items.map((b) => insertTransactionStmt(c.env.DB, b, userId)),
  )
  return c.json(results.flatMap((r) => r.results), 201)
})

wallet.post('/transactions', async (c) => {
  const b = await body(c)
  const userId = c.get('userId')

  const inputErr = transactionInputError(b)
  if (inputErr) return c.json({ error: inputErr }, 400)

  // Allow writing to shared accounts with can_write permission.
  const accountId = String(b.accountId ?? '')
  if (accountId && !(await canWriteAccount(c.env.DB, userId, accountId))) {
    return c.json({ error: 'no write permission on this account' }, 403)
  }
  if (!(await ownsAllRefs(c.env.DB, userId, [['categories', b.categoryId]]))) {
    return c.json({ error: 'invalid category reference' }, 400)
  }
  // B-07: a transfer moves money INTO the destination, so it needs write
  // permission there — a read-only shared-in account must not be a target.
  if (
    b.destinationAccountId &&
    !(await canWriteAccount(c.env.DB, userId, String(b.destinationAccountId)))
  ) {
    return c.json({ error: 'no write permission on the destination account' }, 400)
  }

  // When posting to a shared account, the transaction user_id is the caller.
  const row = await insertTransactionStmt(c.env.DB, b, userId).first()
  return c.json(row, 201)
})

wallet.patch('/transactions/:id', async (c) => {
  const b = await body(c)
  const userId = c.get('userId')
  const id = c.req.param('id')

  // Caller must own the transaction or have write permission on its account.
  const existing = await c.env.DB.prepare(
    'SELECT user_id, account_id, type, destination_account_id, amount FROM transactions WHERE id = ?',
  )
    .bind(id)
    .first<{
      user_id: string
      account_id: string
      type: string
      destination_account_id: string | null
      amount: number
    }>()
  if (!existing) return c.json({ error: 'transaction not found' }, 404)

  const canEdit =
    existing.user_id === userId || (await canWriteAccount(c.env.DB, userId, existing.account_id))
  if (!canEdit) return c.json({ error: 'no permission to edit this transaction' }, 403)

  const inputErr = transactionInputError(b, { partial: true, existing })
  if (inputErr) return c.json({ error: inputErr }, 400)

  // B-03: a moved transaction must land on an account the caller can write —
  // otherwise a member could re-point their transaction at anyone's account
  // (draining that balance), since the edit check only covered the OLD account.
  if ('accountId' in b && String(b.accountId) !== existing.account_id) {
    if (!(await canWriteAccount(c.env.DB, userId, String(b.accountId)))) {
      return c.json({ error: 'no write permission on the destination account' }, 403)
    }
  }
  if (
    'destinationAccountId' in b &&
    b.destinationAccountId &&
    String(b.destinationAccountId) !== (existing.destination_account_id ?? '')
  ) {
    if (!(await canWriteAccount(c.env.DB, userId, String(b.destinationAccountId)))) {
      return c.json({ error: 'no write permission on the destination account' }, 400)
    }
  }

  const refs: Array<[string, unknown]> = []
  if ('categoryId' in b) refs.push(['categories', b.categoryId])
  if (!(await ownsAllRefs(c.env.DB, userId, refs))) {
    return c.json({ error: 'invalid category reference' }, 400)
  }

  // If the amount changed and splits exist, rescale the shares proportionally.
  // The rescale statements are collected rather than executed, so they commit in
  // the SAME batch as the transaction update below — the server relied on
  // db.transaction() for that, and a split set that no longer sums to the
  // transaction amount is a corrupt ledger.
  const extraWrites: D1PreparedStatement[] = []

  if ('amount' in b && b.amount !== undefined && existing.amount !== b.amount) {
    const { results: shareRows } = await c.env.DB.prepare(
      'SELECT id, share_amount FROM transaction_splits WHERE transaction_id = ? ORDER BY created_at ASC',
    )
      .bind(id)
      .all<{ id: string; share_amount: number }>()

    if (shareRows.length > 0) {
      // B-06: never rewrite a settled/partially-paid split — the recorded
      // settlement would no longer match the share it cleared.
      if (await hasSettledShare(c.env.DB, id)) {
        return c.json(
          {
            error:
              'cannot change the amount of a transaction with settled splits; undo the settlement first',
          },
          409,
        )
      }
      const newAmount = Number(b.amount)
      // B-06: reject an amount too small to keep every split positive.
      if (newAmount < shareRows.length * 0.01) {
        return c.json({ error: 'amount is too small to keep every split positive' }, 400)
      }

      let allocated = 0
      const scaled: Array<{ id: string; amount: number }> = []
      for (let i = 0; i < shareRows.length; i++) {
        const row = shareRows[i]
        if (i === shareRows.length - 1) {
          scaled.push({ id: row.id, amount: Math.round((newAmount - allocated) * 100) / 100 })
        } else {
          const v = Math.max(
            0.01,
            Math.round((row.share_amount / existing.amount) * newAmount * 100) / 100,
          )
          scaled.push({ id: row.id, amount: v })
          allocated += v
        }
      }
      // If rounding/clamping pushed the remainder non-positive, reject rather
      // than write a zero/negative share.
      if (scaled.some((s) => s.amount <= 0)) {
        return c.json({ error: 'amount is too small to keep every split positive' }, 400)
      }
      for (const s of scaled) {
        extraWrites.push(
          c.env.DB
            .prepare('UPDATE transaction_splits SET share_amount = ? WHERE id = ?')
            .bind(s.amount, s.id),
        )
      }
    }
  }

  // updateRow is scoped by the ORIGINAL owner's user_id, so a co-member editing
  // a shared-account transaction updates the right row without taking ownership.
  if (extraWrites.length === 0) {
    const row = await updateRow(c.env.DB, 'transactions', id, existing.user_id, TRANSACTION_COLS, b)
    if (!row) return c.json({ error: 'transaction not found' }, 404)
    return c.json(row)
  }

  const upd = updateRowStmt(c.env.DB, 'transactions', id, existing.user_id, TRANSACTION_COLS, b)
  await c.env.DB.batch([...extraWrites, upd])
  const row = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, existing.user_id)
    .first()
  if (!row) return c.json({ error: 'transaction not found' }, 404)
  return c.json(row)
})

wallet.delete('/transactions/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT user_id, account_id FROM transactions WHERE id = ?',
  )
    .bind(id)
    .first<{ user_id: string; account_id: string }>()
  if (!existing) return c.body(null, 204)

  const canDel =
    existing.user_id === userId || (await canWriteAccount(c.env.DB, userId, existing.account_id))
  if (!canDel) return c.json({ error: 'no permission to delete this transaction' }, 403)

  await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run()
  return c.body(null, 204)
})

/** True when any split on this transaction is settled or partially paid. */
async function hasSettledShare(db: D1Database, transactionId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM transaction_splits
       WHERE transaction_id = ? AND (settled_at IS NOT NULL OR settled_amount > 0)
       LIMIT 1`,
    )
    .bind(transactionId)
    .first()
  return !!row
}


// ── Link as transfer ──────────────────────────────────
// Item 2 of docs/csv-transfer-linking-plan.md: merge two existing rows — the
// two legs of one inter-account movement, typically imported from two bank
// statements — into a single transfer. The money-out (expense) row survives and
// becomes the transfer; the money-in (income) row is deleted after its
// import_hash is preserved in absorbed_import_hashes so re-imports still dedup.
// v1 deliberately rejects unequal amounts (fee/FX legs) rather than guessing how
// to book the difference.

interface LinkRow {
  id: string
  user_id: string
  account_id: string
  type: string
  amount: number
  import_hash: string
}

wallet.post('/transactions/:id/link-transfer', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const b = await body(c)
  const twinId = String(b.twinId ?? '')

  if (!twinId) return c.json({ error: 'twinId is required' }, 400)
  if (twinId === id) return c.json({ error: 'cannot link a transaction to itself' }, 400)

  // Both legs in one query rather than two sequential reads.
  const { results: rows } = await c.env.DB.prepare(
    'SELECT id, user_id, account_id, type, amount, import_hash FROM transactions WHERE id IN (?, ?)',
  )
    .bind(id, twinId)
    .all<LinkRow>()

  const first = rows.find((r) => r.id === id)
  const second = rows.find((r) => r.id === twinId)
  if (!first || !second) return c.json({ error: 'transaction not found' }, 404)

  // The merge rewrites one account's ledger and deletes a row from the other,
  // so the caller needs write permission on BOTH accounts.
  for (const r of [first, second]) {
    if (!(await canWriteAccount(c.env.DB, userId, r.account_id))) {
      return c.json({ error: 'no write permission on both accounts' }, 403)
    }
  }

  if (first.type === 'transfer' || second.type === 'transfer') {
    return c.json({ error: 'one of the transactions is already a transfer' }, 400)
  }
  if (first.account_id === second.account_id) {
    return c.json(
      { error: 'both transactions are on the same account — a transfer needs two accounts' },
      400,
    )
  }
  if (first.type === second.type) {
    return c.json(
      { error: 'the two legs must be one money-out (expense) and one money-in (income)' },
      400,
    )
  }
  if (Math.abs(first.amount - second.amount) > 0.01) {
    return c.json(
      { error: 'amounts differ — only equal-amount legs can be linked as one transfer' },
      400,
    )
  }

  const hasSplits = await c.env.DB.prepare(
    'SELECT 1 AS ok FROM transaction_splits WHERE transaction_id IN (?, ?) LIMIT 1',
  )
    .bind(first.id, second.id)
    .first()
  if (hasSplits) {
    return c.json({ error: 'a split transaction cannot be linked as a transfer' }, 409)
  }

  const inSettlement = await c.env.DB.prepare(
    'SELECT 1 AS ok FROM settlements WHERE from_transaction_id IN (?, ?) OR to_transaction_id IN (?, ?) LIMIT 1',
  )
    .bind(first.id, second.id, first.id, second.id)
    .first()
  if (inSettlement) {
    return c.json({ error: 'a settlement transaction cannot be linked as a transfer' }, 409)
  }

  const moneyOut = first.type === 'expense' ? first : second
  const moneyIn = first.type === 'expense' ? second : first

  // All validation is above, so the writes are a straight batch() conversion of
  // the server's db.transaction(). They must stay atomic: converting the
  // surviving leg without deleting the absorbed one double-counts the movement,
  // and deleting without preserving the hash lets a statement re-import
  // resurrect the leg the merge just removed.
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE transactions
            SET type = 'transfer', destination_account_id = ?,
                category_id = NULL, tag = '[]', updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(moneyIn.account_id, moneyOut.id),
    // Remember the absorbed leg's hash under ITS owner — that is the user whose
    // re-import of the statement must still see it as a duplicate.
    ...(moneyIn.import_hash
      ? [
          c.env.DB
            .prepare(
              'INSERT OR REPLACE INTO absorbed_import_hashes (user_id, hash, transaction_id) VALUES (?, ?, ?)',
            )
            .bind(moneyIn.user_id, moneyIn.import_hash, moneyOut.id),
        ]
      : []),
    c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(moneyIn.id),
  ])

  const row = await c.env.DB.prepare(
    'SELECT transactions.*, 0 AS has_splits FROM transactions WHERE id = ?',
  )
    .bind(moneyOut.id)
    .first()
  return c.json(row)
})

// ── Transaction splits ────────────────────────────────

wallet.get('/transactions/:id/splits', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const txn = await c.env.DB.prepare('SELECT user_id FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ user_id: string }>()
  if (!txn) return c.json({ error: 'transaction not found' }, 404)

  // Caller must be the owner or hold a share line.
  if (txn.user_id !== userId) {
    const mine = await c.env.DB.prepare(
      'SELECT 1 AS ok FROM transaction_splits WHERE transaction_id = ? AND user_id = ?',
    )
      .bind(id, userId)
      .first()
    if (!mine) {
      return c.json({ error: 'not authorised to view shares for this transaction' }, 403)
    }
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ts.id, ts.transaction_id, ts.user_id, ts.share_amount, ts.note, ts.settled_at,
            ts.created_at, u.username
     FROM transaction_splits ts
     JOIN users u ON u.id = ts.user_id
     WHERE ts.transaction_id = ?
     ORDER BY ts.share_amount DESC`,
  )
    .bind(id)
    .all()
  return c.json(results)
})

/** INSERT for one split row. */
const splitInsert = (db: D1Database, txnId: string, userId: string, amount: number, note: string) =>
  db
    .prepare(
      `INSERT INTO transaction_splits (id, transaction_id, user_id, share_amount, note, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    .bind(txnId, userId, amount, note)

// Quick single-transaction split — split with one recipient (full amount or split).
wallet.post('/transactions/:id/split', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const b = await body(c)
  const recipientId = b.recipientId
  const splitMode = b.splitMode
  const shareAmounts = b.shareAmounts

  // 1. Transaction exists and the caller owns it.
  const txn = await c.env.DB.prepare('SELECT id, user_id, amount FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ id: string; user_id: string; amount: number }>()
  if (!txn) return c.json({ error: 'transaction not found' }, 404)
  if (txn.user_id !== userId) {
    return c.json({ error: 'only the transaction owner can share' }, 403)
  }

  // B-04: re-splitting replaces every share row, which would erase settlement
  // history and resurrect an already-paid debt. Block it while any share on this
  // transaction has been settled or partially paid.
  if (await hasSettledShare(c.env.DB, id)) {
    return c.json(
      { error: 'this split has been (partly) settled; undo the settlement before changing it' },
      409,
    )
  }

  // 2. Recipient must be a co-group member.
  const allowed = new Set(await coGroupUserIds(c.env.DB, txn.user_id))
  if (!allowed.has(String(recipientId))) {
    return c.json({ error: 'recipient is not a group co-member' }, 400)
  }

  // 3. splitMode.
  const validModes = ['none', 'equal', 'custom']
  if (typeof splitMode !== 'string' || !validModes.includes(splitMode)) {
    return c.json({ error: 'splitMode must be "none", "equal", or "custom"' }, 400)
  }

  // 4. Share amounts per mode.
  // No initialiser: every branch below assigns, and eslint's no-useless-assignment
  // flags a dead `= []` that TypeScript's control-flow analysis already proves
  // unnecessary.
  let shares: Array<{ userId: string; shareAmount: number; note: string }>

  if (splitMode === 'none') {
    // Recipient owes 100% of the amount — no payer row (see CLAUDE.md §6).
    shares = [{ userId: String(recipientId), shareAmount: txn.amount, note: '' }]
  } else if (splitMode === 'equal') {
    const [ownerShare, recipientShare] = splitEqually(txn.amount, 2)
    shares = [
      { userId, shareAmount: ownerShare, note: '' },
      { userId: String(recipientId), shareAmount: recipientShare, note: '' },
    ]
  } else {
    if (!Array.isArray(shareAmounts) || shareAmounts.length !== 2) {
      return c.json({ error: 'shareAmounts must be array of 2 amounts' }, 400)
    }
    for (const amt of shareAmounts) {
      if (!Number.isFinite(amt) || amt <= 0) {
        return c.json({ error: 'each share amount must be a positive finite number' }, 400)
      }
    }
    const sum = shareAmounts.reduce((acc: number, a: number) => acc + a, 0)
    if (Math.abs(sum - txn.amount) > 0.015) {
      return c.json({ error: `amounts must sum to ${txn.amount}; got ${sum}` }, 400)
    }
    shares = [
      { userId, shareAmount: shareAmounts[0], note: '' },
      { userId: String(recipientId), shareAmount: shareAmounts[1], note: '' },
    ]
  }

  // 5. Replace the share set atomically. The DELETE and the INSERTs must commit
  // together — a transaction left with its old shares deleted and the new ones
  // missing looks unsplit while the ledger still says otherwise.
  const results = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').bind(id),
    ...shares.map((s) => splitInsert(c.env.DB, id, s.userId, s.shareAmount, s.note)),
  ])

  return c.json(results.slice(1).flatMap((r) => r.results), 201)
})

// ── Bulk transaction splits ───────────────────────────
// POST /transactions/splits — split multiple transactions at once.
// Body: { transactions: Array<{ transactionId, shares: Array<{ userId, shareAmount, note? }> }> }
wallet.post('/transactions/splits', async (c) => {
  const userId = c.get('userId')
  const b = await body(c)

  type ShareEntry = { userId: string; shareAmount: number; note?: string }
  type TxnPayload = { transactionId: string; shares: ShareEntry[] }
  const transactions = b.transactions as TxnPayload[] | undefined

  // 1. Top-level shape check.
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return c.json({ error: 'transactions array is required and must be non-empty' }, 400)
  }
  // 2. Unbounded IN clause guard.
  if (transactions.length > 500) {
    return c.json({ error: 'cannot share more than 500 transactions at once' }, 400)
  }
  // 3. Per-element structural validation.
  for (const tx of transactions) {
    if (typeof tx.transactionId !== 'string' || tx.transactionId.length === 0) {
      return c.json({ error: 'each transactionId must be a non-empty string' }, 400)
    }
    if (!Array.isArray(tx.shares) || tx.shares.length === 0) {
      return c.json({ error: `shares array is required for transaction ${tx.transactionId}` }, 400)
    }
  }
  // 4. Share amount positivity.
  for (const tx of transactions) {
    for (const s of tx.shares) {
      const amt = Number(s.shareAmount)
      if (!Number.isFinite(amt) || amt <= 0) {
        return c.json({ error: 'each share amount must be a positive number' }, 400)
      }
    }
  }

  // 5. Fetch all transactions in one query.
  const transactionIds = transactions.map((tx) => tx.transactionId)
  const placeholders = transactionIds.map(() => '?').join(',')
  const { results: txnRows } = await c.env.DB.prepare(
    `SELECT id, user_id, amount, account_id FROM transactions WHERE id IN (${placeholders})`,
  )
    .bind(...transactionIds)
    .all<{ id: string; user_id: string; amount: number; account_id: string }>()
  const txnMap = new Map(txnRows.map((t) => [t.id, t]))

  if (txnMap.size !== transactionIds.length) {
    return c.json({ error: 'one or more transactions not found' }, 400)
  }

  // 6. Owner-only auth check — only the transaction owner may set bulk splits.
  for (const tx of transactions) {
    if (txnMap.get(tx.transactionId)!.user_id !== userId) {
      return c.json({ error: `only the owner can share transaction ${tx.transactionId}` }, 403)
    }
  }

  // 7. Co-group membership (S-3).
  //
  // The server calls coGroupUserIds() once **per transaction** inside this loop.
  // Step 6 has just proved every transaction is owned by the caller, so the set
  // is identical every time — one query instead of N, which on D1 is N network
  // round trips for a 500-transaction bulk share.
  const allowed = new Set(await coGroupUserIds(c.env.DB, userId))
  for (const tx of transactions) {
    for (const s of tx.shares) {
      if (!allowed.has(String(s.userId))) {
        return c.json(
          {
            error: `user ${s.userId} is not a group co-member with transaction ${tx.transactionId}'s owner`,
          },
          400,
        )
      }
    }
  }

  // 8. Sum validation BEFORE any write.
  for (const tx of transactions) {
    const txn = txnMap.get(tx.transactionId)!
    const sum = tx.shares.reduce((acc, s) => acc + Number(s.shareAmount), 0)
    if (Math.abs(sum - txn.amount) > 0.015) {
      return c.json(
        {
          error: `share amounts for transaction ${tx.transactionId} must sum to ${txn.amount}; got ${sum}`,
        },
        400,
      )
    }
  }

  // 8b. B-04: refuse to replace shares that have been (partly) settled.
  // The server calls hasSettledShare() per transaction — again one query each.
  // One set-based query answers it for the whole batch.
  const { results: settledRows } = await c.env.DB.prepare(
    `SELECT DISTINCT transaction_id FROM transaction_splits
      WHERE transaction_id IN (${placeholders})
        AND (settled_at IS NOT NULL OR settled_amount > 0)`,
  )
    .bind(...transactionIds)
    .all<{ transaction_id: string }>()
  const settled = new Set(settledRows.map((r) => r.transaction_id))
  for (const tx of transactions) {
    if (settled.has(tx.transactionId)) {
      return c.json(
        {
          error: `transaction ${tx.transactionId} has a settled split; undo the settlement before re-sharing`,
        },
        409,
      )
    }
  }

  // 9. One atomic batch: every DELETE and INSERT commits together, as
  // db.transaction() did. A partial apply would leave some transactions
  // re-split and others stripped of their shares.
  const writes = []
  for (const tx of transactions) {
    writes.push(
      c.env.DB.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').bind(
        tx.transactionId,
      ),
    )
    for (const s of tx.shares) {
      writes.push(
        splitInsert(c.env.DB, tx.transactionId, String(s.userId), Number(s.shareAmount), s.note ?? ''),
      )
    }
  }
  await c.env.DB.batch(writes)

  return c.json({ message: 'transactions shared successfully', transactionIds }, 201)
})

// Batch split status check — returns { transactionId, hasSplits } for each ID.
wallet.post('/transactions/splits/status', async (c) => {
  const userId = c.get('userId')
  const b = await body(c)
  const transactionIds = b.transactionIds as string[] | undefined

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) return c.json([])
  if (transactionIds.length > 500) {
    return c.json({ error: 'cannot check more than 500 transactions at once' }, 400)
  }

  const placeholders = transactionIds.map(() => '?').join(',')

  // Only return split status for transactions the caller owns.
  //
  // B-08: the second query deliberately does NOT filter by user_id — a
  // "Keep as-is" split writes only the recipient's row, so scoping by the
  // owner made the status report hasSplits:false while the transaction list
  // badged the same row as split. Owner scoping is enforced by ownedIds below.
  const [owned, shared] = await c.env.DB.batch<{ id: string } | { transaction_id: string }>([
    c.env.DB
      .prepare(`SELECT id FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`)
      .bind(...transactionIds, userId),
    c.env.DB
      .prepare(
        `SELECT DISTINCT transaction_id FROM transaction_splits WHERE transaction_id IN (${placeholders})`,
      )
      .bind(...transactionIds),
  ])

  const ownedIds = new Set((owned.results as { id: string }[]).map((r) => r.id))
  const sharedIds = new Set(
    (shared.results as { transaction_id: string }[]).map((r) => r.transaction_id),
  )

  return c.json(
    transactionIds
      .filter((id) => ownedIds.has(id))
      .map((id) => ({ transactionId: id, hasSplits: sharedIds.has(id) })),
  )
})

// ── Budgets ──────────────────────────────────────────

wallet.get('/budgets', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// B-15 residual: budgets must count only the caller's EFFECTIVE spend — when a
// transaction they own has been split, their own `share_amount` (0 if they have
// no share row), not the full transaction amount. Computed as one set-based
// aggregate (mirroring lib/sharing.ts effectiveAmount()) rather than a per-row
// loop over a month of transactions — which matters far more on D1, where a
// per-row loop is a per-row network round trip.
wallet.get('/budgets/spending', async (c) => {
  const userId = c.get('userId')
  const month = str(c.req.query('month')) ?? todayStr().slice(0, 7)
  if (!MONTH_RE.test(month)) {
    return c.json({ error: 'month must be in YYYY-MM format' }, 400)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT t.category_id AS categoryId,
            SUM(
              CASE
                WHEN EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)
                  THEN COALESCE(own.share_amount, 0)
                ELSE t.amount
              END
            ) AS spent
     FROM transactions t
     LEFT JOIN transaction_splits own
       ON own.transaction_id = t.id AND own.user_id = ?
     WHERE t.user_id = ?
       AND t.type = 'expense'
       AND t.category_id IS NOT NULL
       AND t.date LIKE ?
     GROUP BY t.category_id`,
  )
    // The server bound @userId twice by name; positionally that is two binds.
    .bind(userId, userId, `${month}-%`)
    .all()

  return c.json(results)
})

// C2: shared minimal check for budget limits and goal targets.
function positiveAmountError(v: unknown, field: string): string | null {
  const amt = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(amt) || amt <= 0) return `${field} must be a positive number`
  return null
}

wallet.post('/budgets', async (c) => {
  const b = await body(c)
  const amtErr = positiveAmountError(b.limitAmount, 'limitAmount')
  if (amtErr) return c.json({ error: amtErr }, 400)

  if (!(await ownsAllRefs(c.env.DB, c.get('userId'), [['categories', b.categoryId]]))) {
    return c.json({ error: 'invalid category reference' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO budgets (id, user_id, category_id, limit_amount, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, datetime('now'), datetime('now'))
     RETURNING *`,
  )
    .bind(c.get('userId'), b.categoryId, normalizeBind(b.limitAmount))
    .first()
  return c.json(row, 201)
})

wallet.patch('/budgets/:id', async (c) => {
  const b = await body(c)
  if ('limitAmount' in b) {
    const amtErr = positiveAmountError(b.limitAmount, 'limitAmount')
    if (amtErr) return c.json({ error: amtErr }, 400)
  }
  const row = await updateRow(c.env.DB, 'budgets', c.req.param('id'), c.get('userId'), {
    limitAmount: 'limit_amount',
  }, b)
  if (!row) return c.json({ error: 'budget not found' }, 404)
  return c.json(row)
})

wallet.delete('/budgets/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
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

wallet.get('/recurring-transactions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_due_date ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
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

// B-20: a next-due-date far in the past would catch-up-post a burst of
// back-dated transactions (capped at 120) on the next boot — almost always a
// fat-finger. Reject anything more than a year before today.
function farPastDueError(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  if (v < oneYearAgo.toISOString().slice(0, 10)) {
    return 'next due date is too far in the past (more than a year ago)'
  }
  return null
}

wallet.post('/recurring-transactions', async (c) => {
  const b = await body(c)
  if (
    !(await ownsAllRefs(c.env.DB, c.get('userId'), [
      ['accounts', b.accountId],
      ['categories', b.categoryId],
    ]))
  ) {
    return c.json({ error: 'invalid account or category reference' }, 400)
  }
  if (b.type != null && !RECURRING_TYPES.has(String(b.type))) {
    return c.json({ error: 'recurring type must be income or expense' }, 400)
  }
  if (!RECURRING_FREQS.has(String(b.frequency))) {
    return c.json({ error: 'recurring frequency must be monthly or weekly' }, 400)
  }
  const amtErr = positiveAmountError(b.amount, 'amount')
  if (amtErr) return c.json({ error: amtErr }, 400)
  const dateErr = isoDateError(b.nextDueDate, 'nextDueDate') ?? farPastDueError(b.nextDueDate)
  if (dateErr) return c.json({ error: dateErr }, 400)

  const row = await c.env.DB.prepare(
    `INSERT INTO recurring_transactions
       (id, user_id, account_id, amount, merchant, type, category_id, frequency, next_due_date,
        created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     RETURNING *`,
  )
    // userId, accountId, amount, merchant, type, categoryId, frequency, nextDueDate
    .bind(
      c.get('userId'),
      b.accountId,
      normalizeBind(b.amount),
      b.merchant ?? '',
      b.type ?? 'expense',
      b.categoryId ?? null,
      b.frequency,
      b.nextDueDate,
    )
    .first()
  return c.json(row, 201)
})

// Advance an ISO date (YYYY-MM-DD) by one recurrence period. Monthly clamps to
// the last valid day of the target month (e.g. 31 Jan → 28/29 Feb).
//
// Pure UTC arithmetic on the date components, so it is unaffected by the
// runtime's timezone — it ports unchanged.
function advanceDate(dateStr: string, frequency: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + 7)
    return dt.toISOString().slice(0, 10)
  }
  let ny = y
  let nm = m + 1
  if (nm > 12) {
    nm = 1
    ny += 1
  }
  const lastDayThis = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lastDayNext = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  // B-10: keep an end-of-month rule anchored to month-end (31 Jan → 28/29 Feb →
  // 31 Mar → 30 Apr …) instead of drifting to the 28th forever after the first
  // short month. A mid-month day just clamps to the next month's length.
  const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
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
//
// This is the plan's "medium" atomicity site (§5.5, wallet.ts:1313). It is safe
// to convert to a single batch() precisely because the loop performs **no reads**
// — every posted transaction is computed from the rule row already in hand and
// from advanceDate(), which is pure. So the whole write set can be built up
// front and committed at once, exactly as db.transaction() did.
wallet.post('/recurring-transactions/process', async (c) => {
  const userId = c.get('userId')
  const today = todayStr()

  const { results: due } = await c.env.DB.prepare(
    'SELECT * FROM recurring_transactions WHERE user_id = ? AND next_due_date <= ?',
  )
    .bind(userId, today)
    .all<RecurringRecord>()

  const writes = []
  let posted = 0

  for (const rule of due) {
    let next = rule.next_due_date
    let guard = 0
    while (next <= today && guard < 120) {
      writes.push(
        insertTransactionStmt(
          c.env.DB,
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
        ),
      )
      next = advanceDate(next, rule.frequency)
      posted++
      guard++
    }
    writes.push(
      c.env.DB
        .prepare(
          `UPDATE recurring_transactions SET next_due_date = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
        )
        .bind(next, rule.id, userId),
    )
  }

  if (writes.length > 0) await c.env.DB.batch(writes)
  return c.json({ posted })
})

// Post a single rule immediately (dated today) and push its schedule forward one
// period. Used by the "Post now" action.
wallet.post('/recurring-transactions/:id/post', async (c) => {
  const userId = c.get('userId')
  const rule = await c.env.DB.prepare(
    'SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), userId)
    .first<RecurringRecord>()
  if (!rule) return c.json({ error: 'recurring transaction not found' }, 404)

  const today = todayStr()
  // Only advance the schedule when the rule was actually due. Posting an early,
  // ad-hoc occurrence must not consume (skip) the upcoming scheduled one.
  const next =
    rule.next_due_date <= today ? advanceDate(rule.next_due_date, rule.frequency) : rule.next_due_date

  // Posting the transaction without advancing the schedule (or vice versa)
  // leaves a duplicate or a skipped occurrence, so the pair is batched.
  await c.env.DB.batch([
    insertTransactionStmt(
      c.env.DB,
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
    ),
    c.env.DB
      .prepare(
        `UPDATE recurring_transactions SET next_due_date = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(next, rule.id, userId),
  ])

  const row = await c.env.DB.prepare(
    'SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?',
  )
    .bind(rule.id, userId)
    .first()
  return c.json(row)
})

wallet.patch('/recurring-transactions/:id', async (c) => {
  const b = await body(c)
  if ('type' in b && !RECURRING_TYPES.has(String(b.type))) {
    return c.json({ error: 'recurring type must be income or expense' }, 400)
  }
  if ('frequency' in b && !RECURRING_FREQS.has(String(b.frequency))) {
    return c.json({ error: 'recurring frequency must be monthly or weekly' }, 400)
  }
  if ('amount' in b) {
    const amtErr = positiveAmountError(b.amount, 'amount')
    if (amtErr) return c.json({ error: amtErr }, 400)
  }
  if ('nextDueDate' in b) {
    const dateErr = isoDateError(b.nextDueDate, 'nextDueDate') ?? farPastDueError(b.nextDueDate)
    if (dateErr) return c.json({ error: dateErr }, 400)
  }

  const refs: Array<[string, unknown]> = []
  if ('accountId' in b) refs.push(['accounts', b.accountId])
  if ('categoryId' in b) refs.push(['categories', b.categoryId])
  if (!(await ownsAllRefs(c.env.DB, c.get('userId'), refs))) {
    return c.json({ error: 'invalid account or category reference' }, 400)
  }

  const row = await updateRow(
    c.env.DB,
    'recurring_transactions',
    c.req.param('id'),
    c.get('userId'),
    RECURRING_COLS,
    b,
  )
  if (!row) return c.json({ error: 'recurring transaction not found' }, 404)
  return c.json(row)
})

wallet.delete('/recurring-transactions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})

// ── Goals ────────────────────────────────────────────

const GOAL_COLS: Record<string, string> = {
  name: 'name',
  targetAmount: 'target_amount',
  accountId: 'account_id',
}

wallet.get('/goals', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM goals WHERE user_id = ? ORDER BY created_at ASC',
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

wallet.post('/goals', async (c) => {
  const b = await body(c)
  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  const amtErr = positiveAmountError(b.targetAmount, 'targetAmount')
  if (amtErr) return c.json({ error: amtErr }, 400)
  if (!(await ownsAllRefs(c.env.DB, c.get('userId'), [['accounts', b.accountId]]))) {
    return c.json({ error: 'invalid account reference' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO goals (id, user_id, name, target_amount, account_id, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'), datetime('now'))
     RETURNING *`,
  )
    .bind(c.get('userId'), b.name, normalizeBind(b.targetAmount), b.accountId)
    .first()
  return c.json(row, 201)
})

wallet.patch('/goals/:id', async (c) => {
  const b = await body(c)
  if ('targetAmount' in b) {
    const amtErr = positiveAmountError(b.targetAmount, 'targetAmount')
    if (amtErr) return c.json({ error: amtErr }, 400)
  }
  if (
    'accountId' in b &&
    !(await ownsAllRefs(c.env.DB, c.get('userId'), [['accounts', b.accountId]]))
  ) {
    return c.json({ error: 'invalid account reference' }, 400)
  }

  const row = await updateRow(c.env.DB, 'goals', c.req.param('id'), c.get('userId'), GOAL_COLS, b)
  if (!row) return c.json({ error: 'goal not found' }, 404)
  return c.json(row)
})

wallet.delete('/goals/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})
