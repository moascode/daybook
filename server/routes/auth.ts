import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { getDb } from '../db.ts'
import { seedUserDefaults } from '../seed.ts'

export const authRouter: Router = Router()

const BCRYPT_ROUNDS = 10
const MAX_USERNAME = 64
const MAX_PASSWORD = 72 // bcrypt only hashes the first 72 bytes anyway
const MIN_PASSWORD = 6

interface UserRow {
  id: string
  username: string
  password_hash: string
}

// Usernames are case-insensitive — store and compare lowercase.
const normalizeUsername = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

// Regenerate the session on auth to avoid session fixation, then persist userId.
function establishSession(req: import('express').Request, userId: string, done: () => void): void {
  req.session.regenerate((err) => {
    if (err) return done()
    req.session.userId = userId
    req.session.save(() => done())
  })
}

// POST /api/auth/signup — create a user, seed their defaults, log them in.
authRouter.post('/auth/signup', (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password ?? '')
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' })
  }
  if (username.length > MAX_USERNAME) {
    return res.status(400).json({ error: `username must be at most ${MAX_USERNAME} characters` })
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return res.status(400).json({ error: `password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return res.status(409).json({ error: 'username already taken' })

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
  const row = db
    .prepare(
      `INSERT INTO users (id, username, password_hash, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now'))
       RETURNING id, username`,
    )
    .get(username, hash) as { id: string; username: string }

  seedUserDefaults(db, row.id)
  establishSession(req, row.id, () => res.status(201).json({ user: row }))
})

// POST /api/auth/login — verify credentials, start a session.
authRouter.post('/auth/login', (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password ?? '')

  const user = getDb()
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as UserRow | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid username or password' })
  }

  establishSession(req, user.id, () => res.json({ user: { id: user.id, username: user.username } }))
})

// POST /api/auth/logout — clear the session.
authRouter.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid')
    res.json({ ok: true })
  })
})

// GET /api/auth/me — the current user, or 401.
authRouter.get('/auth/me', (req, res) => {
  const userId = req.session.userId
  if (!userId) return res.status(401).json({ error: 'not authenticated' })
  const user = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
  if (!user) return res.status(401).json({ error: 'not authenticated' })
  res.json({ user })
})

// Guard for every non-auth API route.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: 'not authenticated' })
    return
  }
  next()
}
