import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { Badge } from '@/components/ui/Badge'
import { cn, formatMYR } from '@/lib/utils'
import type { ImportRow } from '@/lib/csv'
import type { Category } from '@/types/wallet.types'

interface CsvReviewTableProps {
  rows: ImportRow[]
  categories: Category[]
  onRowChange: (index: number, updates: Partial<ImportRow>) => void
  onToggleInclude: (index: number) => void
}

export function CsvReviewTable({
  rows,
  categories,
  onRowChange,
  onToggleInclude,
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
  ]

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No rows to import.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="px-3 py-2 font-medium text-gray-500 w-10">
              <span className="sr-only">Include</span>
            </th>
            <th className="px-3 py-2 font-medium text-gray-500">Date</th>
            <th className="px-3 py-2 font-medium text-gray-500">Merchant</th>
            <th className="px-3 py-2 font-medium text-gray-500 w-28">Amount</th>
            <th className="px-3 py-2 font-medium text-gray-500 w-24">Type</th>
            <th className="px-3 py-2 font-medium text-gray-500 w-36">Category</th>
            <th className="px-3 py-2 font-medium text-gray-500 w-20">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, index) => (
            <tr
              key={index}
              className={cn(
                'transition-colors',
                !row.included && 'bg-gray-50 opacity-60',
                row.isDuplicate && 'bg-amber-50/50'
              )}
            >
              {/* Checkbox */}
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={() => onToggleInclude(index)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
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
                />
              </td>

              {/* Merchant — editable so a garbled bank column can be fixed here (U-14) */}
              <td className="px-3 py-2">
                <Input
                  value={row.merchant}
                  onChange={(e) => onRowChange(index, { merchant: e.target.value })}
                  className="w-40 text-xs"
                  placeholder="—"
                  disabled={!row.included}
                  aria-label={`Merchant for row ${index + 1}`}
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
                />
              </td>

              {/* Type */}
              <td className="px-3 py-2">
                <Select
                  options={typeOptions}
                  value={row.type}
                  onChange={(e) => {
                    // Drop a now-invalid category when the direction flips, so an
                    // income category can't linger on an expense row.
                    const type = e.target.value as 'income' | 'expense'
                    const stillValid = categoryOptionsFor(type).some(
                      (o) => o.value === (row.categoryId ?? ''),
                    )
                    onRowChange(index, {
                      type,
                      categoryId: stillValid ? row.categoryId : null,
                    })
                  }}
                  className="text-xs"
                  disabled={!row.included}
                />
              </td>

              {/* Category */}
              <td className="px-3 py-2">
                <Select
                  options={categoryOptionsFor(row.type)}
                  value={row.categoryId ?? ''}
                  onChange={(e) =>
                    onRowChange(index, {
                      categoryId: e.target.value || null,
                    })
                  }
                  className="text-xs"
                  disabled={!row.included}
                />
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
      <div className="mt-3 flex items-center gap-4 border-t border-gray-200 px-3 py-3 text-xs text-gray-500">
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
        <span className="ml-auto font-medium text-gray-700">
          Total amount: {formatMYR(
            rows
              .filter((r) => r.included)
              .reduce((sum, r) => sum + r.amount, 0)
          )}
        </span>
      </div>
    </div>
  )
}
