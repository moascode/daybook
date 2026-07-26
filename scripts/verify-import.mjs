#!/usr/bin/env node
// Compare per-table row counts in D1 against the counts recorded by
// scripts/export-to-d1.mjs. This is the Phase 2 exit criterion: "a full data
// import round-trips with matching row counts per table".
//
//   node scripts/verify-import.mjs                    # against local D1
//   node scripts/verify-import.mjs --remote           # against production D1
//   node scripts/verify-import.mjs --in d1-export/
//
// Exits non-zero on any mismatch.
//
// Row counts catch a dropped or duplicated file, which is the realistic import
// failure. They do not prove field-level fidelity — a truncated string would
// pass. Phase 7 re-runs this immediately before cutover, when the export is
// minutes old and the source is still available for a spot check.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

const remote = args.includes('--remote')
const IN_DIR = resolve(argOf('--in') ?? 'd1-export')

const expected = JSON.parse(readFileSync(join(IN_DIR, 'row-counts.json'), 'utf8'))
const tables = Object.keys(expected)

// One query, not one per table — each `d1 execute` is a round trip.
//
// Scalar subqueries rather than `UNION ALL`: D1 enforces a low
// SQLITE_MAX_COMPOUND_SELECT and rejects an 18-term union outright with
// "too many terms in compound SELECT". Projecting one column per table sidesteps
// the limit and returns a single row.
const query = `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(', ')}`

const raw = execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'daybook', remote ? '--remote' : '--local', '--json', '--command', query],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
)
const parsed = JSON.parse(raw.slice(raw.indexOf('[')))
const row = parsed[0].results[0]
const actual = Object.fromEntries(tables.map((t) => [t, Number(row[t])]))

const where = remote ? 'remote' : 'local'
const problems = []
for (const t of tables) {
  if (actual[t] !== expected[t]) {
    problems.push(`  ${t}: expected ${expected[t]}, D1 has ${actual[t] ?? 0}`)
  }
}

if (problems.length) {
  console.error(`✘ row-count mismatch against ${where} D1:\n${problems.join('\n')}`)
  process.exit(1)
}

const total = Object.values(expected).reduce((a, b) => a + b, 0)
console.log(`✔ ${where} D1 row counts match the export — ${total} rows across ${tables.length} tables`)
