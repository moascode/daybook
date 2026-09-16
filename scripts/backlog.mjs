#!/usr/bin/env node
/**
 * Backlog bookkeeping.
 *
 *   node scripts/backlog.mjs next FEAT     → the next unused ID for a prefix
 *   node scripts/backlog.mjs check         → index and files agree (CI gate)
 *
 * The check exists because the backlog has two halves — an item file and a row
 * in `docs/backlog/README.md` — and an item with only one half is invisible
 * exactly when it matters. IDs are allocated from the highest ever used,
 * including IDs whose files have since moved to `archive/`, so a shipped
 * `FEAT-007` can never be reissued to something else.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = 'docs/backlog'
const INDEX = path.join(ROOT, 'README.md')
const PREFIXES = ['EP', 'FEAT', 'BUG', 'IDEA']

/** Every ID mentioned anywhere under docs/ — live, scheduled, shipped or dropped. */
function allIds() {
  const ids = new Set()
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/\b(EP|FEAT|BUG|IDEA)-(\d{2,3})\b/g)) {
          ids.add(`${m[1]}-${m[2]}`)
        }
        for (const m of e.name.matchAll(/^(EP|FEAT|BUG|IDEA)-(\d{2,3})/g)) ids.add(`${m[1]}-${m[2]}`)
      }
    }
  }
  if (existsSync('docs')) walk('docs')
  return ids
}

function next(prefix) {
  if (!PREFIXES.includes(prefix)) {
    console.error(`Unknown prefix "${prefix}". Use one of: ${PREFIXES.join(', ')}`)
    process.exit(1)
  }
  const width = prefix === 'EP' ? 2 : 3
  const used = [...allIds()]
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
  const n = (used.length ? Math.max(...used) : 0) + 1
  console.log(`${prefix}-${String(n).padStart(width, '0')}`)
}

function check() {
  const problems = []
  const index = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : ''
  const indexed = new Set([...index.matchAll(/\b(EP|FEAT|BUG|IDEA)-(\d{2,3})\b/g)].map((m) => `${m[1]}-${m[2]}`))

  const filed = new Map()
  for (const sub of ['epics', 'items']) {
    const dir = path.join(ROOT, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const m = name.match(/^(EP|FEAT|BUG|IDEA)-(\d{2,3})-/)
      if (!m) { problems.push(`${sub}/${name}: filename does not start with a valid ID`); continue }
      filed.set(`${m[1]}-${m[2]}`, path.join(dir, name))
    }
  }

  for (const [id, file] of filed) {
    if (!indexed.has(id)) problems.push(`${id} has a file (${file}) but no row in ${INDEX}`)
  }
  for (const id of indexed) {
    if (!filed.has(id) && !/\barchive\b/.test(index)) continue
  }
  // A row pointing at a file that isn't there is the worse direction — catch it.
  for (const m of index.matchAll(/\]\((epics|items)\/([^)]+\.md)\)/g)) {
    const p = path.join(ROOT, m[1], m[2])
    if (!existsSync(p)) problems.push(`${INDEX} links ${m[1]}/${m[2]}, which does not exist`)
  }

  if (problems.length) {
    console.error(`backlog: ${problems.length} problem(s)\n`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`backlog: ${filed.size} item(s), index consistent.`)
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'next') next(arg)
else if (cmd === 'check') check()
else {
  console.error('usage: backlog.mjs next <EP|FEAT|BUG|IDEA> | backlog.mjs check')
  process.exit(1)
}
