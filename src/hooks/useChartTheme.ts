import { useMemo } from 'react'
import { useAppStore } from '@/stores/app.store'

/**
 * Colours for the Recharts elements that take them as PROPS rather than
 * classes — grids, axes and tooltips. Those cannot go through the CSS token
 * layer, so they read the resolved theme from the store instead.
 *
 * Recharts' own defaults are a light-grey grid and a white tooltip card, both
 * of which are unreadable on a dark canvas.
 *
 * Series colours are deliberately NOT here: income/expense keep their money
 * semantics (B9) in both themes, and category slice colours are user data.
 */
export interface ChartTheme {
  grid: string
  axis: string
  tooltip: {
    contentStyle: React.CSSProperties
    labelStyle: React.CSSProperties
    itemStyle: React.CSSProperties
  }
}

const LIGHT: ChartTheme = {
  grid: '#f0f0f0',
  axis: '#6b7280',
  tooltip: {
    contentStyle: {
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
    },
    labelStyle: { color: '#111827', fontWeight: 600 },
    itemStyle: { color: '#374151' },
  },
}

const DARK: ChartTheme = {
  grid: '#2a313b',
  axis: '#8b949e',
  tooltip: {
    contentStyle: {
      backgroundColor: '#1c2129',
      border: '1px solid #2a313b',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgb(0 0 0 / 0.5)',
    },
    labelStyle: { color: '#e6edf3', fontWeight: 600 },
    itemStyle: { color: '#b1bac4' },
  },
}

export function useChartTheme(): ChartTheme {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  return useMemo(() => (resolvedTheme === 'dark' ? DARK : LIGHT), [resolvedTheme])
}
