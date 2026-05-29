import { Router } from 'express'
import { getDb } from '../db.ts'

export const settingsRouter: Router = Router()

// GET /api/settings → the current user's key/value rows.
settingsRouter.get('/settings', (req, res) => {
  res.json(getDb().prepare('SELECT key, value FROM settings WHERE user_id = ?').all(req.session.userId!))
})

// PUT /api/settings/:key → upsert a single setting for the current user.
settingsRouter.put('/settings/:key', (req, res) => {
  const value = String(req.body?.value ?? '')
  getDb()
    .prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (@userId, @key, @value)
       ON CONFLICT (user_id, key) DO UPDATE SET value = @value`,
    )
    .run({ userId: req.session.userId!, key: req.params.key, value })
  res.json({ key: req.params.key, value })
})
