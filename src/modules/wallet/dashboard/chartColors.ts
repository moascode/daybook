/**
 * Series colours for the dashboard charts.
 *
 * `useChartTheme` deliberately stops at grid/axis/tooltip and leaves series
 * colours alone, because income/expense carry money semantics that must not
 * move between themes. These are a different case: they encode magnitude and
 * polarity, not income and expense, so they DO need a dark step to stay
 * legible — hence a separate hook rather than a change to that one.
 *
 * Two deliberate choices:
 *
 * - The spend curve is INK, not a hue. Green already means income everywhere
 *   in this app, so a green spending line would contradict the rest of the UI,
 *   and a red one reads as an alarm on a perfectly ordinary month. Emphasis
 *   (the subject in ink, the context in grey) needs no hue at all.
 *
 * - Over/under budget is RED ↔ BLUE, not red ↔ green. Red-green is the pair
 *   most colour blindness collapses, and it is the one the old cash-flow chart
 *   relied on. Every bar is also labelled with a ▲/▼ glyph and a signed
 *   figure, so the colour is redundant rather than load-bearing.
 */
import { useMemo } from 'react'
import { useAppStore } from '@/stores/app.store'

export interface DashboardChartColors {
  /** This period's cumulative spend — the subject of the pace chart. */
  actual: string
  /** The baseline curve behind it. */
  usual: string
  /** Spent more than usual. */
  over: string
  /** Spent less than usual. */
  under: string
  /** Single-hue magnitude fill (category bars, weekday columns). */
  magnitude: string
  /** The prior period's ghost bar behind a magnitude fill. */
  ghost: string
}

const LIGHT: DashboardChartColors = {
  actual: '#1f2937',
  usual: '#9ca3af',
  over: '#dc2626',
  under: '#2563eb',
  magnitude: '#3b82f6',
  ghost: '#e5e7eb',
}

const DARK: DashboardChartColors = {
  actual: '#e6edf3',
  usual: '#6b7280',
  over: '#f87171',
  under: '#60a5fa',
  magnitude: '#60a5fa',
  ghost: '#374151',
}

export function useDashboardChartColors(): DashboardChartColors {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  return useMemo(() => (resolvedTheme === 'dark' ? DARK : LIGHT), [resolvedTheme])
}
