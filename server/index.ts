import express from 'express'
import session from 'express-session'
import { getDb } from './db.ts'
import { SqliteSessionStore } from './session-store.ts'
import { healthRouter } from './routes/health.ts'
import { authRouter, requireAuth } from './routes/auth.ts'
import { tasksRouter } from './routes/tasks.ts'
import { walletRouter } from './routes/wallet.ts'
import { settingsRouter } from './routes/settings.ts'
import { testRouter } from './routes/test.ts'

const PORT = Number(process.env.PORT ?? 3001)

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
  app.use('/api', settingsRouter)

  return app
}

// Start the server only when run directly (not when imported by tests).
const isMain = process.argv[1] === new URL(import.meta.url).pathname
if (isMain) {
  getDb() // initialise schema before accepting requests
  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Daybook API listening on http://localhost:${PORT}`)
  })
}
