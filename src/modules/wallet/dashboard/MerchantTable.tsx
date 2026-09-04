import { cn, formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import type { MerchantSpend } from './insights'

interface MerchantTableProps {
  rows: MerchantSpend[]
  className?: string
}

/** A single visit isn't a "frequent, easy to miss" pattern. */
const MIN_FREQUENT_COUNT = 2

/**
 * The highest-count merchant that isn't already #1 by total — the one that
 * never shows up as a big single transaction but adds up through sheer
 * frequency, easy to miss on a list sorted by total alone.
 */
function findFrequentButSmallCandidate(rows: MerchantSpend[]): MerchantSpend | null {
  if (rows.length < 2) return null
  const candidate = rows
    .slice(1)
    .reduce<MerchantSpend | null>((best, r) => (r.count > (best?.count ?? 0) ? r : best), null)
  if (!candidate || candidate.count < MIN_FREQUENT_COUNT) return null
  return candidate
}

/**
 * "Top merchants" — a literal port of the mockup's plain `.prow` list: name,
 * "N visits · $avg avg" subtext, total. No table, no sparkline.
 */
export function MerchantTable({ rows, className }: MerchantTableProps) {
  if (rows.length === 0) {
    return (
      <DashboardCard title="Top merchants" subtitle="Merchants in this period." className={className}>
        <p className="py-6 text-center text-sm text-fg-subtle">
          No merchant names on this period’s spending yet.
        </p>
      </DashboardCard>
    )
  }

  const candidate = findFrequentButSmallCandidate(rows)
  const top = rows.slice(0, 5)

  return (
    <DashboardCard className={cn('flex flex-col', className)} title="Top merchants" subtitle="This period">
      <div data-testid="merchant-table">
        {top.map((row) => (
          <div key={row.merchant} data-testid="merchant-table-row" className="prow" style={{ padding: 'var(--s2) 0' }}>
            <div className="min-w-0">
              <div className="pname capitalize">{row.merchant}</div>
              <div className="psub">
                {row.count} visit{row.count === 1 ? '' : 's'} · {formatMYR(row.average)} avg
              </div>
            </div>
            <div className="pamt">{formatMYR(row.total)}</div>
          </div>
        ))}
      </div>

      {candidate && (
        <>
          <div className="divider" style={{ marginTop: 'auto' }} />
          <p className="text-xs text-fg-subtle">
            <b className="capitalize text-fg">{candidate.merchant}</b> is your most{' '}
            <b className="text-fg">frequent</b> merchant, <b className="capitalize text-fg">{top[0].merchant}</b>{' '}
            your most <b className="text-fg">expensive</b>.
          </p>
        </>
      )}
    </DashboardCard>
  )
}
