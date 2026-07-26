#!/usr/bin/env node
// Compare the D1 schema against the schema the server's own migration runner
// produces, so the two backends cannot silently diverge while both exist
// (Phase 2 verification, docs/option-2-workers-d1-plan.md).
//
//   node scripts/schema-diff.mjs            # against local (Miniflare) D1
//   node scripts/schema-diff.mjs --remote   # against production D1
//
// Exits non-zero on any difference, so CI can gate on it.
//
// The reference side is built by running server/db.ts against a throwaway file,
// which means this compares *the real runner's output*, not a re-reading of the
// same .sql files — a transcription error in worker/migrations/ would show up.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const remote = process.argv.includes('--remote')

// Bookkeeping tables, not app schema: schema_migrations is the Node runner's
// ledger, d1_migrations is wrangler's, _cf_* and sqlite_* are platform-internal.
const IGNORED = /^(schema_migrations|d1_migrations|_cf_.*|sqlite_.*)$/

/**
 * Whitespace- and comment-insensitive, so formatting differences aren't
 * reported as drift.
 *
 * Stripping comments is required, not cosmetic: **D1 removes SQL comments from
 * the DDL it stores in sqlite_master**, while SQLite keeps them verbatim. Every
 * table carrying an inline `-- 'owner' | 'member'`-style note would otherwise
 * report as differing when the columns are in fact identical.
 *
 * Line comments must go before whitespace is collapsed — flatten first and a
 * `--` would swallow the remainder of the statement.
 */
function normalise(sql) {
  return (sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' ') // line comments (pre-flatten)
    .replace(/\s+/g, ' ')
    .trim()
}

function collect(rows) {
  const out = new Map()
  for (const { name, sql } of rows) {
    if (IGNORED.test(name)) continue
    // Auto-indexes (UNIQUE/PRIMARY KEY) have a null sql and are implied by the
    // table DDL that creates them; comparing them adds noise, not signal.
    if (sql == null) continue
    out.set(name, normalise(sql))
  }
  return out
}

const QUERY =
  "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"

// ── reference: run the server's migration runner into a throwaway file ──
const tmp = mkdtempSync(join(tmpdir(), 'daybook-schema-'))
const refPath = join(tmp, 'ref.db')
let reference
try {
  process.env.DAYBOOK_DB_PATH = refPath
  const { getDb } = await import('../server/db.ts')
  const db = getDb()
  reference = collect(db.prepare(QUERY).all())
  db.close()
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── subject: D1 ──
const args = ['wrangler', 'd1', 'execute', 'daybook', remote ? '--remote' : '--local', '--json', '--command', QUERY]
const raw = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
// wrangler prints a banner before the JSON payload on some versions.
const parsed = JSON.parse(raw.slice(raw.indexOf('[')))
const subject = collect(parsed[0].results)

// ── diff ──
const problems = []
for (const [name, sql] of reference) {
  if (!subject.has(name)) problems.push(`MISSING in D1:      ${name}`)
  else if (subject.get(name) !== sql) {
    problems.push(`DIFFERS:            ${name}\n  server: ${sql}\n  d1:     ${subject.get(name)}`)
  }
}
for (const name of subject.keys()) {
  if (!reference.has(name)) problems.push(`EXTRA in D1:        ${name}`)
}

const where = remote ? 'remote' : 'local'
if (problems.length) {
  console.error(`✘ schema drift between server/migrations and ${where} D1:\n`)
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`✔ ${where} D1 schema matches server/migrations — ${reference.size} objects compared`)
