# Design tokens (R1)

Source: `proposal-v2/theme.css` sections 1–3 (lines 1–203).
Target: `scripts/gen-theme-tokens.mjs` → `src/index.css` + `tailwind.config.js`.

`src/index.css` stays **generated — never hand-edited** (CLAUDE.md §18).

---

## 1. The model changes shape

Today: one layer. `--surface`, `--fg` etc. are hand-authored neutrals, and the
accents are Tailwind's numeric ramps mirrored for dark.

v2: **two layers.**

```
PRIMITIVES   --n-0 … --n-1000     one cool-grey ramp, both themes
             --g-50 … --g-950     one continuous emerald, hue ~162, no seam
             --r-* --a-* --b-* --v-* --t-*   five supporting hues, 7 steps each
                    ↓  never referenced by a component
SEMANTICS    --canvas --surface --surface-sunk --surface-hover --surface-active
             --ink --on-ink --on-ink-dim
             --fg --fg-muted --fg-subtle --fg-faint
             --line-subtle --line --line-strong
             --accent --accent-hi --accent-fg --accent-bg --accent-bd
             --pos --neg --warn --info --alt --calm   (× -fg -bg -bd)
             --grid --track --e1 --e2 --e3 --ring
                    ↓  the only layer components touch
COMPONENTS
```

Why it matters: dark mode becomes a **re-map of roles**, not an inversion of
ramps. The current model inverts the ramps (50↔950), which works until a
component wants "a light green fill" in both themes and gets the opposite — and
it is the direct cause of the `dark:` double-inversion trap in CLAUDE.md §18.
Under the v2 model that trap cannot be expressed, because a component never
names a ramp step.

## 2. Two corrections that are bugs today

**The brand ramp has a hue break.** `--c-brand-500: #1D9E75` is hue 161° between
Tailwind greens at 142° and 151°. Any gradient or fill mixing brand steps
crosses the seam. Replace the whole ramp with the proposal's `--g-*`.

This value also appears in `src/lib/theme.ts` as `META_THEME_COLOR.light` and in
`index.html`'s `<meta name="theme-color">`. Update all three.

**Three pairs fail WCAG AA in production:**

| Pair | Ratio | Where |
|---|---|---|
| `--fg-faint` on `--surface` | 2.54 | card subtitles, transaction sub-lines |
| white on `--c-brand-500` | 3.39 | **the primary button** |
| `--fg-subtle` at 11.5px | 4.83 | labels — passes, barely |

v2's worst case is 4.61, with `--fg-faint` at 3.78 restricted to icons and
decoration. `scripts/check-contrast.mjs` (below) enforces it.

## 3. Scales — three that do not exist yet

```
space   --s1 4  --s2 8  --s3 12  --s4 16  --s5 20  --s6 24  --s8 32  --s10 40  --s12 48
type    --t-micro 11  --t-xs 12  --t-sm 13  --t-base 14  --t-md 16
        --t-lg 20  --t-xl 26  --t-2xl 34  --t-3xl 44        (integers only)
radius  --r-sm 8  --r-md 12  --r-lg 16  --r-full 999
motion  --ease cubic-bezier(.2,.7,.3,1)
        --dur-fast 120ms   colour, opacity
        --dur-base 200ms   size, elevation, position
        --dur-slow 280ms   things that grow
```

The proposal's own review is blunt about why: the previous sheet ran ten font
sizes including half-pixels, and spacing of 9/10/13/14/16/18/26 — *"none of that
is a system, so nothing lines up on a grid and every new component invents its
own numbers."*

Motion is applied **by intent, not per component**. A hover that changes colour
is always 120ms; a thing that lifts is always 200ms. All of it sits under the
existing `prefers-reduced-motion` block.

## 4. Tailwind mapping

`tailwind.config.js` keeps its `token()` / `<alpha-value>` helper — that
mechanism is correct and must survive, or every `bg-brand-50/40` silently drops
its opacity.

Add:

```js
colors: {
  // existing semantic neutrals stay, re-valued
  ink: token('ink'), 'on-ink': token('on-ink'),
  accent: { DEFAULT: token('accent'), hi: token('accent-hi'),
            fg: token('accent-fg'), bg: token('accent-bg'), bd: token('accent-bd') },
  pos:  role('pos'),  neg: role('neg'),  warn: role('warn'),
  info: role('info'), alt: role('alt'),  calm: role('calm'),
},
spacing:      { 1:'4px', 2:'8px', 3:'12px', 4:'16px', 5:'20px', 6:'24px', 8:'32px', 10:'40px', 12:'48px' },
fontSize:     { micro:'11px', xs:'12px', sm:'13px', base:'14px', md:'16px',
                lg:'20px', xl:'26px', '2xl':'34px', '3xl':'44px' },
borderRadius: { sm:'8px', md:'12px', lg:'16px', full:'999px' },
boxShadow:    { e1:'var(--e1)', e2:'var(--e2)', e3:'var(--e3)' },
transitionTimingFunction: { DEFAULT: 'var(--ease)' },
```

**Keep the old numeric accent scales as aliases for one release.** `bg-red-600`
appears throughout the codebase; deleting the scale in R1 turns a token change
into a 100-file refactor. Map `red-*` → the `--r-*` primitive ramp, mark it
deprecated in a comment, and remove it once the module reskins land.

## 5. Alias table (keeps R1 from breaking every component)

| Existing | v2 | Handling |
|---|---|---|
| `--surface-sunken` | `--surface-sunk` | emit both, same value |
| `--surface-raised` | (none — v2 uses `--e2`/`--e3`) | keep, `= --surface` |
| `--surface-inverted` | `--ink` | emit both |
| `--fg-inverted` | `--on-ink` | emit both |
| `--fg-inverted-muted` | `--on-ink-dim` | emit both |
| `--fg-on-accent` | `--on-ink` on ink buttons | keep; the primary button turns **ink-black, not green** (see below) |
| `--c-brand-*` | `--g-*` | `--c-brand-N: var(--g-N)` |
| `--overlay` | (none) | keep |

**The primary button changes colour.** Green is reserved for *money moved in the
right direction*, so it always means one thing; the primary action becomes ink.
This is a visible product change, not a token detail — show the owner before R1
merges.

## 6. `scripts/check-contrast.mjs`

New, CI-gated, sibling to `scripts/schema-diff.mjs`.

- Parses the generated `src/index.css`, resolves `var()` chains to RGB.
- For each theme, computes the contrast of every declared foreground role
  against `--canvas`, `--surface`, `--surface-sunk` and each `*-bg` role.
- Fails below **4.5:1**, except `--fg-faint` which must clear **3.0:1** and is
  asserted to appear only in an allowlist of icon/decoration selectors.
- Prints a table so a regression says which pair and by how much.

Add to CI next to the existing typecheck jobs. Without this gate the AA fixes
regress the first time someone tunes a neutral by eye — which is how the current
2.54:1 subtitle got there.

## 7. Tabular numerals

```css
.num, .money, .amt, .figure, .stat-value, td.num, th.num { font-variant-numeric: tabular-nums; }
```

Then audit: every money-rendering component gets one of those classes.
`formatMYR` output must never be rendered in proportional figures.

## 8. Verification

- `npm run gen:tokens` is the only way `src/index.css` changes.
- `npm run check:contrast` green.
- Screenshot both themes at 1440 and 390, all 20 existing routes, before and
  after — the diff should be colour only, never layout.
- 63/63 specs green.
