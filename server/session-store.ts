import session from 'express-session'
import type { SessionData } from 'express-session'
import type { DB } from './db.ts'

// Persist `userId` on the session so requireAuth and scoped routes can read it.
declare module 'express-session' {
  interface SessionData {
    userId?: string
  }
}

type Done = (err?: unknown, session?: SessionData | null) => void
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

/**
 * express-session store backed by better-sqlite3 (sessions table). Keeps the
 * Phase 4 backend dependency-light — no separate session-store package — and
 * persists logins across server restarts.
 */
export class SqliteSessionStore extends session.Store {
  private db: DB

  constructor(db: DB) {
    super()
    this.db = db
  }

  private expiryOf(sess: SessionData): number {
    const expires = sess.cookie?.expires
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS
  }

  get(sid: string, cb: Done): void {
    try {
      const row = this.db
        .prepare('SELECT sess, expire FROM sessions WHERE sid = ?')
        .get(sid) as { sess: string; expire: number } | undefined
      if (!row) return cb(null, null)
      if (row.expire < Date.now()) {
        this.destroy(sid, () => {})
        return cb(null, null)
      }
      let parsed: SessionData
      try {
        parsed = JSON.parse(row.sess) as SessionData
      } catch {
        // Corrupt row would otherwise 500 every request for this sid — drop it
        // and treat as no session.
        this.destroy(sid, () => {})
        return cb(null, null)
      }
      cb(null, parsed)
    } catch (err) {
      cb(err)
    }
  }

  set(sid: string, sess: SessionData, cb?: (err?: unknown) => void): void {
    try {
      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
           ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        )
        .run(sid, JSON.stringify(sess), this.expiryOf(sess))
      cb?.()
    } catch (err) {
      cb?.(err)
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void): void {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      cb?.()
    } catch (err) {
      cb?.(err)
    }
  }

  touch(sid: string, sess: SessionData, cb?: (err?: unknown) => void): void {
    try {
      this.db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(this.expiryOf(sess), sid)
      cb?.()
    } catch (err) {
      cb?.(err)
    }
  }
}
