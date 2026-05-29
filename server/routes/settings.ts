import { Router } from 'express'
import { getDb } from '../db.ts'

export const settingsRouter: Router = Router()

// GET /api/settings → all key/value rows.
settingsRouter.get('/settings', (_req, res) => {
  res.json(getDb().prepare('SELECT key, value FROM settings').all())
})

// PUT /api/settings/:key → upsert a single setting.
settingsRouter.put('/settings/:key', (req, res) => {
  const value = String(req.body?.value ?? '')
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (@key, @value)
       ON CONFLICT (key) DO UPDATE SET value = @value`,
    )
    .run({ key: req.params.key, value })
  res.json({ key: req.params.key, value })
})
