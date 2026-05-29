import { Router } from 'express'
import { getDb } from '../db.ts'
import { seedCategories } from '../seed.ts'

// Test-only routes. Mounted only when DAYBOOK_TEST=1 so the reset endpoint can
// never be hit in normal use. Used by the e2e suite to give each browser page a
// clean database — the equivalent of the old fresh-IndexedDB-per-context.
export const testRouter: Router = Router()

testRouter.post('/test/reset', (_req, res) => {
  const db = getDb()
  db.exec(`
    DELETE FROM tasks;
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM categories;
    DELETE FROM budgets;
    DELETE FROM recurring_transactions;
    DELETE FROM goals;
    DELETE FROM task_templates;
    DELETE FROM settings;
  `)
  seedCategories(db)
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  insertSetting.run('default_currency', 'MYR')
  insertSetting.run('theme', 'light')
  insertSetting.run('hide_completed', '0')
  res.json({ status: 'reset' })
})
