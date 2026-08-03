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
    },
  },
  plugins: [],
}
