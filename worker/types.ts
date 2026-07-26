// Cloudflare bindings available to the Worker at runtime.
//
// These come from wrangler.toml — `DB` from [[d1_databases]], `ASSETS` from
// [assets], and the string values from [vars] (or, for secrets, from
// `wrangler secret put`). Every route module types its Hono instance as
// `Hono<AppEnv>` so `c.env.DB` and `c.get('userId')` are typed end to end.
export interface Env {
  /** D1 database — replaces the better-sqlite3 file the Node server owns today. */
  DB: D1Database
  /** Static-asset fetcher for the built SPA (dist/). */
  ASSETS: Fetcher

  /**
   * HMAC key for signing the session cookie.
   *
   * A **secret**, not a var: set with `wrangler secret put SESSION_SECRET`, never
   * committed to wrangler.toml. session.ts throws if it is missing rather than
   * falling back to a default — an empty signing key makes every session
   * forgeable, so failing closed is the only safe behaviour.
   */
  SESSION_SECRET: string

  /**
   * `'true'` enables POST /api/auth/signup. Anything else disables it (403).
   *
   * Blocker 4.2. Production keeps this off: the app has exactly two users, both
   * already provisioned, so an open signup endpoint is pure attack surface on a
   * publicly reachable URL. Dev and e2e set it true — the suite creates a fresh
   * user per test.
   */
  DAYBOOK_ALLOW_SIGNUP?: string

  /** `'1'` mounts POST /api/test/reset. Never set in production. */
  DAYBOOK_TEST?: string
}

/**
 * Hono generic used by every route module.
 *
 * `Variables.userId` is set by requireAuth and read by every scoped route, so a
 * handler never re-reads the session or trusts a client-supplied user id.
 */
export type AppEnv = {
  Bindings: Env
  Variables: { userId: string }
}
