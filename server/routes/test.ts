import { Router } from 'express'
import { getDb } from '../db.ts'

// Test-only routes. Mounted only when DAYBOOK_TEST=1. The e2e suite achieves
// per-test isolation by signing up a fresh user per page; this full wipe is
// available for a clean baseline between runs if needed.
export const testRouter: Router = Router()

testRouter.post('/test/reset', (_req, res) => {
  const db = getDb()
  db.pragma('foreign_keys = OFF')
  db.exec(`
    DELETE FROM task_templates;
    DELETE FROM goals;
    DELETE FROM recurring_transactions;
    DELETE FROM budgets;
    DELETE FROM transactions;
    DELETE FROM categories;
    DELETE FROM accounts;
    DELETE FROM tasks;
    DELETE FROM settings;
    DELETE FROM sessions;
    DELETE FROM users;
  `)
  db.pragma('foreign_keys = ON')
  res.json({ status: 'reset' })
})

// Inject a legacy transaction with tag='' for the requesting user's first account.
// Simulates rows created before multi-tag support where the SQLite default ('') was used.
testRouter.post('/test/inject-legacy-tag-row', (req, res) => {
  const db = getDb()
  const userId = req.session.userId
  if (!userId) return res.status(401).json({ error: 'not authenticated' })
  const account = db.prepare('SELECT id FROM accounts WHERE user_id = ? LIMIT 1').get(userId) as { id: string } | undefined
  if (!account) return res.status(400).json({ error: 'no accounts found for user' })
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, date, merchant, amount, type, tag)
     VALUES (lower(hex(randomblob(16))), ?, ?, date('now'), 'Legacy Row', 9.99, 'expense', '')`,
  ).run(userId, account.id)
  res.json({ status: 'injected' })
})
