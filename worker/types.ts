// Cloudflare bindings available to the Worker at runtime.
//
// These come from wrangler.toml — `DB` from [[d1_databases]], `ASSETS` from
// [assets]. Every route module types its Hono instance as
// `Hono<{ Bindings: Env }>` so `c.env.DB` is typed end to end.
export interface Env {
  /** D1 database — replaces the better-sqlite3 file the Node server owns today. */
  DB: D1Database
  /** Static-asset fetcher for the built SPA (dist/). */
  ASSETS: Fetcher
}

/**
 * Hono generic used by every route module. Phase 3 adds a `Variables` entry for
 * the authenticated user; keeping the alias here means that lands in one place.
 */
export type AppEnv = { Bindings: Env }
