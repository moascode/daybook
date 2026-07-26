import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from './types.ts'
import { health } from './routes/health.ts'
import { auth, requireAuth } from './routes/auth.ts'
import { tasks } from './routes/tasks.ts'
import { settings } from './routes/settings.ts'
import { groups } from './routes/groups.ts'
import { settlements } from './routes/settlements.ts'
import { wallet } from './routes/wallet.ts'
import { test } from './routes/test.ts'

// ─────────────────────────────────────────────────────────────
// Daybook Worker — the Cloudflare-side replacement for server/index.ts.
//
// Static assets (dist/) are served by the edge asset pipeline without invoking
// this Worker at all; `run_worker_first = ["/api/*"]` in wrangler.toml means
// only API paths run code here. That preserves the single-origin property the
// Express server gives today (server/index.ts:77-85) — no CORS, no split deploy.
//
// Route modules are ported from server/routes/ one per phase. Phase 1 ships
// health only; auth lands in Phase 3 and the rest in Phase 4.
// ─────────────────────────────────────────────────────────────

const app = new Hono<AppEnv>()

// Request logging, mirroring server/index.ts:33-39 (C12). `Date.now()` is
// frozen during synchronous execution on the edge (Spectre mitigation, see
// docs/option-2-spike-findings.md S1), so this measures wall time across
// awaits only — which is exactly what it measured before.
app.use('/api/*', async (c, next) => {
  const started = Date.now()
  await next()
  console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${Date.now() - started}ms`)
})

// Blocker 4.5: the Workers-native replacement for helmet, which is Express
// middleware and cannot run here. Applied to every response including static
// assets, so the SPA gets them too.
app.use(
  '*',
  secureHeaders({
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
  }),
)

// Public routes (no auth required).
app.route('/api', health)
app.route('/api', auth)

// Test-only routes, mounted before the auth guard because /test/reset must run
// without a session.
//
// The Express server decides whether to mount these at boot
// (server/index.ts:61). A Worker has no bindings at module scope, so the gate
// has to be per-request: the routes are always registered, and this middleware
// makes them indistinguishable from non-existent unless DAYBOOK_TEST is set —
// which only wrangler.toml's [env.dev] does, never production.
app.use('/api/test/*', async (c, next) => {
  if (c.env.DAYBOOK_TEST !== '1') return c.json({ error: 'not found' }, 404)
  await next()
})
app.route('/api', test)

// Everything below requires an authenticated session.
//
// The Express app relies on registration order for this — `app.use('/api',
// requireAuth)` sits between the public and protected routers
// (server/index.ts:66) and guards only what is mounted after it. Hono composes
// matched handlers in registration order too, so the same trick would work, but
// it fails silently and invisibly: mounting a new router one line too high
// leaves it unauthenticated with nothing to show for it.
//
// A dedicated sub-app makes the guarantee structural instead of positional —
// requireAuth applies to everything routed through `protectedApi` regardless of
// where the mount lands. Phase 4's remaining routers attach here.
const protectedApi = new Hono<AppEnv>()
protectedApi.use('*', requireAuth)
protectedApi.route('/', tasks)
protectedApi.route('/', settings)
protectedApi.route('/', groups)
protectedApi.route('/', settlements)
protectedApi.route('/', wallet)

app.route('/api', protectedApi)

// Any /api path that matched no route. Non-API paths never reach the Worker.
app.notFound((c) => c.json({ error: 'not found' }, 404))

// Single error handler so every failure returns the same `{error}` JSON shape
// the client already parses (src/lib/api.ts), instead of a stack page.
// Mirrors server/index.ts:90-100.
app.onError((err, c) => {
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500
  const message = status < 500 && err.message ? err.message : 'internal server error'
  if (status >= 500) console.error(`ERROR ${c.req.method} ${c.req.url}:`, err)
  return c.json({ error: message }, status as 400)
})

export default app
