import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { readSession } from '../session.ts'

// Test-only routes. Mounted only when DAYBOOK_TEST === '1' (set in
// wrangler.toml's [env.dev]). The e2e suite achieves per-test isolation by
// signing up a fresh user per page; this full wipe is available for a clean
// baseline between runs if needed.
export const test = new Hono<AppEnv>()

// Delete order is children → parents.
//
// The Node version wrapped this in `PRAGMA foreign_keys = OFF`. D1 does not
// expose that pragma, so the order has to be genuinely FK-safe rather than
// relying on enforcement being switched off. Deleting `users` last would
// cascade most of this anyway, but naming every table keeps the wipe explicit
// and independent of which cascades happen to be declared.
const WIPE_ORDER = [
  'settlement_split_lines',
  'settlements',
  'transaction_splits',
  'absorbed_import_hashes',
  'account_shares',
  'group_invites',
  'group_members',
  'groups',
  'task_templates',
  'goals',
  'recurring_transactions',
  'budgets',
  'transactions',
  'categories',
  'accounts',
  'tasks',
  'settings',
  'sessions',
  'users',
]

test.post('/test/reset', async (c) => {
  await c.env.DB.batch(WIPE_ORDER.map((t) => c.env.DB.prepare(`DELETE FROM ${t}`)))
  return c.json({ status: 'reset' })
})

// Inject a legacy transaction with tag='' for the requesting user's first
// account. Simulates rows created before multi-tag support, where the SQLite
// column default ('') was used — json_each() throws on those, which is what
// migrations 0002/0003 exist to repair and what the tag filter must survive.
test.post('/test/inject-legacy-tag-row', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const account = await c.env.DB.prepare('SELECT id FROM accounts WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<{ id: string }>()
  if (!account) return c.json({ error: 'no accounts found for user' }, 400)

  await c.env.DB.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, merchant, amount, type, tag)
     VALUES (lower(hex(randomblob(16))), ?, ?, date('now'), 'Legacy Row', 9.99, 'expense', '')`,
  )
    .bind(userId, account.id)
    .run()

  return c.json({ status: 'injected' })
})
