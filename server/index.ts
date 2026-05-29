import express from 'express'
import { getDb } from './db.ts'
import { healthRouter } from './routes/health.ts'

const PORT = Number(process.env.PORT ?? 3001)

export function createApp(): express.Express {
  const app = express()
  app.use(express.json())

  // All API routes are mounted under /api (Vite dev-proxies this prefix).
  app.use('/api', healthRouter)

  return app
}

// Start the server only when run directly (not when imported by tests).
const isMain = process.argv[1] === new URL(import.meta.url).pathname
if (isMain) {
  getDb() // initialise schema + seed before accepting requests
  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Daybook API listening on http://localhost:${PORT}`)
  })
}
