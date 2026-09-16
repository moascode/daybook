#!/usr/bin/env node
/**
 * Markdown link checker.
 *
 * Why this exists: a previous docs reorganisation moved files into `docs/v1/`
 * and left 22 links pointing at their old paths — nine of them in
 * `project-history.md` alone. Nothing caught it, because a dead relative link
 * in Markdown fails silently and only when a human clicks it. CI runs this so
 * the next reorg cannot do the same thing.
 *
 * A link is resolved against `git ls-files`, not against the filesystem, so a
 * link into a gitignored directory (`docs/**\/.flow/`, `node_modules/`) is an
 * error: it resolves on the author's machine and nowhere else.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Cached + untracked-but-not-ignored. Untracked files must be included or a
 * brand-new doc is invisible to this check on the machine that wrote it, and
 * only fails once CI sees it — the slowest possible way to learn.
 */
const tracked = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean),
)

/** Link targets that are intentionally absent — external checkouts, generated output. */
const ALLOWED_MISSING = new Set([])

/** `[text](target)` where target ends in .md/.pdf, plus bare in-prose `docs/…` paths. */
const INLINE_LINK = /\]\(\s*([^)\s]+?\.(?:md|pdf))(?:\s+"[^"]*")?\s*\)/g
const BARE_DOC_PATH = /(?<![\w/`.-])(docs\/[A-Za-z0-9/_.-]+\.(?:md|pdf))/g

const docs = [...tracked].filter((f) => f.endsWith('.md'))
const failures = []

for (const file of docs) {
  const body = readFileSync(file, 'utf8')
  // Don't lint inside fenced code blocks — they show example paths, not links.
  const prose = body.replace(/```[\s\S]*?```/g, '')
  const dir = path.dirname(file)
  const seen = new Set()

  const record = (raw, resolved) => {
    if (seen.has(resolved) || tracked.has(resolved) || ALLOWED_MISSING.has(resolved)) return
    seen.add(resolved)
    const line = body.split('\n').findIndex((l) => l.includes(raw)) + 1
    failures.push({ file, line, raw, resolved })
  }

  for (const [, target] of prose.matchAll(INLINE_LINK)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue
    record(target, path.normalize(path.join(dir, target)))
  }
  for (const [, target] of prose.matchAll(BARE_DOC_PATH)) record(target, target)
}

if (failures.length === 0) {
  console.log(`doc-links: ${docs.length} files, no broken links.`)
  process.exit(0)
}

console.error(`doc-links: ${failures.length} broken link(s) in ${docs.length} files\n`)
let current = null
for (const f of failures) {
  if (f.file !== current) { console.error(`  ${f.file}`); current = f.file }
  console.error(`    :${f.line}  ${f.raw}  ->  ${f.resolved}  (not tracked in git)`)
}
console.error('\nFix the link, or add the target to ALLOWED_MISSING with a reason.')
process.exit(1)
