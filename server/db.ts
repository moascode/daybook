import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────
// File-based migration runner.
//
// Migrations live in server/migrations/NNNN_description.sql and are applied
// in lexicographic order. Each is recorded in the schema_migrations table so
// it runs exactly once. Only ADD COLUMN / CREATE TABLE is allowed — never
// drop a table or column (SQLite doesn't support DROP COLUMN anyway).
//
// To add a schema change:
//   1. Create server/migrations/NNNN_description.sql
//   2. Write only additive DDL (ALTER TABLE … ADD COLUMN, CREATE TABLE IF NOT EXISTS)
//   3. Ship it in the next release — the runner applies it on first boot
// ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))

// DB_PATH resolution order:
//   1. DAYBOOK_DB_PATH env var   — e2e tests point at a throwaway file / :memory:
//   2. DAYBOOK_HOME env var      — production install at ~/daybook/shared/data/
//   3. Legacy .daybook/data/     — dev installs from previous version (auto-migrated)
//   4. Fallback: server/data/    — bare dev run with no env vars set
function resolveDbPath(): string {
  if (process.env.DAYBOOK_DB_PATH) return process.env.DAYBOOK_DB_PATH

  if (process.env.DAYBOOK_HOME) {
    return resolve(process.env.DAYBOOK_HOME, 'shared', 'data', 'daybook.db')
  }

  // Legacy path used by the previous .daybook/data/ location.
  const legacyDaybookData = resolve(__dirname, '..', '.daybook', 'data', 'daybook.db')
  if (existsSync(legacyDaybookData)) return legacyDaybookData

  // Bare dev fallback.
  return resolve(__dirname, 'data', 'daybook.db')
}

export type DB = Database.Database

let dbInstance: DB | null = null

export function getDb(): DB {
  if (dbInstance) return dbInstance

  const dbPath = resolveDbPath()

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })

    // One-time location migration: server/data/ → .daybook/data/ (previous fix).
    // If neither .daybook/data/ nor DAYBOOK_HOME is in play, move from legacy
    // server/data/ on first boot so an old dev install keeps its data.
    const serverDataPath = resolve(__dirname, 'data', 'daybook.db')
    if (
      !process.env.DAYBOOK_HOME &&
      !existsSync(dbPath) &&
      existsSync(serverDataPath) &&
      dbPath !== serverDataPath
    ) {
      renameSync(serverDataPath, dbPath)
    }
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  dbInstance = db
  return db
}

function runMigrations(db: Database.Database): void {
  // Bootstrap: schema_migrations table must exist before we can query it.
  // This is the only DDL we run outside of migration files.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = resolve(__dirname, 'migrations')
  if (!existsSync(migrationsDir)) return

  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (r) => r.name,
    ),
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = readFileSync(resolve(migrationsDir, file), 'utf8')

    // Run each migration in a transaction so a partial failure leaves the DB
    // clean and the error surfaces immediately on startup.
    db.transaction(() => {
      // Strip schema_migrations DDL from 0001 to avoid a "table already exists"
      // error when bootstrapping an existing DB that already has it.
      const cleaned = sql.replace(
        /CREATE TABLE IF NOT EXISTS schema_migrations[\s\S]*?;/,
        '',
      )
      db.exec(cleaned)
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file)
    })()
  }
}
