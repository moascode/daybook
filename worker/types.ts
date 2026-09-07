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

  /**
   * VAPID keypair for Web Push (v3 P4).
   *
   * The PRIVATE key is a secret — `wrangler secret put VAPID_PRIVATE_KEY` —
   * never wrangler.toml, never the repo. The public key is not secret (the
   * browser needs it to subscribe) but lives beside it for symmetry.
   *
   * Both absent is a supported state: /notifications/config reports push
   * disabled, the Settings toggle hides itself, and the cron sends nothing. A
   * deploy without them is degraded, not broken.
   */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** mailto: or https: identifying the sender to the push service, per RFC 8292. */
  VAPID_SUBJECT?: string

  /** `'1'` mounts POST /api/test/reset. Never set in production. */
  DAYBOOK_TEST?: string
  // '1' silences the per-request log line. Set only by the Playwright harness
  // (--var in playwright.config.ts): every console.log in `wrangler dev` is
  // forwarded through the InspectorProxyWorker, and a full suite emitted 15,480
  // of them with no devtools attached to receive them. workerd died writing to
  // that pipe ("Broken pipe", kj/async-io-unix.c++:186). Production and normal
  // local dev keep the logs.
  DAYBOOK_QUIET_LOGS?: string
}

/**
 * Hono generic used by every route module.
 *
 * `Variables.userId` is set by requireAuth and read by every scoped route, so a
 * handler never re-reads the session or trusts a client-supplied user id.
 */
export type AppEnv = {
  Bindings: Env
  Variables: {
    userId: string
    /**
     * Set ONLY by the capture sub-app's bearer guard (worker/routes/capture.ts),
     * never by requireAuth. Its presence is what distinguishes a machine caller
     * from a browser session; cookie-authenticated routes must never read it,
     * and token-authenticated routes must never assume a session exists.
     */
    captureTokenId?: string
    captureTokenLabel?: string
    captureScopes?: string[]
  }
}
