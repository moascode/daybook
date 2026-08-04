import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { useDashboardChartColors } from './chartColors'
import type { CommittedSplit } from './insights'

interface CommittedSpendProps {
  split: CommittedSplit
}

/**
 * Spending that was decided once against spending decided in the moment.
 *
 * The useful cut for changing anything: a committed cost is a decision already
 * made, so the discretionary half is where the month is actually won or lost.
 */
export function CommittedSpend({ split }: CommittedSpendProps) {
  const colors = useDashboardChartColors()
  const total = split.committed + split.discretionary
  if (total <= 0) {
    return (
      <DashboardCard title="Locked in vs. up to you" subtitle="Committed costs against the rest.">
        <p className="py-6 text-center text-sm text-fg-subtle">No spending in this period yet.</p>
      </DashboardCard>
    )
  }

  const committedPct = (split.committed / total) * 100

  return (
    <DashboardCard
      title="Locked in vs. up to you"
      subtitle="Bills, subscriptions and anything you pay most months, against everything you decided on in the moment."
    >
      <div
        className="mb-3 flex h-7 gap-0.5"
        role="img"
        aria-label={`Committed ${formatMYR(split.committed)}, ${committedPct.toFixed(
          0,
        )} percent. Discretionary ${formatMYR(split.discretionary)}, ${(100 - committedPct).toFixed(0)} percent.`}
        data-testid="committed-split"
      >
        {split.committed > 0 && (
          <div
            className="rounded"
            style={{ flex: split.committed, background: colors.magnitude }}
          />
        )}
        {split.discretionary > 0 && (
          <div
            className="rounded"
            style={{ flex: split.discretionary, background: colors.ghost }}
          />
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full" style={{ background: colors.magnitude }} />
          Committed {formatMYR(split.committed)}
          <span className="text-fg-faint">· {committedPct.toFixed(0)}%</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full" style={{ background: colors.ghost }} />
          Discretionary {formatMYR(split.discretionary)}
          <span className="text-fg-faint">· {(100 - committedPct).toFixed(0)}%</span>
        </span>
      </div>

      {split.items.length > 0 && (
        <>
          <p className="mb-1 text-xs text-fg-subtle">
            The {split.items.length} thing{split.items.length === 1 ? '' : 's'} that repeat
            {split.items.length === 1 ? 's' : ''}
          </p>
          <ul className="divide-y divide-line-subtle">
            {split.items.slice(0, 8).map((item) => (
              <li key={item.merchant} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-[13px] capitalize text-fg">
                  {item.merchant}
                  {item.fromRule && (
                    <span className="ml-2 rounded-full border border-line bg-surface-sunken px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                      rule
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-fg-muted">
                  {formatMYR(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardCard>
  )
}
