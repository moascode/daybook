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

/** Epic-level supporting documents. Not items; carry no ID; absent from the index. */
const SUPPORTING = new Set(['design.md', 'data-model.md'])

/** Every ID mentioned anywhere under docs/ — live, scheduled, shipped or dropped. */
function allIds() {
  const ids = new Set()
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        for (const m of e.name.matchAll(/^(EP)-(\d{2})/g)) ids.add(`${m[1]}-${m[2]}`)
        walk(p)
      } else if (e.name.endsWith('.md')) {
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

  // Layout: docs/backlog/EP-NN-slug/README.md is the epic; every other .md in
  // that folder is one of its items. The folder IS the epic membership, so an
  // item cannot drift away from its epic the way a metadata field can.
  const filed = new Map()
  const epicOf = new Map()
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const em = entry.name.match(/^(EP)-(\d{2})-/)
    if (!em) { problems.push(`${entry.name}/: not a valid epic folder (expected EP-NN-slug/)`); continue }
    const epicId = `${em[1]}-${em[2]}`
    const dir = path.join(ROOT, entry.name)
    if (!existsSync(path.join(dir, 'README.md'))) {
      problems.push(`${entry.name}/: has no README.md — every epic folder needs one`)
    } else {
      filed.set(epicId, path.join(dir, 'README.md'))
    }
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue
      // Supporting documents an epic may carry: the design thinking behind it,
      // and a data model when it needs one. A single item may carry its own
      // design as <ITEM-ID>-design.md. These are how-docs, not items — they
      // never get an ID and never appear in the index.
      if (SUPPORTING.has(name) || /^(?:FEAT|BUG|IDEA)-\d{3}-design\.md$/.test(name)) continue
      const m = name.match(/^(FEAT|BUG|IDEA)-(\d{3})-/)
      if (!m) {
        problems.push(
          `${entry.name}/${name}: not an item (EP-scoped IDs look like FEAT-123-slug.md) ` +
            `and not a recognised supporting doc (${[...SUPPORTING].join(', ')}, or <ITEM-ID>-design.md)`,
        )
        continue
      }
      const id = `${m[1]}-${m[2]}`
      filed.set(id, path.join(dir, name))
      epicOf.set(id, epicId)
    }
  }

  for (const [id, file] of filed) {
    if (!indexed.has(id)) problems.push(`${id} has a file (${file}) but no row in ${INDEX}`)
    // Every item belongs to an epic. An item with no epic has nowhere its
    // continued relevance gets reviewed, which is the question the backlog
    // exists to answer — so "no epic" is a tracking gap, not a shortcut.
    if (id.startsWith('EP-')) continue
    // Membership is the folder. The header must agree with it, or the item
    // says one thing and lives somewhere else.
    const head = readFileSync(file, 'utf8').split('\n').slice(0, 3).join('\n')
    const epic = head.match(/\*\*Epic:\*\*\s*(.+?)\s*(?:·|$)/m)
    if (!epic || !/EP-\d{2}/.test(epic[1])) {
      problems.push(`${id} (${file}) has no "**Epic:**" field naming an EP-NN. Every item belongs to an epic.`)
    } else {
      const declared = epic[1].match(/EP-\d{2}/)[0]
      if (declared !== epicOf.get(id)) {
        problems.push(`${id} (${file}) declares ${declared} but lives in ${epicOf.get(id)}'s folder`)
      }
    }
  }
  for (const id of indexed) {
    if (!filed.has(id) && !/\barchive\b/.test(index)) continue
  }
  // A row pointing at a file that isn't there is the worse direction — catch it.
  for (const m of index.matchAll(/\]\((EP-\d{2}-[a-z0-9-]+\/[^)]+\.md)\)/g)) {
    if (!existsSync(path.join(ROOT, m[1]))) problems.push(`${INDEX} links ${m[1]}, which does not exist`)
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
