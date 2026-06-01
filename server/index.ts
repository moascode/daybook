import express from 'express'
import session from 'express-session'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from './db.ts'
import { SqliteSessionStore } from './session-store.ts'
import { healthRouter } from './routes/health.ts'
import { authRouter, requireAuth } from './routes/auth.ts'
import { tasksRouter } from './routes/tasks.ts'
import { walletRouter } from './routes/wallet.ts'
import { groupsRouter } from './routes/groups.ts'
import { settlementsRouter } from './routes/settlements.ts'
import { settingsRouter } from './routes/settings.ts'
import { testRouter } from './routes/test.ts'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0' // bind all interfaces so the LAN can reach it

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(__dirname, '..', 'dist')

// A real deployment must set its own secret; never silently use the dev default.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production')
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'daybook-dev-secret-change-me'

export function createApp(): express.Express {
  const app = express()
  app.use(express.json({ limit: '5mb' })) // CSV imports can be large

  app.use(
    session({
      store: new SqliteSessionStore(getDb()),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // home network is HTTP; revisit when TLS lands
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      },
    }),
  )

  // Public routes (no auth required).
  app.use('/api', healthRouter)
  app.use('/api', authRouter)
  if (process.env.DAYBOOK_TEST === '1') {
    app.use('/api', testRouter)
  }

  // Everything below requires an authenticated session.
  app.use('/api', requireAuth)
  app.use('/api', tasksRouter)
  app.use('/api', walletRouter)
  app.use('/api', groupsRouter)
  app.use('/api', settlementsRouter)
  app.use('/api', settingsRouter)

  // Production: serve the built frontend from this same process so the SPA and
  // the API share one origin (no CORS, no separate static server). Skipped in
  // dev — Vite serves the frontend and proxies /api here. Only active once
  // `npm run build` has produced dist/.
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR))
    // SPA fallback: any non-API GET that didn't match a static file gets
    // index.html so client-side routing works on deep links / refresh.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(resolve(DIST_DIR, 'index.html'))
    })
  }

  return app
}

// Start the server only when run directly (not when imported by tests).
// Use realpathSync on both sides so symlinks (e.g. ~/daybook/current →
// releases/vX.Y.Z/) don't cause a false mismatch.
const isMain = (() => {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
})()
if (isMain) {
  getDb() // initialise schema before accepting requests
  const app = createApp()
  app.listen(PORT, HOST, () => {
    const where = HOST === '0.0.0.0' ? `all interfaces, port ${PORT}` : `${HOST}:${PORT}`
    console.log(`Daybook listening on ${where}`)
  })
}
