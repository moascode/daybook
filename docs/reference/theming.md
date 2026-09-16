> **Status:** Live · **Last verified:** 2026-09-16

# Theming and colour tokens

Two themes, one generated token layer, and why there is not a single `dark:` variant in the codebase.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 18. Theming & Colour Tokens

**Never write a literal grey or `white` in a component again.** Both themes are
defined in one place and everything else resolves through it.

### Where the colours live

| File | Role |
|---|---|
| `scripts/gen-theme-tokens.mjs` | **Source of truth.** Hand-authored neutrals + generated accent ramps. Edit this. |
| `src/index.css` | **Generated — do not hand-edit.** Regenerate with `npm run gen:tokens`. |
| `tailwind.config.js` | Maps the CSS variables onto Tailwind colour names. |
| `src/lib/theme.ts` | Resolves `'system'` → light/dark; the only place that touches the `dark` class. |

### Two families, handled differently

**1. Neutrals are semantic — use these, not `gray-*`/`white`:**

| Token | Replaces | Use for |
|---|---|---|
| `bg-canvas` | `bg-gray-50` | page background |
| `bg-surface` | `bg-white` | cards, panels, bars |
| `bg-surface-raised` | — | modals, dropdowns (floats above `surface` in dark) |
| `bg-surface-sunken` | `bg-gray-50` | wells, table headers |
| `bg-surface-hover` | `bg-gray-100` | hover states and static fills |
| `bg-surface-inverted` + `text-fg-inverted` | `bg-gray-900` + `text-white` | toasts, tooltips (inverted in **both** themes) |
| `text-fg` | `text-gray-900/800` | primary text |
| `text-fg-muted` | `text-gray-700/600` | secondary text |
| `text-fg-subtle` | `text-gray-500` | labels, captions |
| `text-fg-faint` | `text-gray-400/300` | icons, disabled |
| `text-fg-on-accent` | `text-white` | text on a solid brand/danger fill |
| `border-line` / `-subtle` / `-strong` | `border-gray-200/100/300` | borders, dividers |

A literal grey step is meaningless once the scale inverts — `gray-900` text is
the darkest thing on screen in light and nearly the lightest in dark. Using the
semantic token means a new component gets dark mode **for free**, with no
`dark:` variants to remember.

**2. Accents keep Tailwind's numeric scale** — `bg-red-50`, `text-brand-600`,
`bg-amber-100` all still work and need no `dark:` variant. Light values are
Tailwind's own hexes; the dark theme serves the same ramp **mirrored**
(50↔950, 100↔900, … 500↔500), so a `-50` tint chip becomes a `-950` tint chip,
`-600`/`-700` accent text becomes `-400`/`-300` and stays legible, and solid
`-500` fills are identical in both themes.

### Rules

1. **Adding a colour to a component**: reach for a semantic neutral or an accent
   scale. If neither fits, add a token to `scripts/gen-theme-tokens.mjs` and
   regenerate — do not hand-edit `src/index.css`, and **never add a `dark:`
   variant** (there are none in the codebase; one would be the first).

   > **`dark:` variants DOUBLE-INVERT.** The token layer already mirrors the
   > accent ramps (50↔950), so `bg-amber-50` *already* resolves to a dark tint in
   > dark mode; pairing it with `dark:bg-amber-950` inverts a second time and
   > lands on near-white. Eight of these shipped into review during the dashboard
   > rebuild before being caught by *looking at the rendered page* — the type
   > checker cannot see it, and neither can a reviewer reading the diff.
2. **Colours passed as props, not classes** — Recharts grids/axes/tooltips —
   come from `useChartTheme()`, which reads `resolvedTheme` from the store.
   Series colours are deliberately excluded: income/expense keep their money
   semantics (B9) and category colours are user data.
3. **`theme` vs `resolvedTheme`** in `app.store`: `theme` is the tri-state
   preference (`'light' | 'dark' | 'system'`); `resolvedTheme` is what is
   actually on screen. Branch on `resolvedTheme` in JS, never on `theme`.
4. **Changing the theme** goes through `useThemePreference().changeTheme`,
   shared by the Settings select and the TopBar toggle so they cannot drift.
5. **The pre-paint script in `index.html` is load-bearing.** The preference
   lives on the server and is not readable until after auth, so without the
   localStorage mirror every load of a dark-themed app flashes white. If you
   change the storage key or the class name, change it in **both**
   `src/lib/theme.ts` and the inline script. Spec 58 blocks the JS bundle to
   prove it — asserting after hydration would pass on the store's localStorage
   seed alone, which lands a frame too late, after the white paint.
6. **`manifest.json` `background_color` STAYS `#ffffff`.** Decided 2026-08-05;
   do not "fix" it again. The manifest spec gives it a single colour with no
   media-query form, and the OS caches the manifest at install time, so unlike
   `<meta name="theme-color">` (which `index.html` already swaps pre-paint) it
   **cannot** follow the theme. The only choice is which single colour to commit
   to, and `#ffffff` matches the default Light theme both users are on.

   > **Scope, clarified 2026-09-07 (v3 P5).** This rule is about
   > `background_color`, and only that. It was being read as "the launch screen
   > cannot follow the theme", which is not true and cost the dark-theme white
   > flash longer than it needed to.
   >
   > `<link rel="apple-touch-startup-image">` is a **different mechanism** and
   > **does** accept a `media` attribute, `prefers-color-scheme` included.
   > `index.html` now carries light and dark launch images per device size, so
   > iOS picks the right one. A device whose dimensions match no tag simply gets
   > no splash and falls back to `background_color` — which is why adding sizes
   > is additive and can never break an unlisted phone.
   >
   > So: the manifest colour still cannot follow the theme. The splash can, and
   > now does.
