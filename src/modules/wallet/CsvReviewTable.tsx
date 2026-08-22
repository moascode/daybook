import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { Badge } from '@/components/ui/Badge'
import { cn, formatMYR } from '@/lib/utils'
import type { ImportRow } from '@/lib/csv'
import type { Account, Category } from '@/types/wallet.types'

interface CsvReviewTableProps {
  rows: ImportRow[]
  categories: Category[]
  /** Accounts eligible as a transfer destination (writable), excluding the import target. */
  destinationAccounts: Account[]
  onRowChange: (index: number, updates: Partial<ImportRow>) => void
  onToggleInclude: (index: number) => void
  /** Nulls every pre-filled category — a category the user chose by hand is untouched. */
  onClearSuggestions: () => void
}

export function CsvReviewTable({
  rows,
  categories,
  destinationAccounts,
  onRowChange,
  onToggleInclude,
  onClearSuggestions,
}: CsvReviewTableProps) {
  // Category options valid for a row's direction — an income category must not
  // be selectable on an expense row (matches TransactionForm/RecurringPage).
  const categoryOptionsFor = (type: 'income' | 'expense') => [
    { value: '', label: 'No category' },
    ...categories
      .filter((c) => c.type === type || c.type === 'both')
      .map((c) => ({ value: c.id, label: c.name })),
  ]

  const typeOptions = [
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfer' },
  ]

  const destinationOptions = [
    { value: '', label: 'To account…' },
    ...destinationAccounts.map((a) => ({ value: a.id, label: a.name })),
  ]

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-fg-faint">
        No rows to import.
      </div>
    )
  }

  const suggestedCount = rows.filter((r) => r.suggestionApplied).length

  return (
    <div>
      {suggestedCount > 0 && (
        <div
          data-testid="csv-suggestions-banner"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface-sunken border border-line px-3 py-2 text-xs text-fg-subtle"
        >
          <span>
            Suggested a category for {suggestedCount} of {rows.length} row{rows.length !== 1 ? 's' : ''} — check the
            Category column before importing.
          </span>
          <button
            type="button"
            onClick={onClearSuggestions}
            className="flex-shrink-0 font-medium text-brand-600 hover:text-brand-700"
          >
            Clear suggestions
          </button>
        </div>
      )}
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-3 py-2 font-medium text-fg-subtle w-10">
              <span className="sr-only">Include</span>
            </th>
            <th className="px-3 py-2 font-medium text-fg-subtle">Date</th>
            <th className="px-3 py-2 font-medium text-fg-subtle">Merchant</th>
            <th className="px-3 py-2 font-medium text-fg-subtle">Description</th>
            <th className="px-3 py-2 font-medium text-fg-subtle w-28">Amount</th>
            <th className="px-3 py-2 font-medium text-fg-subtle w-24">Type</th>
            <th className="px-3 py-2 font-medium text-fg-subtle w-36">Category</th>
            <th className="px-3 py-2 font-medium text-fg-subtle w-20">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((row, index) => (
            <tr
              key={index}
              data-testid="csv-review-row"
              className={cn(
                'transition-colors',
                !row.included && 'bg-surface-sunken opacity-60',
                row.included && row.suggestionApplied && 'bg-surface-sunken',
                row.isDuplicate && 'bg-amber-50/50'
              )}
            >
              {/* Checkbox */}
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={() => onToggleInclude(index)}
                  className="h-4 w-4 rounded border-line-strong text-brand-500 focus:ring-brand-500"
                  data-testid="csv-row-include"
                  aria-label={`Include row ${index + 1}`}
                />
              </td>

              {/* Date */}
              <td className="px-3 py-2">
                <DatePicker
                  value={row.date}
                  onChange={(e) =>
                    onRowChange(index, { date: e.target.value })
                  }
                  className="w-36 text-xs"
                  disabled={!row.included}
                  data-testid="csv-row-date"
                />
              </td>

              {/* Merchant — editable so a garbled bank column can be fixed here (U-14) */}
              <td className="px-3 py-2">
                <Input
                  value={row.merchant}
                  onChange={(e) =>
                    // A merchant edit invalidates the suggestion's provenance
                    // (G11: it is never re-run under the cursor), so the
                    // caption/tint drop even though the pre-filled category
                    // itself is left alone.
                    onRowChange(index, {
                      merchant: e.target.value,
                      suggestedFrom: undefined,
                      suggestionApplied: false,
                    })
                  }
                  className="w-40 text-xs"
                  placeholder="—"
                  disabled={!row.included}
                  aria-label={`Merchant for row ${index + 1}`}
                />
              </td>

              {/* Description — raw bank narrative, editable for clarity */}
              <td className="px-3 py-2">
                <Input
                  value={row.description}
                  onChange={(e) =>
                    onRowChange(index, { description: e.target.value })
                  }
                  className="w-48 text-xs"
                  placeholder="—"
                  disabled={!row.included}
                  aria-label={`Description for row ${index + 1}`}
                />
              </td>

              {/* Amount */}
              <td className="px-3 py-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) =>
                    onRowChange(index, {
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-28 text-xs"
                  disabled={!row.included}
                  data-testid="csv-row-amount"
                />
              </td>

              {/* Type */}
              <td className="px-3 py-2">
                <Select
                  options={typeOptions}
                  data-testid="csv-row-type"
                  value={row.type}
                  onChange={(e) => {
                    const type = e.target.value as ImportRow['type']
                    if (type === 'transfer') {
                      // Transfers are uncategorised; the destination is chosen next.
                      onRowChange(index, {
                        type,
                        categoryId: null,
                        suggestedFrom: undefined,
                        suggestionApplied: false,
                      })
                      return
                    }
                    // Drop a now-invalid category when the direction flips, so an
                    // income category can't linger on an expense row.
                    const stillValid = categoryOptionsFor(type).some(
                      (o) => o.value === (row.categoryId ?? ''),
                    )
                    onRowChange(index, {
                      type,
                      categoryId: stillValid ? row.categoryId : null,
                      destinationAccountId: null,
                      ...(stillValid ? {} : { suggestedFrom: undefined, suggestionApplied: false }),
                    })
                  }}
                  className="text-xs"
                  disabled={!row.included}
                  aria-label={`Type for row ${index + 1}`}
                />
              </td>

              {/* Category — or destination account for transfer rows */}
              <td className="px-3 py-2">
                {row.type === 'transfer' ? (
                  <Select
                    options={destinationOptions}
                    data-testid="csv-row-destination"
                    value={row.destinationAccountId ?? ''}
                    onChange={(e) =>
                      onRowChange(index, {
                        destinationAccountId: e.target.value || null,
                      })
                    }
                    className="text-xs"
                    disabled={!row.included}
                    aria-label={`Destination account for row ${index + 1}`}
                  />
                ) : (
                  <>
                    <Select
                      options={categoryOptionsFor(row.type)}
                      data-testid="csv-row-category"
                      value={row.categoryId ?? ''}
                      onChange={(e) =>
                        // A hand-picked category overrides the suggestion —
                        // clear its provenance so the caption/tint drop too.
                        onRowChange(index, {
                          categoryId: e.target.value || null,
                          suggestedFrom: undefined,
                          suggestionApplied: false,
                        })
                      }
                      className="text-xs"
                      disabled={!row.included}
                    />
                    {row.suggestionApplied && row.suggestedFrom && (
                      <p className="mt-1 text-[11px] text-fg-subtle">
                        {row.suggestedFrom.canonical} ·{' '}
                        {row.suggestedFrom.matchCount > 0
                          ? `you categorised this ${row.suggestedFrom.matchCount}×`
                          : 'common merchant'}
                      </p>
                    )}
                  </>
                )}
              </td>

              {/* Status */}
              <td className="px-3 py-2">
                {row.isDuplicate ? (
                  <Badge variant="warning">Duplicate</Badge>
                ) : row.included ? (
                  <Badge variant="success">New</Badge>
                ) : (
                  <Badge variant="default">Excluded</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary */}
      <div className="mt-3 flex items-center gap-4 border-t border-line px-3 py-3 text-xs text-fg-subtle">
        <span>
          Total rows: {rows.length}
        </span>
        <span>
          To import: {rows.filter((r) => r.included).length}
        </span>
        <span>
          Duplicates: {rows.filter((r) => r.isDuplicate).length}
        </span>
        <span>
          Excluded: {rows.filter((r) => !r.included && !r.isDuplicate).length}
        </span>
        <span className="ml-auto font-medium text-fg-muted">
          Total amount: {formatMYR(
            rows
              .filter((r) => r.included)
              .reduce((sum, r) => sum + r.amount, 0)
          )}
        </span>
      </div>
    </div>
    </div>
  )
}
