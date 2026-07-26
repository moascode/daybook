#!/usr/bin/env node
// Delete the e2e test accounts that were created in the production database
// when the Playwright suite was pointed at the live server (2026-05-31).
//
//   node scripts/purge-e2e-users.mjs              # dry run — reports, deletes nothing
//   node scripts/purge-e2e-users.mjs --confirm    # actually delete
//   node scripts/purge-e2e-users.mjs --db path/to.db
//
// Targets ONLY usernames matching `e2e\_%` — the shape e2e/helpers.ts generates
// (`e2e_<timestamp>_<n>`). Every one of them has the password 'test-password',
// hardcoded at e2e/helpers.ts:21, so they are live credentials, not inert rows.
//
// Deletion is a single `DELETE FROM users`; every dependent table declares
// `ON DELETE CASCADE` on its user_id, so the children go with them.

import Database from 'better-sqlite3'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (f) => {
  const i = args.indexOf(f)
  return i === -1 ? undefined : args[i + 1]
}
const confirm = args.includes('--confirm')

const DB_PATH =
  argOf('--db') ??
  process.env.DAYBOOK_DB_PATH ??
  (process.env.DAYBOOK_HOME
    ? join(process.env.DAYBOOK_HOME, 'shared', 'data', 'daybook.db')
    : join(process.env.HOME, 'daybook', 'shared', 'data', 'daybook.db'))

const MATCH = String.raw`username LIKE 'e2e\_%' ESCAPE '\'`

const db = new Database(DB_PATH, { fileMustExist: true })

// **Not optional.** better-sqlite3 opens with foreign keys OFF unless asked
// (server/db.ts:70 sets it per connection). Without this the DELETE succeeds and
// silently orphans every child row instead of cascading — the database would end
// up in a worse state than before the purge.
db.pragma('foreign_keys = ON')
if (db.pragma('foreign_keys', { simple: true }) !== 1) {
  console.error('✘ could not enable foreign_keys — refusing to run')
  process.exit(1)
}

const one = (sql) => db.prepare(sql).get()
const all = (sql) => db.prepare(sql).all()

const victims = one(`SELECT COUNT(*) AS n FROM users WHERE ${MATCH}`).n
const keep = one(`SELECT COUNT(*) AS n FROM users WHERE NOT (${MATCH})`).n

console.log(`Database: ${DB_PATH}`)
console.log(`\nMatching e2e accounts: ${victims}`)
console.log(`Accounts to keep:      ${keep}`)
console.log('\nAccounts that will be KEPT:')
console.table(all(`SELECT username, created_at FROM users WHERE NOT (${MATCH}) ORDER BY created_at`))

if (victims === 0) {
  console.log('Nothing to purge.')
  process.exit(0)
}

// ── Safety check: does any e2e account share a row with a real account? ──
//
// Cascade deletes follow foreign keys blindly. If a settlement had a real user
// on one side and an e2e user on the other, deleting the e2e user would take a
// REAL user's settlement with it. The sharing tables are the only place that can
// happen, so check every one before touching anything.
const E2E = `(SELECT id FROM users WHERE ${MATCH})`
const REAL = `(SELECT id FROM users WHERE NOT (${MATCH}))`

const entanglements = [
  [
    'settlements between a real user and an e2e user',
    `SELECT COUNT(*) AS n FROM settlements
      WHERE (from_user IN ${E2E} AND to_user IN ${REAL})
         OR (from_user IN ${REAL} AND to_user IN ${E2E})`,
  ],
  [
    'groups created by a real user with e2e members',
    `SELECT COUNT(*) AS n FROM group_members
      WHERE user_id IN ${E2E} AND group_id IN (SELECT id FROM groups WHERE created_by IN ${REAL})`,
  ],
  [
    'groups created by an e2e user with real members',
    `SELECT COUNT(*) AS n FROM group_members
      WHERE user_id IN ${REAL} AND group_id IN (SELECT id FROM groups WHERE created_by IN ${E2E})`,
  ],
  [
    "splits held by an e2e user on a real user's transaction",
    `SELECT COUNT(*) AS n FROM transaction_splits
      WHERE user_id IN ${E2E} AND transaction_id IN (SELECT id FROM transactions WHERE user_id IN ${REAL})`,
  ],
  [
    "splits held by a real user on an e2e user's transaction",
    `SELECT COUNT(*) AS n FROM transaction_splits
      WHERE user_id IN ${REAL} AND transaction_id IN (SELECT id FROM transactions WHERE user_id IN ${E2E})`,
  ],
  [
    "real accounts shared into an e2e user's group",
    `SELECT COUNT(*) AS n FROM account_shares
      WHERE account_id IN (SELECT id FROM accounts WHERE user_id IN ${REAL})
        AND group_id  IN (SELECT id FROM groups   WHERE created_by IN ${E2E})`,
  ],
]

console.log('\nEntanglement checks (real data that a cascade could take with it):')
let entangled = 0
for (const [label, sql] of entanglements) {
  const n = one(sql).n
  entangled += n
  console.log(`  ${n === 0 ? '✔' : '⚠'} ${String(n).padStart(4)}  ${label}`)
}

if (entangled > 0) {
  console.error(
    `\n✘ ${entangled} row(s) link e2e accounts to real accounts. Deleting would cascade into` +
      ` real user data. Refusing to run — resolve these by hand first.`,
  )
  process.exit(1)
}

if (!confirm) {
  console.log('\nDry run — nothing deleted. Re-run with --confirm to apply.')
  process.exit(0)
}

// ── Backup, then delete ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${DB_PATH}.pre-e2e-purge-${stamp}`
// Checkpoint the WAL first so the copied file is complete on its own.
db.pragma('wal_checkpoint(TRUNCATE)')
copyFileSync(DB_PATH, backup)
console.log(`\nBackup: ${backup}`)

const before = one('SELECT COUNT(*) AS n FROM users').n
const info = db.transaction(() => db.prepare(`DELETE FROM users WHERE ${MATCH}`).run())()
const after = one('SELECT COUNT(*) AS n FROM users').n

console.log(`\nDeleted ${info.changes} user rows (${before} → ${after}).`)

const orphans = db.pragma('foreign_key_check')
if (orphans.length) {
  console.error(`✘ foreign_key_check reports ${orphans.length} violation(s) — restore from ${backup}`)
  process.exit(1)
}
console.log('✔ foreign_key_check clean — cascades completed correctly.')

db.close()
