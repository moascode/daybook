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
