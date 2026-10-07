import {
  Banknote,
  Car,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Laptop,
  Plane,
  PlusCircle,
  ShoppingBag,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// worker/seed.ts's fixed set of default-category icon names. A custom
// category's `icon` is free text (CategoryManager.tsx) and may not be in this
// map — resolution always falls back to `tag`, never undefined, per
// CLAUDE.md §2 rule 10 (never render nothing).
const ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  car: Car,
  'shopping-bag': ShoppingBag,
  zap: Zap,
  'heart-pulse': HeartPulse,
  'gamepad-2': Gamepad2,
  plane: Plane,
  'graduation-cap': GraduationCap,
  sparkles: Sparkles,
  tag: Tag,
  banknote: Banknote,
  laptop: Laptop,
  'trending-up': TrendingUp,
  gift: Gift,
  'plus-circle': PlusCircle,
}

export type ResolvedCategoryIconKey = keyof typeof ICON_MAP

const FALLBACK_KEY: ResolvedCategoryIconKey = 'tag'

/** Resolves a category's `icon` field (a known seed name, or free-text from a
 * custom category) to the map key that will actually render — `'tag'` for
 * anything unknown or missing. Callers that need to stamp a test hook with
 * the icon that was actually chosen (not the raw, possibly-bogus input) use
 * this rather than echoing the category's own field.
 *
 * (This file mixes a component — `CategoryIcon`, below — with small pure
 * helpers its callers need, so `react-refresh/only-export-components` is
 * disabled on both: splitting three lines of logic into a second file buys
 * Fast Refresh nothing here.) */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveCategoryIconKey(name: string | null | undefined): ResolvedCategoryIconKey {
  if (!name) return FALLBACK_KEY
  return (name in ICON_MAP ? (name as ResolvedCategoryIconKey) : FALLBACK_KEY)
}

/**
 * Renders a category's icon. A stable, module-level component — never build
 * `const Icon = ICON_MAP[...]` inside another component's render and spread
 * it as JSX there (`react-hooks/static-components` flags a component
 * reference assigned during render); indexing into the map happens inside
 * this component's own render instead, which the rule doesn't flag.
 */
export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = ICON_MAP[resolveCategoryIconKey(name)]
  return <Icon className={className} />
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A category's own hex `color`, tinted into a background/foreground pair for
 * the avatar — matches the mockup's `.tavatar` (a soft tint of the category
 * colour behind a readable foreground). The foreground is mixed toward the
 * theme's own ink token (`--fg`, src/index.css) rather than used raw: a
 * light, saturated category hex (e.g. `#eab308`) read at AA-failing contrast
 * directly on the page background. Returns `undefined` for anything that
 * isn't a real hex colour, so callers fall back to their own neutral/palette
 * styling instead of rendering `color-mix(..., undefined ...)`. See the note
 * on `resolveCategoryIconKey` above re: the `react-refresh` disable below. */
// eslint-disable-next-line react-refresh/only-export-components
export function categoryTint(hex: string): { background: string; color: string } | undefined {
  if (!HEX_COLOR_RE.test(hex)) return undefined
  return {
    background: `color-mix(in srgb, ${hex} 16%, transparent)`,
    color: `color-mix(in srgb, ${hex} 70%, rgb(var(--fg)))`,
  }
}
