import { formatMYR } from '@/lib/utils'
import { Sparkline } from './Sparkline'
import { useDashboardChartColors } from './chartColors'

export interface StatTile {
  label: string
  value: number
  /** One line of context under the value — a comparison, not a repeat. */
  note: string
  /** Show an explicit + on positive values (net figures). */
  signed?: boolean
  /** Trailing monthly series for the sparkline. */
  trend: number[]
  testId?: string
}

interface StatTilesProps {
  tiles: StatTile[]
}

export function StatTiles({ tiles }: StatTilesProps) {
  const colors = useDashboardChartColors()

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          data-testid={tile.testId}
          className="flex min-h-[7rem] flex-col rounded-xl border border-line bg-surface p-4"
        >
          <span className="text-xs font-medium text-fg-muted">{tile.label}</span>
          <span className="mt-0.5 text-xl font-bold tracking-tight text-fg">
            {tile.signed && tile.value > 0 ? '+' : ''}
            {formatMYR(tile.value)}
          </span>
          <span className="text-[11px] text-fg-subtle">{tile.note}</span>
          <div className="mt-auto pt-2">
            <Sparkline values={tile.trend} color={colors.magnitude} width={96} height={24} />
          </div>
        </div>
      ))}
    </div>
  )
}
