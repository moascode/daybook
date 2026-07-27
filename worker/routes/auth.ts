import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types.ts'
import { hashPassword, needsRehash, verifyPassword } from '../crypto.ts'
import { createSession, destroySession, readSession } from '../session.ts'
import { seedUserDefaults } from '../seed.ts'

export const auth = new Hono<AppEnv>()

const MAX_USERNAME = 64

/**
 * Blocker 4.4: raised from the server's 6.
 *
 * Length alone is a weak proxy for what actually matters here. The KDF runs at
 * 50,000 iterations — 1/12 of OWASP's recommendation — because that is all the
 * free tier's CPU budget allows (see crypto.ts). The spike findings are explicit
 * that this is only safe when passwords carry the entropy the KDF cannot: long,
 * randomly generated, from a password manager.
 *
 * A 12-character minimum does NOT enforce that. `Welcome@2024` passes it and is
 * still a dictionary word plus a predictable suffix — the first thing an offline
 * cracker tries. This check stops the worst inputs; it cannot manufacture
 * entropy. The real control is the operator choosing generated passwords.
 */
const MIN_PASSWORD = 12

/** PBKDF2 has no bcrypt-style 72-byte truncation; cap only to bound CPU. */
const MAX_PASSWORD = 200

interface UserRow {
  id: string
  username: string
  password_hash: string
}

// Usernames are case-insensitive — store and compare lowercase.
const normalizeUsername = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

/** Signup is closed unless explicitly enabled (blocker 4.2). */
const signupAllowed = (env: AppEnv['Bindings']): boolean => env.DAYBOOK_ALLOW_SIGNUP === 'true'

// POST /api/auth/signup — create a user, seed their defaults, log them in.
auth.post('/auth/signup', async (c) => {
  // Blocker 4.2, and with it 4.x's user-enumeration oracle: the 409 below tells
  // an anonymous caller whether a username exists (server/routes/auth.ts:50).
  // With signup disabled in production the oracle is unreachable. It remains
  // present in dev and e2e, where enumeration is not a threat and the distinct
  // status code is worth keeping for test clarity.
  if (!signupAllowed(c.env)) {
    return c.json({ error: 'signups are disabled' }, 403)
  }

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const username = normalizeUsername(body?.username)
  const password = String(body?.password ?? '')

  if (!username || !password) {
    return c.json({ error: 'username and password are required' }, 400)
  }
  if (username.length > MAX_USERNAME) {
    return c.json({ error: `username must be at most ${MAX_USERNAME} characters` }, 400)
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return c.json({ error: `password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>()
  if (existing) return c.json({ error: 'username already taken' }, 409)

  const hash = await hashPassword(password)
  const row = await c.env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now'))
     RETURNING id, username`,
  )
    .bind(username, hash)
    .first<{ id: string; username: string }>()

  if (!row) return c.json({ error: 'failed to create user' }, 500)

  await seedUserDefaults(c.env.DB, row.id)
  await createSession(c, row.id)
  return c.json({ user: row }, 201)
})

// POST /api/auth/login — verify credentials, start a session.
auth.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const username = normalizeUsername(body?.username)
  const password = String(body?.password ?? '')

  const user = await c.env.DB.prepare(
    'SELECT id, username, password_hash FROM users WHERE username = ?',
  )
    .bind(username)
    .first<UserRow>()

  // One message and one status for both "no such user" and "wrong password",
  // so login does not become the enumeration oracle signup used to be.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'invalid username or password' }, 401)
  }

  // Transparently move the hash to current parameters while we have the
  // plaintext. This is what lets PBKDF2_ITERATIONS be raised later (e.g. on
  // Workers Paid) without resetting anyone's password.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password)
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(upgraded, user.id)
      .run()
  }

  await createSession(c, user.id)
  return c.json({ user: { id: user.id, username: user.username } })
})

// POST /api/auth/logout — clear the session.
auth.post('/auth/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

// GET /api/auth/me — the current user, or 401.
auth.get('/auth/me', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; username: string }>()
  // Session outlived its user (deleted account) — treat as unauthenticated.
  if (!user) return c.json({ error: 'not authenticated' }, 401)

  return c.json({ user })
})

// POST /api/auth/change-password — authenticated password change.
//
// Requires the current password even though the caller already holds a valid
// session: a session cookie proves "this browser was logged in at some point",
// not "the person at the keyboard knows the password". Without the re-check, an
// unattended machine or a stolen cookie is enough to lock the real owner out.
auth.post('/auth/change-password', async (c) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const currentPassword = String(body?.currentPassword ?? '')
  const newPassword = String(body?.newPassword ?? '')

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'currentPassword and newPassword are required' }, 400)
  }
  if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
    return c.json({ error: `password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` }, 400)
  }
  if (newPassword === currentPassword) {
    return c.json({ error: 'the new password must be different from the current one' }, 400)
  }

  const user = await c.env.DB.prepare('SELECT id, username, password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>()
  if (!user) return c.json({ error: 'not authenticated' }, 401)

  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    return c.json({ error: 'current password is incorrect' }, 403)
  }

  const hash = await hashPassword(newPassword)

  // Changing a password must invalidate every OTHER session. That is the whole
  // point of changing it after a suspected compromise — otherwise the attacker's
  // existing cookie keeps working and the change accomplishes nothing.
  //
  // Sessions are stored as JSON, so they are matched on the extracted userId.
  // The caller's own session goes too; createSession() below immediately issues
  // a fresh one, so they stay logged in on this device only.
  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(hash, userId),
    c.env.DB
      .prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?")
      .bind(userId),
  ])

  await createSession(c, userId)
  return c.json({ ok: true })
})

/**
 * Guard for every non-auth API route. Stores the user id on the context so
 * downstream handlers read it with `c.get('userId')` instead of re-querying —
 * the Hono equivalent of `req.session.userId`.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await readSession(c)
  if (!userId) return c.json({ error: 'not authenticated' }, 401)
  c.set('userId', userId)
  await next()
}
