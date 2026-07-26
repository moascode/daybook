#!/usr/bin/env node
// Dump the server's SQLite data as SQL files that `wrangler d1 execute --file`
// can load into D1 (Phase 2, docs/option-2-workers-d1-plan.md).
//
//   node scripts/export-to-d1.mjs                     # auto-locate the DB
//   node scripts/export-to-d1.mjs --db path/to.db --out dir/
//
// Schema is NOT emitted — `wrangler d1 migrations apply` owns that, and
// scripts/schema-diff.mjs proves the two agree. This writes data only.
//
// Safety: the source is opened **read-only** and immediately snapshotted with
// VACUUM INTO, so a live server mid-write cannot produce a torn export and this
// script cannot alter production data. Everything downstream reads the snapshot.

import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

const DB_PATH =
  argOf('--db') ??
  process.env.DAYBOOK_DB_PATH ??
  (process.env.DAYBOOK_HOME
    ? join(process.env.DAYBOOK_HOME, 'shared', 'data', 'daybook.db')
    : join(process.env.HOME, 'daybook', 'shared', 'data', 'daybook.db'))

const OUT_DIR = resolve(argOf('--out') ?? 'd1-export')

// Statements per file. S2 measured 5,000 inserts in one batch with ~10×
// headroom, so this is conservative — it keeps each file quick to retry after
// the transient `error code: 1104` S2 saw once.
const CHUNK = 500

// Which accounts to migrate. `--users kakon,tumpa` exports only those users and
// the rows reachable from them; omitting the flag exports everything.
//
// This exists because the production database contains 273 `e2e_*` accounts —
// the suite was pointed at it on 2026-05-31 (see scripts/analyse-users.mjs).
// Migrating those would carry throwaway accounts with predictable passwords onto
// a publicly reachable deployment, and burn D1's free-tier write quota.
const userFilter = argOf('--users')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** SQL literal for a value read out of SQLite. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite numeric value: ${v}`)
    return String(v)
  }
  if (typeof v === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

// ── consistent snapshot ──
const tmp = mkdtempSync(join(tmpdir(), 'daybook-export-'))
const snapPath = join(tmp, 'snapshot.db')

const live = new Database(DB_PATH, { readonly: true, fileMustExist: true })
live.exec(`VACUUM INTO '${snapPath.replace(/'/g, "''")}'`)
live.close()

const db = new Database(snapPath, { readonly: true })

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const existing = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
)

// ── table order + per-table row filter ──
// Dependency order: parents before children, so foreign keys hold at every step
// of the load. `sessions` is deliberately excluded — rows are ephemeral and
// Phase 3 replaces express-session's store with a D1-backed one.
//
// Each `where` narrows the table to rows reachable from the kept users. Note
// that most are keyed on user_id, but the sharing tables are not: groups hang
// off created_by, settlements off from_user/to_user, and account_shares and
// settlement_split_lines have no user column at all and must be reached through
// their parents. Getting one of these wrong produces a foreign-key failure at
// import, which is exactly what the local round-trip is there to catch.
function buildTables() {
  if (!userFilter) return TABLE_ORDER.map((name) => ({ name, where: '' }))

  const ids = db
    .prepare(
      `SELECT id, username FROM users WHERE username IN (${userFilter.map(() => '?').join(',')})`,
    )
    .all(...userFilter)

  const missing = userFilter.filter((u) => !ids.some((r) => r.username === u))
  if (missing.length) throw new Error(`no such user(s) in source database: ${missing.join(', ')}`)

  const U = `(${ids.map((r) => lit(r.id)).join(', ')})`
  const KEPT_GROUPS = `(SELECT id FROM groups WHERE created_by IN ${U})`
  const KEPT_ACCOUNTS = `(SELECT id FROM accounts WHERE user_id IN ${U})`
  const KEPT_TXNS = `(SELECT id FROM transactions WHERE user_id IN ${U})`
  const KEPT_SPLITS = `(SELECT id FROM transaction_splits WHERE user_id IN ${U})`
  const KEPT_SETTLEMENTS = `(SELECT id FROM settlements WHERE from_user IN ${U} AND to_user IN ${U})`

  const WHERE = {
    users: `id IN ${U}`,
    groups: `created_by IN ${U}`,
    group_members: `user_id IN ${U} AND group_id IN ${KEPT_GROUPS}`,
    group_invites: `invitee_id IN ${U} AND invited_by IN ${U} AND group_id IN ${KEPT_GROUPS}`,
    account_shares: `account_id IN ${KEPT_ACCOUNTS} AND group_id IN ${KEPT_GROUPS}`,
    transaction_splits: `user_id IN ${U} AND transaction_id IN ${KEPT_TXNS}`,
    settlements: `from_user IN ${U} AND to_user IN ${U} AND group_id IN ${KEPT_GROUPS}`,
    settlement_split_lines: `settlement_id IN ${KEPT_SETTLEMENTS} AND share_id IN ${KEPT_SPLITS}`,
  }

  console.log(`Exporting ${ids.length} user(s): ${ids.map((r) => r.username).join(', ')}\n`)
  return TABLE_ORDER.map((name) => ({ name, where: WHERE[name] ?? `user_id IN ${U}` }))
}

const TABLE_ORDER = [
  'users',
  'categories',
  'accounts',
  'tasks',
  'task_templates',
  'transactions',
  'settings',
  'budgets',
  'recurring_transactions',
  'goals',
  'groups',
  'group_members',
  'group_invites',
  'account_shares',
  'transaction_splits',
  'settlements',
  'settlement_split_lines',
  'absorbed_import_hashes',
]

const TABLES = buildTables()

const counts = {}
let fileIndex = 0
let totalRows = 0

try {
  for (const { name: table, where } of TABLES) {
    if (!existing.has(table)) {
      console.warn(`  (skipping ${table} — not present in source)`)
      continue
    }

    let rows = db.prepare(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''}`).all()
    counts[table] = rows.length
    totalRows += rows.length
    if (rows.length === 0) continue

    // tasks.parent_id references tasks.id, so a child inserted before its
    // parent violates the FK. Order by depth: roots first, then each level.
    if (table === 'tasks') rows = orderByParentDepth(rows)

    const cols = Object.keys(rows[0])
    const colList = cols.map((c) => `"${c}"`).join(', ')

    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const stmts = slice.map(
        (r) => `INSERT INTO "${table}" (${colList}) VALUES (${cols.map((c) => lit(r[c])).join(', ')});`,
      )
      const part = rows.length > CHUNK ? `_part${String(i / CHUNK + 1).padStart(3, '0')}` : ''
      const name = `${String(++fileIndex).padStart(3, '0')}_${table}${part}.sql`
      writeFileSync(join(OUT_DIR, name), stmts.join('\n') + '\n')
    }
  }
} finally {
  db.close()
  rmSync(tmp, { recursive: true, force: true })
}

/** Topological order for a self-referencing parent_id tree. */
function orderByParentDepth(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depth = new Map()
  const depthOf = (row, seen = new Set()) => {
    if (depth.has(row.id)) return depth.get(row.id)
    // A missing or cyclic parent is treated as a root — the FK still holds and
    // a cycle would otherwise hang this walk.
    if (row.parent_id == null || !byId.has(row.parent_id) || seen.has(row.id)) {
      depth.set(row.id, 0)
      return 0
    }
    seen.add(row.id)
    const d = depthOf(byId.get(row.parent_id), seen) + 1
    depth.set(row.id, d)
    return d
  }
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b))
}

writeFileSync(join(OUT_DIR, 'row-counts.json'), JSON.stringify(counts, null, 2) + '\n')

console.log(`Source:  ${DB_PATH}`)
console.log(`Output:  ${OUT_DIR}  (${fileIndex} file${fileIndex === 1 ? '' : 's'}, ${totalRows} rows)\n`)
for (const [t, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(6)}  ${t}`)
console.log(`
Load in filename order, then verify:
  for f in ${OUT_DIR}/[0-9]*.sql; do npx wrangler d1 execute daybook --local --file "$f" || break; done
  node scripts/verify-import.mjs

NOTE: users.password_hash is exported as bcrypt. The Worker verifies PBKDF2
(Phase 3), so those hashes cannot authenticate — both accounts need new
passwords set after import (M6).`)
