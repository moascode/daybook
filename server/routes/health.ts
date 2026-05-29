import { Router } from 'express'
import { getDb } from '../db.ts'

export const healthRouter: Router = Router()

// GET /api/health — liveness + DB connectivity check.
healthRouter.get('/health', (_req, res) => {
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number }
    res.json({ status: 'ok', db: row.ok === 1, time: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message })
  }
})
