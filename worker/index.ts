import { Hono } from 'hono'
import type { AppEnv } from './types.ts'
import { health } from './routes/health.ts'

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

// Public routes (no auth required).
app.route('/api', health)

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
