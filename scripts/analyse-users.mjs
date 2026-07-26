#!/usr/bin/env node
// Read-only census of the accounts in a Daybook SQLite database, to separate
// real users from e2e-suite residue before the Phase 7 migration.
//
//   node scripts/analyse-users.mjs [--db path/to.db]
//
// Every e2e spec signs up a throwaway user (e2e/helpers.ts newAppPage), and
// signup seeds 15 default categories per user — so a database that has had the
// suite pointed at it accumulates accounts fast. This tells you how many of the
// accounts own anything.
//
// Aggregates and usernames only: no transaction amounts, merchants, notes or
// password hashes are read or printed.
//
// The source is opened read-only and snapshotted with VACUUM INTO first, so a
// running server can neither be disturbed nor produce a torn read.

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const i = args.indexOf('--db')
const DB_PATH =
  (i === -1 ? undefined : args[i + 1]) ??
  process.env.DAYBOOK_DB_PATH ??
  (process.env.DAYBOOK_HOME
    ? join(process.env.DAYBOOK_HOME, 'shared', 'data', 'daybook.db')
    : join(process.env.HOME, 'daybook', 'shared', 'data', 'daybook.db'))

const tmp = mkdtempSync(join(tmpdir(), 'daybook-census-'))
const snap = join(tmp, 'snapshot.db')

const live = new Database(DB_PATH, { readonly: true, fileMustExist: true })
live.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`)
live.close()

const db = new Database(snap, { readonly: true })

try {
  const one = (sql) => db.prepare(sql).get()
  const all = (sql) => db.prepare(sql).all()

  console.log(`Source: ${DB_PATH}\n`)
  console.log(`Total users: ${one('SELECT COUNT(*) AS n FROM users').n}`)

  // "Owns anything" = has a transaction, task, or account. A user with only the
  // 15 auto-seeded categories has never actually used the app.
  const OWNS = `
    EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id)
    OR EXISTS (SELECT 1 FROM tasks t     WHERE t.user_id = u.id)
    OR EXISTS (SELECT 1 FROM accounts a  WHERE a.user_id = u.id)`

  console.log(`Users owning any transaction/task/account: ${one(`SELECT COUNT(*) AS n FROM users u WHERE ${OWNS}`).n}`)
  console.log(`Users owning nothing but seeded categories: ${one(`SELECT COUNT(*) AS n FROM users u WHERE NOT (${OWNS})`).n}`)

  const range = one('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM users')
  console.log(`Signup range: ${range.first} … ${range.last}`)

  // e2e/helpers.ts names its throwaway accounts `e2e_<timestamp>_<n>`, so
  // anything not matching that prefix is a human-created account.
  console.log('\nNon-e2e (human-created) accounts:')
  console.table(
    all(`
      SELECT u.username,
             u.created_at,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txns,
             (SELECT COUNT(*) FROM tasks       t WHERE t.user_id = u.id) AS tasks,
             (SELECT COUNT(*) FROM accounts    a WHERE a.user_id = u.id) AS accts
      FROM users u
      WHERE u.username NOT LIKE 'e2e\\_%' ESCAPE '\\'
      ORDER BY u.created_at`),
  )
  console.log(`e2e_* accounts: ${one("SELECT COUNT(*) AS n FROM users WHERE username LIKE 'e2e\\_%' ESCAPE '\\'").n}`)

  console.log('\nAccounts owning data, by volume:')
  console.table(
    all(`
      SELECT u.username,
             u.created_at,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txns,
             (SELECT COUNT(*) FROM tasks       t WHERE t.user_id = u.id) AS tasks,
             (SELECT COUNT(*) FROM accounts    a WHERE a.user_id = u.id) AS accts
      FROM users u
      WHERE ${OWNS}
      ORDER BY txns + tasks + accts DESC`),
  )
} finally {
  db.close()
  rmSync(tmp, { recursive: true, force: true })
}
