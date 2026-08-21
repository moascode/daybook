#!/usr/bin/env node
// Regenerates src/index.css — the single definition of both themes.
//
// Run: npm run gen:tokens
//
// ─────────────────────────────────────────────────────────────────────────
//  R1 (v2): the model is now TWO LAYERS (docs/v2/foundation/01-design-tokens.md).
//
//    PRIMITIVES   --n-*  one cool-grey ramp, theme-independent
//                 --g-*  one continuous emerald (hue ~162, no seam)
//                 --r/a/b/v/t-*  five supporting hues
//                        ↓  never referenced by a component
//    SEMANTICS    --canvas --surface --ink --fg-* --line-* --accent-*
//                 --pos/neg/warn/info/alt/calm (× -fg -bg -bd) --grid --track
//                 --e1/2/3 --ring
//                        ↓  the only layer components/CSS touch
//    SCALES       --s* (space) --t-* (type) --r-* (radius) --ease --dur-*
//
//  Dark mode is a RE-MAP of semantic roles onto the same primitive ramps, not
//  an inversion of ramps. That is why a component can never express the
//  `dark:` double-inversion trap (CLAUDE.md §18) under this model.
//
//  Backwards compatibility: every semantic name the old one-layer model
//  exposed (--surface-sunken, --surface-inverted, --fg-inverted, …) is still
//  emitted as an ALIAS of its v2 replacement, and the legacy numeric accent
//  ramps (--c-red-* …) are kept unchanged for one release so `bg-red-600` and
//  friends keep working until the module reskins migrate them to hue roles.
//  The one legacy ramp that changes VALUE is --c-brand-*, re-hued onto --g-*
//  (the seam fix) while keeping its mirrored dark behaviour so existing
//  bg-brand-* usages render as before, just on the corrected emerald.
//
//  Edit this file, never src/index.css.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import colors from 'tailwindcss/colors.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── Primitives (transcribed verbatim from proposal-v2/theme.css §1) ────────
const N = {
  0: '255 255 255', 25: '250 251 252', 50: '246 247 249', 100: '240 242 245',
  150: '233 236 241', 200: '225 229 235', 300: '203 209 219', 400: '156 165 179',
  500: '122 132 148', 600: '93 103 119', 700: '67 76 90', 800: '42 49 60',
  850: '30 35 44', 900: '22 26 33', 950: '14 17 22', 1000: '9 11 15',
}
const G = {
  50: '236 250 245', 100: '208 243 229', 200: '165 231 206', 300: '108 213 177',
  400: '52 190 146', 500: '16 163 122', 600: '10 133 100', 700: '11 106 81',
  800: '13 85 66', 900: '13 69 55', 950: '3 38 30',
}
// supporting hues — five, seven steps each (100 200 400 500 600 700 950)
const HUES = {
  r: { 100: '254 226 226', 200: '254 202 202', 400: '239 93 93', 500: '219 50 50', 600: '190 35 35', 700: '154 28 28', 950: '60 12 12' },
  a: { 100: '253 238 205', 200: '250 223 165', 400: '233 160 33', 500: '202 133 16', 600: '168 109 10', 700: '133 85 8', 950: '52 32 4' },
  b: { 100: '219 233 254', 200: '191 216 254', 400: '92 145 246', 500: '47 111 235', 600: '33 89 205', 700: '29 71 165', 950: '16 30 66' },
  v: { 100: '233 226 255', 200: '214 203 254', 400: '149 122 246', 500: '118 84 235', 600: '97 62 205', 700: '78 50 165', 950: '32 22 68' },
  t: { 100: '205 240 240', 200: '168 228 229', 400: '45 176 178', 500: '20 148 150', 600: '15 119 121', 700: '16 95 97', 950: '6 40 41' },
}

// ── Legacy accent ramps (kept for one release; see header) ─────────────────
// brand is re-hued onto --g-* (the seam fix). The 11-step ramp draws from the
// emerald primitives; steps the primitive ramp doesn't carry fall back to the
// nearest neighbour so bg-brand-{300,600,…} keep resolving.
const brand = { 50: G[50], 100: G[100], 200: G[200], 300: G[300], 400: G[400], 500: G[500], 600: G[600], 700: G[700], 800: G[800], 900: G[900], 950: G[950] }

function rgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
const rampToRgb = (ramp) =>
  Object.fromEntries(Object.entries(ramp).map(([k, hex]) => [k, rgb(hex)]))

// Legacy numeric accent scales that tailwind.config.js maps via --c-<name>-*.
// brand already holds rgb triples; the rest are Tailwind's own hexes.
const PALETTES = {
  brand,
  red: rampToRgb(colors.red),
  amber: rampToRgb(colors.amber),
  blue: rampToRgb(colors.blue),
  green: rampToRgb(colors.green),
  purple: rampToRgb(colors.purple),
  indigo: rampToRgb(colors.indigo),
  orange: rampToRgb(colors.orange),
  yellow: rampToRgb(colors.yellow),
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const MIRROR = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 }

function legacyAccents(mode, indent) {
  const out = []
  for (const [name, ramp] of Object.entries(PALETTES)) {
    for (const s of SHADES) {
      const key = mode === 'dark' ? MIRROR[s] : s
      out.push(`${indent}--c-${name}-${s}: ${ramp[key]};`)
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

// ── Emit the primitive layer (theme-independent) ───────────────────────────
function primitives(indent) {
  const line = (name, val) => `${indent}--${name}: ${val};`
  const out = []
  out.push(`${indent}/* neutral — cool grey, one ramp, both themes via semantics */`)
  for (const [k, v] of Object.entries(N)) out.push(line(`n-${k}`, v))
  out.push('')
  out.push(`${indent}/* brand — single continuous emerald (hue ~162, no seam) */`)
  for (const [k, v] of Object.entries(G)) out.push(line(`g-${k}`, v))
  out.push('')
  out.push(`${indent}/* supporting hues — five, seven steps each */`)
  for (const [h, ramp] of Object.entries(HUES)) {
    for (const [k, v] of Object.entries(ramp)) out.push(line(`${h}-${k}`, v))
  }
  return out.join('\n')
}

// ── Scales (theme-independent) ─────────────────────────────────────────────
const SCALES = `    /* space — 4pt grid */
    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px;
    --s6: 24px; --s8: 32px; --s10: 40px; --s12: 48px;

    /* type — integers only */
    --t-micro: 11px; --t-xs: 12px; --t-sm: 13px; --t-base: 14px;
    --t-md: 16px; --t-lg: 20px; --t-xl: 26px; --t-2xl: 34px; --t-3xl: 44px;

    /* radius */
    --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-full: 999px;

    /* motion — applied by intent, not per component */
    --ease: cubic-bezier(.2, .7, .3, 1);
    --dur-fast: 120ms;  /* colour, opacity            */
    --dur-base: 200ms;  /* size, elevation, position  */
    --dur-slow: 280ms;  /* things that grow           */

    --sidebar-w: 236px;`

// ── Semantics: light ───────────────────────────────────────────────────────
const LIGHT_SEMANTICS = `    color-scheme: light;

    --canvas:         var(--n-50);
    --surface:        var(--n-0);
    --surface-sunk:   var(--n-100);
    --surface-hover:  var(--n-100);
    --surface-active: var(--n-150);
    --ink:            var(--n-900);   /* inverted button / tooltip bg */
    --on-ink:         var(--n-0);
    --on-ink-dim:     var(--n-400);

    --fg:        var(--n-900);   /* 15.9:1 */
    --fg-muted:  var(--n-700);   /*  8.6:1 */
    --fg-subtle: var(--n-600);   /*  5.6:1  — smallest text still AA */
    --fg-faint:  var(--n-500);   /*  3.7:1  — icons / decoration only */

    --line-subtle: var(--n-150);
    --line:        var(--n-200);
    --line-strong: var(--n-300);

    --accent:    var(--g-600);
    --accent-hi: var(--g-500);
    --accent-fg: var(--g-700);   /* accent-coloured text on light bg */
    --accent-bg: var(--g-50);
    --accent-bd: var(--g-200);

    --pos-fg: var(--g-700);  --pos: var(--g-500);  --pos-bg: var(--g-50);  --pos-bd: var(--g-200);
    --neg-fg: var(--r-700);  --neg: var(--r-500);  --neg-bg: var(--r-100); --neg-bd: var(--r-200);
    --warn-fg:var(--a-700);  --warn:var(--a-500);  --warn-bg:var(--a-100); --warn-bd:var(--a-200);
    --info-fg:var(--b-700);  --info:var(--b-500);  --info-bg:var(--b-100); --info-bd:var(--b-200);
    --alt-fg: var(--v-700);  --alt: var(--v-500);  --alt-bg: var(--v-100); --alt-bd: var(--v-200);
    --calm-fg:var(--t-700);  --calm:var(--t-500);  --calm-bg:var(--t-100); --calm-bd:var(--t-200);

    --grid:  var(--n-200);   /* chart gridlines */
    --track: var(--n-150);   /* progress track  */

    --e1: 0 1px 2px rgb(16 20 28 / .04);
    --e2: 0 1px 3px rgb(16 20 28 / .06), 0 4px 12px rgb(16 20 28 / .04);
    --e3: 0 8px 28px rgb(16 20 28 / .12), 0 2px 6px rgb(16 20 28 / .06);
    --ring: 0 0 0 2px rgb(var(--surface)), 0 0 0 4px rgb(var(--accent) / .55);

    /* ── Legacy aliases (one-layer model → v2). Kept so no component breaks. */
    --surface-raised:    var(--surface);
    --surface-sunken:    var(--surface-sunk);
    --surface-inverted:  var(--ink);
    --fg-inverted:       var(--on-ink);
    --fg-inverted-muted: var(--on-ink-dim);
    --fg-on-accent:      var(--on-ink);
    --overlay: 0 0 0;`

// ── Semantics: dark ──────────────────────────────────────────────────────
const DARK_SEMANTICS = `    color-scheme: dark;

    --canvas:         var(--n-1000);
    --surface:        var(--n-900);
    --surface-sunk:   var(--n-950);
    --surface-hover:  var(--n-850);
    --surface-active: var(--n-800);
    --ink:            var(--n-100);
    --on-ink:         var(--n-950);
    --on-ink-dim:     var(--n-600);

    --fg:        var(--n-25);
    --fg-muted:  var(--n-300);
    --fg-subtle: var(--n-400);
    --fg-faint:  var(--n-500);

    --line-subtle: var(--n-900);
    --line:        var(--n-850);
    --line-strong: var(--n-800);

    --accent:    var(--g-400);
    --accent-hi: var(--g-300);
    --accent-fg: var(--g-300);
    --accent-bg: var(--g-950);
    --accent-bd: var(--g-800);

    --pos-fg: var(--g-300);  --pos: var(--g-400);  --pos-bg: var(--g-950);  --pos-bd: var(--g-800);
    --neg-fg: 248 150 150;   --neg: var(--r-400);  --neg-bg: var(--r-950);  --neg-bd: 108 30 30;
    --warn-fg:250 210 130;   --warn:var(--a-400);  --warn-bg:var(--a-950);  --warn-bd:96 62 12;
    --info-fg:150 190 255;   --info:var(--b-400);  --info-bg:var(--b-950);  --info-bd:30 58 122;
    --alt-fg: 196 178 255;   --alt: var(--v-400);  --alt-bg: var(--v-950);  --alt-bd: 60 42 122;
    --calm-fg:130 220 220;   --calm:var(--t-400);  --calm-bg:var(--t-950);  --calm-bd:14 78 80;

    --grid:  var(--n-850);
    --track: var(--n-850);

    --e1: none;
    --e2: 0 1px 2px rgb(0 0 0 / .4);
    --e3: 0 12px 32px rgb(0 0 0 / .55), 0 2px 8px rgb(0 0 0 / .4);
    --ring: 0 0 0 2px rgb(var(--surface)), 0 0 0 4px rgb(var(--accent) / .6);

    /* ── Legacy aliases (one-layer model → v2). Kept so no component breaks. */
    --surface-raised:    var(--n-850);
    --surface-sunken:    var(--surface-sunk);
    --surface-inverted:  var(--ink);
    --fg-inverted:       var(--on-ink);
    --fg-inverted-muted: var(--on-ink-dim);
    --fg-on-accent:      255 255 255;
    --overlay: 0 0 0;`

const css = `/* Ported design-system component layer (dormant in R1, applied in R2+).
   Must precede @tailwind so Vite/postcss resolve the @import; the ported rules
   declare their own @layer components, collected at the @tailwind components
   injection point below regardless of source position. */
@import './styles/index.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  THEME TOKENS — GENERATED FILE, DO NOT EDIT BY HAND
 *  Source: scripts/gen-theme-tokens.mjs   Regenerate: npm run gen:tokens
 * ─────────────────────────────────────────────────────────────────────────
 *  Two layers (docs/v2/foundation/01-design-tokens.md):
 *
 *   PRIMITIVES  --n-* --g-* --r/a/b/v/t-*   raw ramps, theme-independent,
 *               NEVER named by a component.
 *   SEMANTICS   --canvas --surface --ink --fg-* --line-* --accent-* and the
 *               six hue roles --pos/neg/warn/info/alt/calm (× -fg -bg -bd).
 *               Dark mode RE-MAPS these roles onto the same primitives — it is
 *               not an inversion of ramps, which is why the dark: double-
 *               inversion trap (CLAUDE.md §18) cannot be expressed here.
 *   SCALES      --s* (space) --t-* (type) --r-* (radius) --ease --dur-*.
 *
 *  Values are space-separated RGB channels, not hex, because
 *  tailwind.config.js wraps them as rgb(var(--token) / <alpha-value>) — that
 *  is what keeps opacity modifiers (bg-brand-50/40, ring-brand-500/20) alive.
 *
 *  Both selector forms are emitted for each theme — .dark (Tailwind
 *  darkMode:'class') AND [data-theme="…"] (ported proposal CSS) — so the two
 *  theming mechanisms resolve identically (D-2).
 *
 *  Legacy names (--surface-sunken, --surface-inverted, --fg-inverted, the
 *  numeric --c-*-* accent ramps) are kept for one release as aliases so no
 *  existing component breaks; module reskins migrate usages onto the v2 roles.
 */

@layer base {
  :root {
    /* ── PRIMITIVES ── theme-independent */
${primitives('    ')}

    /* ── SCALES ── theme-independent */
${SCALES}
  }

  /* ── SEMANTICS: light ── */
  :root,
  [data-theme='light'] {
${LIGHT_SEMANTICS}

    /* Legacy numeric accent ramps — Tailwind's own hexes (brand re-hued to --g-*). */
${legacyAccents('light', '    ')}
  }

  /* ── SEMANTICS: dark ── (emit both selectors so class- and attribute-based
     theming resolve identically) */
  .dark,
  [data-theme='dark'] {
${DARK_SEMANTICS}

    /* Legacy numeric accent ramps — mirrored (brand re-hued to --g-*). */
${legacyAccents('dark', '    ')}
  }

  body {
    @apply bg-canvas text-fg antialiased;
    margin: 0;
  }

  /* Every number in a finance app is tabular — non-negotiable. Definition
     only in R1; components adopt the class in the R1 e2e-seams pass / reskins. */
  .num,
  .money,
  .amt,
  .figure,
  .stat-value,
  td.num,
  th.num {
    font-variant-numeric: tabular-nums;
  }

  /* One focus treatment for the whole app. :where() keeps specificity at 0 so a
     component's own focus style always wins; this is the fallback ring. */
  :where(a, button, input, [tabindex]):focus-visible {
    outline: none;
    box-shadow: var(--ring);
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }

  /* Native controls (date pickers, scrollbars, autofill) follow the theme via
     color-scheme above; this keeps form text from inheriting a stale colour. */
  input,
  textarea,
  select {
    color-scheme: inherit;
  }
}
`

fs.writeFileSync(path.join(root, 'src/index.css'), css)
console.log(`src/index.css regenerated (${css.split('\n').length} lines)`)
