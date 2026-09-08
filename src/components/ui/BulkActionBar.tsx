import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BulkActionBarProps {
  /** Stable e2e hook; each surface keeps the testid it already published. */
  testId: string
  /** How many rows are selected — rendered as the bar's leading count. */
  count: number
  /** Optional "Select all N" link, shown beside the count while partial. */
  selectAll?: ReactNode
  /** Optional clear-selection control. Omitted where the actions are terminal. */
  onClear?: () => void
  /** The actions themselves, left to right. */
  children: ReactNode
  className?: string
}

/**
 * The floating pill that appears whenever a list has a selection — shared by
 * the transaction list, CSV review, the capture inbox and shared activity,
 * which between them carried four byte-identical copies of its markup.
 *
 * Layout lives in `.bulk-bar` (src/styles/shell.css), beside the mobile tab bar
 * and FAB it has to coexist with, because that coexistence is the whole reason
 * the rule is non-trivial: at `bottom: 1rem` with `z-30` the pill sat
 * underneath the tab bar (fixed, `bottom: 0`, `z-50`) on every phone, so a
 * selection on a phone looked like it had no actions at all.
 *
 * The phone shape is deliberately not the desktop pill: a centred pill holding
 * a count, a "select all" link and four buttons cannot fit 360px, and one that
 * scrolls sideways hides its own Delete. On a phone it becomes a full-width
 * tier sitting directly on the tab bar — count and dismiss on the first row,
 * actions on the second — which is why the two rows are placed by grid areas
 * rather than by DOM order.
 */
export function BulkActionBar({
  testId,
  count,
  selectAll,
  onClear,
  children,
  className,
}: BulkActionBarProps) {
  return (
    <div
      data-testid={testId}
      className={cn('bulk-bar border border-brand-200 bg-brand-50 shadow-xl shadow-brand-900/10', className)}
    >
      <div className="bulk-bar-lead">
        <span className="bulk-bar-count">{count} selected</span>
        {selectAll}
      </div>
      <div className="bulk-bar-sep" aria-hidden="true" />
      <div className="bulk-bar-actions">{children}</div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
          className="bulk-bar-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
