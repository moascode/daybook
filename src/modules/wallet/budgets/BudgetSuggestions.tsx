import { useState } from 'react'
import { ArrowRight, TrendingUp, PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { BudgetSuggestion } from './insights'

interface BudgetSuggestionsProps {
  suggestions: BudgetSuggestion[]
  onReallocate: (s: Extract<BudgetSuggestion, { type: 'reallocate' }>) => Promise<void>
  onRightSize: (s: Extract<BudgetSuggestion, { type: 'right-size' }>) => Promise<void>
  onCreateMissing: (s: Extract<BudgetSuggestion, { type: 'create-missing' }>) => Promise<void>
}

/** A stable key for one suggestion — there's no id, so this doubles as the "which row is pending" lookup and the React list key. */
function suggestionKey(s: BudgetSuggestion): string {
  switch (s.type) {
    case 'reallocate': return `reallocate:${s.fromCategoryId}:${s.toCategoryId}`
    case 'right-size': return `right-size:${s.categoryId}`
    case 'create-missing': return `create-missing:${s.categoryId}`
  }
}

/**
 * Budgets' reason to exist (design.md, R8): compact one-line rows, action
 * button on the right, each one click. Renders even with zero budgets set —
 * "create missing" is exactly the row someone starting out needs to see.
 */
export function BudgetSuggestions({ suggestions, onReallocate, onRightSize, onCreateMissing }: BudgetSuggestionsProps) {
  const [pending, setPending] = useState<string | null>(null)

  if (suggestions.length === 0) return null

  async function run(key: string, action: () => Promise<void>) {
    setPending(key)
    try {
      await action()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="card card-pad mb-4" data-testid="budget-suggestions">
      <div className="u-label" style={{ marginBottom: 'var(--s2)' }}>Suggestions</div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => {
          const key = suggestionKey(s)
          const isPending = pending === key
          if (s.type === 'reallocate') {
            return (
              <div key={key} data-testid="suggestion-row" className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-subtle">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                  Move {formatMYR(s.amount)} from <span className="font-medium text-fg">{s.fromCategoryName}</span>,
                  which has run at {s.fromAvgPct}% for {s.lookbackMonths} months, to <span className="font-medium text-fg">{s.toCategoryName}</span>.
                </span>
                <Button size="sm" variant="secondary" loading={isPending} onClick={() => run(key, () => onReallocate(s))}>
                  Reallocate
                </Button>
              </div>
            )
          }
          if (s.type === 'right-size') {
            return (
              <div key={key} data-testid="suggestion-row" className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-subtle">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                  Raise <span className="font-medium text-fg">{s.categoryName}</span> to what you actually spend
                  ({formatMYR(s.suggestedLimit)}).
                </span>
                <Button size="sm" variant="secondary" loading={isPending} onClick={() => run(key, () => onRightSize(s))}>
                  Raise to {formatMYR(s.suggestedLimit)}
                </Button>
              </div>
            )
          }
          return (
            <div key={key} data-testid="suggestion-row" className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-fg-subtle">
                <PlusCircle className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                You have no <span className="font-medium text-fg">{s.categoryName}</span> budget and spend
                ~{formatMYR(s.avgMonthlySpend)}/mo on it.
              </span>
              <Button size="sm" variant="secondary" loading={isPending} onClick={() => run(key, () => onCreateMissing(s))}>
                Create budget
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
