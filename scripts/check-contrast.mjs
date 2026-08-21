#!/usr/bin/env node
// WCAG-AA contrast gate for the generated theme (docs/v2/foundation/01 §6).
//
//   node scripts/check-contrast.mjs        # both themes; exits non-zero on any fail
//
// This is the gate that stops the failure REVIEW found in the previous design
// (a 2.54:1 subtitle, white-on-brand 3.39:1 primary button). It parses the
// GENERATED src/index.css — not the mockup — so it enforces what actually ships
// and catches the first time someone tunes a neutral by eye.
//
// How it works: the theme is a var() graph. src/index.css declares primitives
// on :root, then the semantic roles per theme ([data-theme='light'] and
// [data-theme='dark']). We resolve every foreground role to RGB in each theme,
// pair it against the backgrounds it is actually rendered on, and compute the
// WCAG contrast ratio.
//
// Thresholds: 4.5:1 (WCAG AA normal text), except the decoration-only roles
// --fg-faint and --on-ink-dim, which must clear 3.0:1 (WCAG AA non-text / large).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(root, 'src/index.css'), 'utf8')

// ── Parse ──────────────────────────────────────────────────────────────────
// Strip comments first, then pull each token block by its selector. The theme
// blocks contain only flat `--x: y;` declarations (no nested braces), so a
// brace-free capture is exact.
const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function block(re) {
  const m = clean.match(re)
  if (!m) throw new Error(`token block not found: ${re}`)
  const out = {}
  for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[d[1]] = d[2].trim()
  }
  return out
}

// :root { … }  — the primitive + scale layer, theme-independent.
const PRIMITIVES = block(/:root\s*\{([^{}]*)\}/)
// :root, [data-theme='light'] { … } and .dark, [data-theme='dark'] { … }
const LIGHT = block(/\[data-theme=['"]light['"]\]\s*\{([^{}]*)\}/)
const DARK = block(/\[data-theme=['"]dark['"]\]\s*\{([^{}]*)\}/)

const ENV = {
  light: { ...PRIMITIVES, ...LIGHT },
  dark: { ...PRIMITIVES, ...DARK },
}

// ── Resolve a token to an [r,g,b] triple, following var() chains ─────────────
function resolve(name, vars, seen = new Set()) {
  if (seen.has(name)) return null // cycle guard
  seen.add(name)
  const val = vars[name]
  if (val == null) return null
  const triple = val.match(/^(\d+)\s+(\d+)\s+(\d+)$/)
  if (triple) return [Number(triple[1]), Number(triple[2]), Number(triple[3])]
  const ref = val.match(/^var\(\s*--([\w-]+)\s*\)$/)
  if (ref) return resolve(ref[1], vars, seen)
  return null // a shadow, a scale (px), or a compound value — not a colour
}

// ── WCAG relative luminance + contrast ───────────────────────────────────────
function luminance([r, g, b]) {
  const c = [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// ── The check matrix ─────────────────────────────────────────────────────────
// `anchor to identity, assert on behaviour`: each foreground role is checked
// against the backgrounds it is genuinely rendered on. min is 4.5 unless the
// role is decoration-only.
const NEUTRAL_BGS = ['canvas', 'surface', 'surface-sunk']
const RELAXED = new Set(['fg-faint', 'on-ink-dim']) // 3.0:1, decoration / dim only
const HUES = ['accent', 'pos', 'neg', 'warn', 'info', 'alt', 'calm']

function pairs() {
  const list = []
  // Neutral text on neutral surfaces.
  for (const fg of ['fg', 'fg-muted', 'fg-subtle', 'fg-faint']) {
    for (const bg of NEUTRAL_BGS) list.push([fg, bg])
  }
  // Inverted chrome (toasts, tooltips, ink primary button).
  list.push(['on-ink', 'ink'], ['on-ink-dim', 'ink'])
  // Each hue role's own text on its own tint, plus on the two card surfaces
  // where chips/coloured text actually sit.
  for (const h of HUES) {
    list.push([`${h}-fg`, `${h}-bg`])
    list.push([`${h}-fg`, 'surface'])
    list.push([`${h}-fg`, 'canvas'])
  }
  return list
}

// ── Run ──────────────────────────────────────────────────────────────────────
const rows = []
let failures = 0
let missing = 0

for (const theme of ['light', 'dark']) {
  const vars = ENV[theme]
  for (const [fgName, bgName] of pairs()) {
    const fg = resolve(fgName, vars)
    const bg = resolve(bgName, vars)
    if (!fg || !bg) {
      missing++
      rows.push({ theme, fg: fgName, bg: bgName, ratio: null, min: null, ok: false })
      continue
    }
    const min = RELAXED.has(fgName) ? 3.0 : 4.5
    const ratio = contrast(fg, bg)
    const ok = ratio >= min
    if (!ok) failures++
    rows.push({ theme, fg: fgName, bg: bgName, ratio, min, ok })
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log('\nWCAG-AA contrast — generated theme (src/index.css)\n')
console.log(`  ${pad('theme', 6)} ${pad('foreground', 14)} ${pad('background', 14)} ${pad('ratio', 7)} min   result`)
console.log(`  ${'-'.repeat(60)}`)
for (const r of rows) {
  const ratio = r.ratio == null ? ' n/a ' : r.ratio.toFixed(2)
  const mark = r.ratio == null ? 'MISSING' : r.ok ? 'ok' : 'FAIL'
  const line = `  ${pad(r.theme, 6)} ${pad(r.fg, 14)} ${pad(r.bg, 14)} ${pad(ratio, 7)} ${pad(r.min ?? '-', 5)} ${mark}`
  console.log(r.ok ? line : `\x1b[31m${line}\x1b[0m`)
}

console.log('')
if (missing) {
  console.error(`✘ ${missing} pair(s) referenced a token that did not resolve to a colour — check the token names above.`)
}
if (failures) {
  console.error(`✘ ${failures} pair(s) below the AA threshold. Fix the ramp in scripts/gen-theme-tokens.mjs and re-run npm run gen:tokens.`)
}
if (failures || missing) {
  process.exit(1)
}
console.log(`✔ all ${rows.length} pairs pass (4.5:1, or 3.0:1 for ${[...RELAXED].join(', ')}).`)
