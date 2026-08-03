#!/usr/bin/env node
// Regenerates src/index.css — the single definition of both themes.
//
// Run: npm run gen:tokens
//
// The neutral tokens are hand-authored below (they are semantic, and the dark
// surface ramp is tuned by eye, not derived). The accent tokens are generated:
// light values are Tailwind's own hexes, so light mode is unchanged by the
// token layer; dark values are the same ramp MIRRORED (50<->950 ... 500<->500).
// Edit this file, never src/index.css.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import colors from 'tailwindcss/colors.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Keep in sync with the `green` scale in tailwind.config.js.
const brand = {
  50: '#f0fdf6', 100: '#dcfce9', 200: '#bbf7d4', 300: '#86efb0', 400: '#4ade83',
  500: '#1D9E75', 600: '#16a35e', 700: '#15804a', 800: '#16653d', 900: '#145334',
  950: '#052e1a',
}

// `positive` aliases `brand` (B9: one "positive money" colour), so it is not
// generated separately — tailwind.config.js points both at --c-brand-*.
const PALETTES = {
  brand,
  red: colors.red,
  amber: colors.amber,
  blue: colors.blue,
  green: colors.green,
  purple: colors.purple,
  indigo: colors.indigo,
  orange: colors.orange,
  yellow: colors.yellow,
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const MIRROR = {
  50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500,
  600: 400, 700: 300, 800: 200, 900: 100, 950: 50,
}

function rgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function accents(mode, indent) {
  const out = []
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const s of SHADES) {
      const hex = palette[mode === 'dark' ? MIRROR[s] : s]
      if (!hex) throw new Error(`missing ${name}-${mode === 'dark' ? MIRROR[s] : s}`)
      out.push(`${indent}--c-${name}-${s}: ${rgb(hex)};`)
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

const css = `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  THEME TOKENS — GENERATED FILE, DO NOT EDIT BY HAND
 *  Source: scripts/gen-theme-tokens.mjs   Regenerate: npm run gen:tokens
 * ─────────────────────────────────────────────────────────────────────────
 *  Every colour in the app resolves through a custom property below, so the
 *  light and dark themes are defined here and nowhere else. Values are
 *  space-separated RGB channels rather than hex because tailwind.config.js
 *  wraps them as rgb(var(--token) / <alpha-value>) — that is what keeps
 *  opacity modifiers like bg-brand-50/40 and ring-brand-500/20 working.
 *
 *  Two families, deliberately handled differently:
 *
 *  1. NEUTRALS (--surface, --fg, --line ...) are SEMANTIC. Components say
 *     bg-surface / text-fg-subtle, never bg-white / text-gray-500, because a
 *     literal grey step is meaningless once the scale inverts: "gray-900
 *     text" is the darkest thing on screen in light and nearly the lightest
 *     in dark. A new component gets dark mode for free, with no dark:
 *     variants to remember.
 *
 *  2. ACCENTS (--c-brand-*, --c-red-* ...) keep Tailwind's NUMERIC scale
 *     (bg-red-50, text-red-600) and are remapped underneath. Light values are
 *     Tailwind's own hexes, so light mode renders exactly as it did before
 *     this layer existed. Dark values are the same ramp MIRRORED (50<->950,
 *     100<->900, ... 500<->500): a -50 tint chip becomes a -950 tint chip,
 *     -600/-700 accent text becomes -400/-300 and stays legible on a dark
 *     surface, and solid -500 fills are identical in both themes so primary
 *     buttons do not shift.
 */

@layer base {
  :root {
    color-scheme: light;

    /* Neutrals — semantic. Light values match the greys they replaced. */
    --canvas: 249 250 251;          /* was gray-50      app background      */
    --surface: 255 255 255;         /* was white        cards, panels, bars */
    --surface-raised: 255 255 255;  /*                  modals, dropdowns   */
    --surface-sunken: 249 250 251;  /* was gray-50      wells, table heads  */
    --surface-hover: 243 244 246;   /* was gray-100     hover+static fills  */
    --surface-inverted: 17 24 39;   /* was gray-900     toasts, tooltips    */
    --fg-inverted: 255 255 255;     /* was white        text on the above   */
    --fg-inverted-muted: 156 163 175; /* was gray-400   dim text on above   */
    --fg: 17 24 39;                 /* was gray-900/800 primary text        */
    --fg-muted: 55 65 81;           /* was gray-700/600 secondary text      */
    --fg-subtle: 107 114 128;       /* was gray-500     labels, captions    */
    --fg-faint: 156 163 175;        /* was gray-400/300 icons, disabled     */
    --fg-on-accent: 255 255 255;    /*                  text on solid fills */
    --line-subtle: 243 244 246;     /* was gray-100     dividers            */
    --line: 229 231 235;            /* was gray-200     default border      */
    --line-strong: 209 213 219;     /* was gray-300     inputs, emphasis    */
    --overlay: 0 0 0;               /*                  modal scrim         */

    /* Accents — Tailwind's ramps, unchanged. */
${accents('light', '    ')}
  }

  .dark {
    color-scheme: dark;

    /* Neutrals — not a mechanical inversion. The surface steps are tuned so
       "sunken" still reads recessed and "hover" still reads lifted, which
       means they move in the opposite direction to their light values. */
    --canvas: 13 17 23;
    --surface: 22 27 34;
    --surface-raised: 28 33 41;
    --surface-sunken: 15 20 26;
    --surface-hover: 33 38 45;
    /* Toasts and tooltips invert against the page in BOTH themes so they read
       as chrome floating over the app rather than as another card. */
    --surface-inverted: 230 237 243;
    --fg-inverted: 13 17 23;
    --fg-inverted-muted: 87 96 106;
    --fg: 230 237 243;
    --fg-muted: 177 186 196;
    --fg-subtle: 139 148 158;
    --fg-faint: 110 118 129;
    --fg-on-accent: 255 255 255;
    --line-subtle: 31 36 44;
    --line: 42 49 59;
    --line-strong: 58 66 78;
    --overlay: 0 0 0;

    /* Accents — Tailwind's ramps, mirrored. */
${accents('dark', '    ')}
  }

  body {
    @apply bg-canvas text-fg antialiased;
    margin: 0;
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
