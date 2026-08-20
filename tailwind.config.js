/** @type {import('tailwindcss').Config} */

// Every colour resolves through a CSS custom property defined in src/index.css,
// which is where light and dark are specified. The `<alpha-value>` placeholder
// is what keeps opacity modifiers working (bg-brand-50/40, ring-brand-500/20);
// a plain `var(--token)` would silently drop the opacity.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

// Accent scale backed by --c-<name>-<shade>. Light values are Tailwind's own
// hexes; the dark theme mirrors the ramp. See scripts/gen-theme-tokens.mjs.
const scale = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [
      shade,
      token(`c-${name}-${shade}`),
    ]),
  )

// Single source for the app's green. `positive` aliases `brand` so money UI
// (income amounts, positive net, hero) shares one "positive money" colour (B9).
const brand = scale('brand')

// v2 semantic hue role (--pos, --pos-fg, --pos-bg, --pos-bd →
// bg-pos / text-pos-fg / bg-pos-bg / border-pos-bd). Dark mode re-maps the
// role onto the primitives in src/index.css; components never name a ramp step.
const role = (name) => ({
  DEFAULT: token(name),
  fg: token(`${name}-fg`),
  bg: token(`${name}-bg`),
  bd: token(`${name}-bd`),
})

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Semantic neutrals ────────────────────────────────────────────
        // Use these instead of white/gray-*: a literal grey step has no
        // meaning once the scale inverts between themes.
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
          hover: token('surface-hover'),
          inverted: token('surface-inverted'),
        },
        fg: {
          DEFAULT: token('fg'),
          muted: token('fg-muted'),
          subtle: token('fg-subtle'),
          faint: token('fg-faint'),
          'on-accent': token('fg-on-accent'),
          inverted: {
            DEFAULT: token('fg-inverted'),
            muted: token('fg-inverted-muted'),
          },
        },
        line: {
          DEFAULT: token('line'),
          subtle: token('line-subtle'),
          strong: token('line-strong'),
        },
        overlay: token('overlay'),

        // ── v2 semantics ─────────────────────────────────────────────────
        // The inverted-chrome pair (toasts, tooltips, ink buttons) and the
        // accent role. `fg-on-accent` still maps to --on-ink for the few solid
        // fills that carry text; the primary button becomes ink, not green.
        ink: token('ink'),
        'on-ink': {
          DEFAULT: token('on-ink'),
          dim: token('on-ink-dim'),
        },
        accent: {
          DEFAULT: token('accent'),
          hi: token('accent-hi'),
          fg: token('accent-fg'),
          bg: token('accent-bg'),
          bd: token('accent-bd'),
        },
        // Six hue roles — the only way a component expresses meaning-coloured
        // fills/text/borders. Dark mode re-maps them; no `dark:` variant, ever.
        pos: role('pos'),
        neg: role('neg'),
        warn: role('warn'),
        info: role('info'),
        alt: role('alt'),
        calm: role('calm'),

        // ── Accents ──────────────────────────────────────────────────────
        brand,
        positive: brand,
        red: scale('red'),
        amber: scale('amber'),
        blue: scale('blue'),
        green: scale('green'),
        purple: scale('purple'),
        indigo: scale('indigo'),
        orange: scale('orange'),
        yellow: scale('yellow'),
      },

      // The bare `border` utility (111 uses) and `divide-y` (12) fall back to
      // Tailwind's literal gray-200, which would stay light-grey in dark mode.
      // divideColor inherits from borderColor, so this covers both.
      borderColor: ({ theme }) => ({
        ...theme('colors'),
        DEFAULT: token('line'),
      }),

      // Default offset is literal white — a white halo around focused buttons
      // in dark mode. Most focusable controls sit on a card/modal surface.
      ringOffsetColor: ({ theme }) => ({
        ...theme('colors'),
        DEFAULT: token('surface'),
      }),

      // v2 elevation scale (--e1/2/3), theme-aware via the tokens. New names,
      // no collision with Tailwind's shadow-sm/md/lg. shadow-e1 … shadow-e3.
      boxShadow: {
        e1: 'var(--e1)',
        e2: 'var(--e2)',
        e3: 'var(--e3)',
      },

      // Motion applied by intent (--ease). Overrides the default transition
      // curve only — affects easing, never position or size.
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
      },

      // NOTE: the --s* (space), --t-* (type) and --r-* (radius) scales are
      // emitted as CSS vars in src/index.css and consumed by the ported design
      // CSS directly. They are deliberately NOT added as Tailwind spacing/
      // fontSize/borderRadius overrides in R1: those keys collide with existing
      // utilities (text-base 16→14, rounded-sm 2→8, …) and would shift
      // typography and corners app-wide, which R1 must not do. R2 adds them as
      // the new shell/components begin using the utilities.
    },
  },
  plugins: [],
}
