# Component layer (R1)

Source: `proposal-v2/theme.css` sections 4–5 (lines 204–2185), ~80 named
components accumulated across design iterations v2 → v15.

Strategy decided in [../open-decisions.md](../open-decisions.md) D-1: **hybrid** —
port the CSS for structural components, use Tailwind utilities for layout.

---

## 1. File layout

`theme.css` is one flat sheet whose later sections override earlier ones (v7's
motion block restyles `.trow` defined at line 464; v9 and v10 both revise the
summary cards). Porting it flat would preserve that, but nobody could find
anything. Split by concern, preserving cascade order within each file:

```
src/styles/
├── index.css          @layer components — imports the rest, in this order
├── shell.css          appbar, modtabs, sidebar, menu-panel, search, fab, mobile tabs
├── primitives.css     btn, chip, icon-btn, circle-btn, avatar, seg, notice, empty, skel
├── layout.css         .page, .dash 12-col grid, .section, .card, .band, .stack
├── data.css           .trow, .tday, table, .prow, filters, .stat-card, .acct
├── charts.css         .chart, .donut, .col, .bar, .ring, .burn, heatmap, .cmp
├── tasks.css          .task, .tcheck, .lchip, .tgroup, week board, habit grid
├── day.css            .datenav, .dayfigs, .ribbon, .tlist/.tl, .tl-note, .tl-now
├── trips.css          .tchip, .fx, .hero-trip, .burn, .itin/.ir, .ready, .tripband,
│                      .trip/.trip-cover, .wish, .book, .pack, the four trip palettes
└── motion.css         the v7 motion layer — LAST, it intentionally overrides
```

`day.css`, `trips.css` and most of `tasks.css` are dead weight until R5/R6, but
port them in R1 anyway: they are already written, they cost only bytes, and
splitting the port across releases guarantees the cascade order gets broken.

## 2. Rules for the port

1. **Values are transcribed, not retyped.** Where the proposal has `22px`, keep
   `22px`. The sheet was tuned by eye against rendered pages; a "tidier" 24px is
   a design change with no author.
2. **`rgb(var(--token) / α)` everywhere.** Never a hex, never a named colour.
3. **No `dark:` variants** — same rule as CLAUDE.md §18, same reason.
4. **Delete the mockup's inline styles.** Every page carries
   `style="background:rgb(var(--info-bg))"` inline. Those become props or
   modifier classes, not copied strings.
5. **Drop the `onclick=` handlers.** The mockups use inline JS for the sidebar,
   theme and account menu; React owns all three.
6. **Keep the accessibility.** Real `<button>`/`<a>`, `aria-label` on every
   icon-only control, `aria-selected` on segmented controls, `aria-current` on
   nav. REVIEW §9 lists this as the thing the previous design got worst.

## 3. Components that replace existing React primitives

| Proposal class | Existing | Action |
|---|---|---|
| `.btn`, `.btn-primary`, `.btn-ghost` | `ui/Button.tsx` | restyle Button internally; **do not** change its API — 100+ call sites |
| `.chip`, `.chip-mute`, `.lchip` | `ui/Badge.tsx` | restyle Badge, add chip variants |
| `.card`, `.section` | ad-hoc Tailwind per page | new `ui/Card.tsx`; the 12-col `.dash` grid replaces per-page grids |
| `.notice` | inline warnings | new `ui/Notice.tsx` (info/warn/neg) |
| `.empty` | `ui/EmptyState.tsx` | restyle, keep API |
| `.skel` | — | new `ui/Skeleton.tsx` — R17 uses it, R1 defines it |
| `.menu-panel`, `.pop-anchor` | Radix dropdown | keep Radix for behaviour, restyle with the proposal's classes |
| `.seg` | `ui/DateRangeControl.tsx` segmented control | restyle, keep API |
| `.search`, `.filter-field` | inline inputs | two visibly different controls — see below |

**The two search fields must not look alike.** REVIEW v3 and v6 both record this
as a bug the owner flagged: the global search and the list filter were identical
and read as a rendering fault. Global search is a raised pill that grows on
focus; the list filter is a sunken field with a funnel icon and a placeholder
that counts the set (`Filter these 128 transactions…`).

**And the focus ring must not double.** The global `:focus-visible` ring is
suppressed inside `.search` and `.filter-field` — the wrapper owns the focus
affordance, or you get a rounded rectangle drawn inside a rounded rectangle.

## 4. Charts

The proposal hand-writes SVG; the app uses Recharts through `useChartTheme()`.

| Chart | Recommendation |
|---|---|
| Sparklines, week rhythm, column charts, rings, heatmaps, hour ribbon, donut | **Hand-write**, per the proposal. These are small, the markup is already written, and Recharts fights every one of them |
| Spend pace, net-worth 12-month, reports paired columns, category trends | **Keep Recharts** — real axes, tooltips, responsive containers, already working |

Either way, colours come from `useChartTheme()` / `chartColors.ts`, never
inlined. Series colours stay excluded from theming: income/expense keep their
money semantics (B9) and category colours are user data.

Two chart-honesty rules from REVIEW §6, both currently violated somewhere in the
proposal's own earlier drafts and worth stating as invariants:

- **Never `preserveAspectRatio="none"` without `vector-effect: non-scaling-stroke`.**
  Stretching distorts stroke widths and makes the slope decorative.
- **A tooltip must be anchored to its data point.** The old draft pinned one at
  `left:47%` while the point sat at 60% — it pointed at nothing.
- Every chart carries an `aria-label` describing what it says **in words**.

## 5. Layout rules worth encoding, not just copying

These are the design's hard-won structural findings (REVIEW v4, v9, v10). They
should be in the reviewer's head on every page PR:

1. **One grid per page.** `.dash` is 12 columns, one 20px gap,
   `align-items: stretch`. Not a grid per row — that was the cause of the
   original's inconsistent vertical rhythm and misaligned columns.
2. **Cards that end in a summary line push it down with `margin-top: auto`**, so
   footers align across a row regardless of item count.
3. **Never pair two cards whose natural heights differ by 100px+.** v9 tried to
   fix that by padding the short one and just moved the hole. v10's rule: a
   summary belongs in a **short full-width `c12` band** with no partner to match.
4. Breakpoints collapse 12 → 6 → 1 at 1080px and 680px.
5. `AppShell` renders both mobile and desktop bars, so chrome controls are in the
   DOM twice — specs must match `visible=true`, not `.first()` (CLAUDE.md §16
   trap 4). The new shell keeps that property.

## 6. Verification

- Storybook is not in the stack and is not being added. Instead: a
  `/uat` addition (the route already exists) rendering every ported component in
  both themes on one page, so a token change can be eyeballed in one place.
- Screenshot both themes at 1440 / 768 / 390.
- Read the rendered page, not the diff. The double-inversion class of bug is
  invisible to `tsc` and to a reviewer reading CSS.
