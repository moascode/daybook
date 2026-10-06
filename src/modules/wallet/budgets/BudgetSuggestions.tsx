import { useState } from 'react'
import { ArrowRight, TrendingUp, PlusCircle, ArrowDownToLine } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { BudgetSuggestion, OverspendShare } from './insights'

interface BudgetSuggestionsProps {
  suggestions: BudgetSuggestion[]
  overspendShare: OverspendShare | null
  onReallocate: (s: Extract<BudgetSuggestion, { type: 'reallocate' }>) => Promise<void>
  onRightSize: (s: Extract<BudgetSuggestion, { type: 'right-size' }>) => Promise<void>
  onCreateMissing: (s: Extract<BudgetSuggestion, { type: 'create-missing' }>) => Promise<void>
  onRollForward: (s: Extract<BudgetSuggestion, { type: 'roll-forward' }>) => Promise<void>
}

/** A stable key for one suggestion — there's no id, so this doubles as the "which row is pending" lookup and the React list key. */
function suggestionKey(s: BudgetSuggestion): string {
  switch (s.type) {
    case 'reallocate': return `reallocate:${s.fromCategoryId}:${s.toCategoryId}`
    case 'right-size': return `right-size:${s.categoryId}`
    case 'create-missing': return `create-missing:${s.categoryId}`
    case 'roll-forward': return `roll-forward:${s.categoryId}`
  }
}

/**
 * Per-type icon circle colour + icon (FEAT-066 mock's four `.sug` examples):
 * reallocate -> info, right-size -> warn, create-missing -> calm (no 1:1 mock
 * example for this one; `calm` is the closest unused token to the mock's own
 * "set a budget" row), roll-forward -> alt.
 */
const TYPE_STYLE: Record<BudgetSuggestion['type'], { bg: string; fg: string; Icon: LucideIcon }> = {
  reallocate: { bg: 'rgb(var(--info-bg))', fg: 'rgb(var(--info-fg))', Icon: ArrowRight },
  'right-size': { bg: 'rgb(var(--warn-bg))', fg: 'rgb(var(--warn-fg))', Icon: TrendingUp },
  'create-missing': { bg: 'rgb(var(--calm-bg))', fg: 'rgb(var(--calm-fg))', Icon: PlusCircle },
  'roll-forward': { bg: 'rgb(var(--alt-bg))', fg: 'rgb(var(--alt-fg))', Icon: ArrowDownToLine },
}

/** Title/sub copy + action label for one suggestion row — short, mock-style ("Move $60 to Dining out" / "Transport has run at 45% for three months"), not the old long sentence. */
function rowCopy(s: BudgetSuggestion): { title: string; sub: string; actionLabel: string } {
  switch (s.type) {
    case 'reallocate':
      return {
        title: `Move ${formatMYR(s.amount)} to ${s.toCategoryName}`,
        sub: `${s.fromCategoryName} has run at ${s.fromAvgPct}% for ${s.lookbackMonths} months`,
        actionLabel: 'Apply',
      }
    case 'right-size':
      return {
        title: `Raise ${s.categoryName} to ${formatMYR(s.suggestedLimit)}`,
        sub: `Over in ${s.overMonths} of the last ${s.lookbackMonths} months`,
        actionLabel: 'Raise',
      }
    case 'create-missing':
      return {
        // N4(c) fix: "Set a Entertainment budget" was wrong for a vowel-led
        // category name. Restructured rather than picking a/an conditionally,
        // so there's no a/an case left to get wrong for any category name.
        title: `Set up a budget for ${s.categoryName}`,
        sub: `${formatMYR(s.avgMonthlySpend)} a month, unbudgeted`,
        actionLabel: 'Create',
      }
    case 'roll-forward':
      return {
        title: `Roll unused ${s.categoryName} forward`,
        sub: `${formatMYR(s.avgLeftover)} left over, ${s.lookbackMonths} months running`,
        actionLabel: 'Enable',
      }
  }
}

/**
 * Budgets' reason to exist (design.md, R8): compact one-line rows, action
 * button on the right, each one click. Renders even with zero budgets set —
 * "create missing" is exactly the row someone starting out needs to see.
 * Restyled to the mock's `.sug` pattern (FEAT-066) — markup/copy changed,
 * the underlying suggestion logic (insights.ts) and handler wiring did not.
 */
export function BudgetSuggestions({
  suggestions, overspendShare, onReallocate, onRightSize, onCreateMissing, onRollForward,
}: BudgetSuggestionsProps) {
  // A Set, not a single key — one in-flight row finishing must not clear the
  // pending (and re-enable the button) of a DIFFERENT row still in flight.
  const [pending, setPending] = useState<Set<string>>(new Set())

  // N4(a) fix: this used to return null whenever there were zero *suggestion*
  // rows, even when there WAS overspend to report — hiding the insight line
  // before it ever got a chance to render. Only bail out when there is
  // neither a suggestion to show nor an overspend insight to report.
  if (suggestions.length === 0 && !overspendShare) return null

  async function run(key: string, action: () => Promise<void>) {
    setPending((p) => new Set(p).add(key))
    try {
      await action()
    } finally {
      setPending((p) => {
        const next = new Set(p)
        next.delete(key)
        return next
      })
    }
  }

  function handlerFor(s: BudgetSuggestion): () => void {
    const key = suggestionKey(s)
    switch (s.type) {
      case 'reallocate': return () => run(key, () => onReallocate(s))
      case 'right-size': return () => run(key, () => onRightSize(s))
      case 'create-missing': return () => run(key, () => onCreateMissing(s))
      case 'roll-forward': return () => run(key, () => onRollForward(s))
    }
  }

  return (
    <section className="card card-pad c5" data-testid="budget-suggestions">
      <div className="card-head">
        <div>
          <div className="card-title">Suggestions</div>
          <div className="card-sub">From six months of your own behaviour</div>
        </div>
      </div>
      {suggestions.map((s) => {
        const key = suggestionKey(s)
        const isPending = pending.has(key)
        const { bg, fg, Icon } = TYPE_STYLE[s.type]
        const { title, sub, actionLabel } = rowCopy(s)
        return (
          <div key={key} data-testid="suggestion-row" className="sug">
            <div className="tavatar" style={{ background: bg, color: fg }}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="sug-main">
              <div className="sug-title">{title}</div>
              <div className="sug-sub">{sub}</div>
            </div>
            <Button size="sm" variant="secondary" loading={isPending} onClick={handlerFor(s)}>
              {actionLabel}
            </Button>
          </div>
        )
      })}
      {overspendShare && (
        <>
          <div className="divider" style={{ marginTop: 'auto' }} />
          <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="overspend-insight">
            {overspendShare.categoryNames.join(' and ')}{' '}
            {/* N4(b) fix: "Dining are 100%" — singular subject needs "is". */}
            {overspendShare.categoryNames.length > 1 ? 'are' : 'is'}{' '}
            <b style={{ color: 'rgb(var(--fg))', fontWeight: 600 }}>{overspendShare.pct}%</b> of all overspend.
            Everything else is behaving.
          </div>
        </>
      )}
    </section>
  )
}
