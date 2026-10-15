import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { readSession } from '../session.ts'
import { runReminders } from '../scheduled.ts'
import { isValidRemindAt } from '../lib.ts'

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
  'settlement_chain_parties',
  'settlements',
  'settlement_chains',
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

// Age a settlement by N days so the undo window can be tested at both edges.
//
// The window is the only rule in the app whose input is wall-clock elapsed time,
// and `settled_at` is written server-side by datetime('now') — there is no
// request that can produce an old settlement. Without this the seven-day rule
// could only ever be exercised on its "still fresh" side, which is the side that
// cannot fail.
test.post('/test/backdate-settlement', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const b: { id?: string; days?: number } =
    await c.req.json<{ id?: string; days?: number }>().catch(() => ({}))
  const days = Number(b.days)
  if (!b.id || !Number.isInteger(days) || days < 0) {
    return c.json({ error: 'id and a non-negative integer days are required' }, 400)
  }

  const res = await c.env.DB.prepare(
    `UPDATE settlements SET settled_at = datetime('now', ?)
      WHERE id = ? AND (from_user = ? OR to_user = ?)`,
  )
    .bind(`-${days} days`, b.id, userId, userId)
    .run()
  if (!res.meta.changes) return c.json({ error: 'settlement not found' }, 404)

  return c.json({ status: 'backdated', days })
})

// Age a recurring rule's created_at by N days, mirroring backdate-settlement
// above. FEAT-068's costliest-subscription nudge only considers a rule whose
// created_at is more than 6 months ago, and created_at is written server-side
// by datetime('now') on insert — there is no request that can produce an
// old rule, so the "older than 6 months" branch needs this to be testable.
test.post('/test/backdate-recurring', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const b: { id?: string; days?: number } =
    await c.req.json<{ id?: string; days?: number }>().catch(() => ({}))
  const days = Number(b.days)
  if (!b.id || !Number.isInteger(days) || days < 0) {
    return c.json({ error: 'id and a non-negative integer days are required' }, 400)
  }

  const res = await c.env.DB.prepare(
    `UPDATE recurring_transactions SET created_at = datetime('now', ?)
      WHERE id = ? AND user_id = ?`,
  )
    .bind(`-${days} days`, b.id, userId)
    .run()
  if (!res.meta.changes) return c.json({ error: 'recurring transaction not found' }, 404)

  return c.json({ status: 'backdated', days })
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

// Simulates an independent settlement landing on a split "underneath" an
// in-flight settlement/chain, between its creation-time probe and its final
// confirm — fault injection for the CAS discipline (CLAUDE.md §3). The guard
// every confirming write uses is `status IN ('pending', 'approved') AND
// settled_amount = <the value read>`: a plain re-read of settled_amount alone
// cannot be defeated by a sequential (not truly concurrent) test, because the
// confirming request's own hoisted read would simply see whatever is there by
// then and guard against that. What the CAS structurally defends against is
// the split's status having moved to 'settled' (or `settled_at` having been
// set) by something else — exactly what finishing a real settlement does —
// so this hook does that: it fully settles the split as an unrelated party
// would, which is what makes the confirming request's guarded UPDATE match
// zero rows and forces it to compensate and return 409 with nothing moved.
// No other test route reaches into transaction_splits like this, so it is
// kept narrowly scoped to exactly this one simulated effect and gated the
// same way as every other /test/* route (DAYBOOK_TEST only, see worker/index.ts).
test.post('/test/force-settle-split', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const b: { splitId?: string } = await c.req.json<{ splitId?: string }>().catch(() => ({}))
  if (!b.splitId) return c.json({ error: 'splitId is required' }, 400)

  const res = await c.env.DB.prepare(
    `UPDATE transaction_splits
        SET settled_amount = share_amount, status = 'settled', settled_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(b.splitId)
    .run()
  if (!res.meta.changes) return c.json({ error: 'split not found' }, 404)

  return c.json({ status: 'forced' })
})

// Stashes a canned Claude response body for the requesting user, consumed by
// worker/lib/anthropic.ts in place of the real network call — see its
// comment for why e2e cannot intercept a Worker-to-Anthropic fetch the way
// Playwright intercepts browser requests. `text` is whatever the real
// response's text content would have been (typically the raw
// {"suggestions":[...]} JSON string, but deliberately unvalidated here so a
// spec can also stash malformed JSON to exercise the defensive parse).
test.post('/test/mock-ai-response', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const b: { text?: unknown; feature?: unknown } = await c.req.json().catch(() => ({}))
  if (typeof b.text !== 'string') return c.json({ error: 'text is required' }, 400)
  // 'merchants' targets resolveMerchantsWithAI's own mock slot (worker/lib/anthropic.ts
  // TEST_MOCK_KEY_MERCHANTS), 'composer' targets parseComposerWithAI's
  // (TEST_MOCK_KEY_COMPOSER), and 'photo_import' targets parsePhotoImportWithAI's
  // (TEST_MOCK_KEY_PHOTO_IMPORT), so a spec exercising multiple AI features in
  // one run doesn't have one mock clobber another. Anything else keeps the original key.
  const settingsKey =
    b.feature === 'merchants'
      ? '_test_ai_mock_response_merchants'
      : b.feature === 'composer'
        ? '_test_ai_mock_response_composer'
        : b.feature === 'photo_import'
          ? '_test_ai_mock_response_photo_import'
          : '_test_ai_mock_response'

  await c.env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
  )
    .bind(userId, settingsKey, b.text)
    .run()

  return c.json({ status: 'mocked' })
})

// Runs the reminder cron's sweep on demand so e2e never waits for a real
// schedule. `now` ('YYYY-MM-DDTHH:MM', business time) overrides the clock.
// Sweeps EVERY user's due reminders, exactly as the cron does.
test.post('/test/run-reminders', async (c) => {
  const b = await c.req.json<{ now?: unknown }>().catch(() => ({}) as { now?: unknown })
  if (b.now !== undefined && !isValidRemindAt(b.now)) {
    return c.json({ error: 'now must be YYYY-MM-DDTHH:MM' }, 400)
  }
  return c.json(await runReminders(c.env, typeof b.now === 'string' ? b.now : undefined))
})
