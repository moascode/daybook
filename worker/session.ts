import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { AppEnv } from './types.ts'

// Server-side sessions backed by the D1 `sessions` table, replacing
// express-session + SqliteSessionStore.
//
// **Deliberately not JWTs.** A stateless token cannot be revoked, so logout
// would become "the client promises to forget", and there would be no way to
// cut off a stolen session before expiry. Keeping a server-side row preserves
// exactly what the Express app does today: real logout, real revocation.
//
// The cookie carries only an opaque session id, signed with SESSION_SECRET so a
// forged or tampered id is rejected before it ever reaches D1. All session state
// lives in the row.

const COOKIE = 'daybook_sid'
const TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days, matching server/index.ts:53

interface SessionRow {
  sess: string
  expire: number
}

function secretOf(c: Context<AppEnv>): string {
  const secret = c.env.SESSION_SECRET
  // Failing closed matters more than a helpful error: with an empty secret,
  // signing is trivially forgeable and every session becomes spoofable.
  if (!secret) throw new Error('SESSION_SECRET is not configured')
  return secret
}

/** Cryptographically random opaque session id. */
function newSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Cookie attributes.
 *
 * `secure: true` is unconditional — the Express server had to leave it false
 * because the home network is plain HTTP (server/index.ts:52). On Workers, TLS
 * is always terminated at the edge, so there is no HTTP case to accommodate.
 * This is the "blocker 4.1 disappears" property from the plan: no
 * `trust proxy`, no environment-dependent cookie flags, nothing to get wrong.
 *
 * `sameSite: 'Lax'` matches today and is sufficient because the SPA and the API
 * share one origin.
 */
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const

/** The authenticated user id for this request, or null. */
export async function readSession(c: Context<AppEnv>): Promise<string | null> {
  let sid: string | false | undefined
  try {
    sid = await getSignedCookie(c, secretOf(c), COOKIE)
  } catch {
    return null
  }
  // getSignedCookie returns false when the signature does not verify.
  if (!sid) return null

  const row = await c.env.DB.prepare('SELECT sess, expire FROM sessions WHERE sid = ?')
    .bind(sid)
    .first<SessionRow>()
  if (!row) return null

  if (row.expire < Date.now()) {
    // Opportunistic cleanup — there is no cron sweeping this table.
    await c.env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(sid).run()
    return null
  }

  try {
    const parsed = JSON.parse(row.sess) as { userId?: string }
    return parsed.userId ?? null
  } catch {
    // A corrupt row would otherwise fail every request for this sid.
    await c.env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(sid).run()
    return null
  }
}

/**
 * Start a fresh session for `userId` and set the cookie.
 *
 * Always mints a NEW sid and deletes any session the caller already had. That
 * is session regeneration on authentication — the fixation defence the Express
 * routes get from `req.session.regenerate()` (server/routes/auth.ts:26-32).
 * Without it, an attacker who fixes a victim's pre-login sid still holds a
 * valid session id after the victim logs in.
 */
export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const secret = secretOf(c)

  const previous = await getSignedCookie(c, secret, COOKIE).catch(() => false as const)
  if (previous) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(previous).run()
  }

  const sid = newSid()
  const now = Date.now()
  const expire = now + TTL_MS

  // The DELETE above only fires when the client presents its old cookie. A
  // client that simply drops it — a cleared browser, a script, a device that is
  // never used again — leaves an orphaned row that nothing would ever revisit,
  // since readSession's opportunistic cleanup requires someone to present it.
  // There is no cron sweeping this table, so login purges expired rows. One
  // extra statement, on login only, and it bounds the table for free.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expire < ?').bind(now),
    c.env.DB
      .prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)')
      .bind(sid, JSON.stringify({ userId }), expire),
  ])

  await setSignedCookie(c, COOKIE, sid, secret, { ...COOKIE_OPTS, maxAge: TTL_MS / 1000 })
}

/** Delete the session row and clear the cookie. */
export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sid = await getSignedCookie(c, secretOf(c), COOKIE).catch(() => false as const)
  if (sid) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(sid).run()
  }
  deleteCookie(c, COOKIE, COOKIE_OPTS)
}
