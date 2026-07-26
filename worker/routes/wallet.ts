import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { normalizeBind, updateRow } from '../lib.ts'
import { isGroupMember, visibleAccountIds } from '../lib/sharing.ts'

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
