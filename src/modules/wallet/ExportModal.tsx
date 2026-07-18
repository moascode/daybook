import { useState } from 'react'
import { Download } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn, formatMYR } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import type { Transaction, Account, Category } from '@/types/wallet.types'

interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  onExport: (format: 'csv' | 'json', ids: string[]) => void
}

export function ExportModal({
  open,
  onOpenChange,
  transactions,
  accounts,
  categories,
  onExport,
}: ExportModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevTransactions, setPrevTransactions] = useState(transactions)

  // Reset selection when the modal opens or the transaction list changes — adjust
  // state during render to avoid setState-in-effect (react-hooks/set-state-in-effect).
  if (open !== prevOpen || transactions !== prevTransactions) {
    setPrevOpen(open)
    setPrevTransactions(transactions)
    if (open) {
      setSelectedIds(new Set(transactions.map((t) => t.id)))
    }
  }

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)))
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport(fmt: 'csv' | 'json') {
    onExport(fmt, Array.from(selectedIds))
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export Transactions"
      className="max-w-lg"
    >
      <div className="space-y-3">
        {transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No transactions match the current filters.
          </p>
        ) : (
          <>
            {/* Header row with select-all */}
            <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 cursor-pointer"
                aria-label="Select all transactions for export"
                data-testid="export-select-all"
              />
              <span className="flex-1 text-sm font-medium text-gray-700">
                {selectedIds.size} of {transactions.length} selected
              </span>
            </div>

            {/* Transaction list */}
            <div
              data-testid="export-transaction-list"
              className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100"
            >
              {transactions.map((t) => {
                const account = accounts.find((a) => a.id === t.accountId)
                const category = t.categoryId ? categories.find((c) => c.id === t.categoryId) : null
                const checked = selectedIds.has(t.id)
                return (
                  <label
                    key={t.id}
                    data-testid="export-transaction-row"
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
                      checked ? 'bg-brand-50' : 'hover:bg-gray-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(t.id)}
                      className="h-4 w-4 flex-shrink-0 rounded border-gray-300 text-brand-600 cursor-pointer"
                      aria-label={`Select ${t.merchant || t.description || 'transaction'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">
                          {t.merchant || t.description || 'Untitled'}
                        </span>
                        {category && (
                          <span className="flex-shrink-0 text-xs text-gray-400">
                            {category.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                        {account && <span>{account.name}</span>}
                        <span>{format(parseISO(t.date), 'dd MMM yyyy')}</span>
                      </div>
                    </div>
                    <span className={cn(
                      'flex-shrink-0 text-sm font-semibold',
                      t.type === 'income' ? 'text-positive-600' :
                      t.type === 'expense' ? 'text-red-600' : 'text-blue-600',
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}
                      {formatMYR(t.amount)}
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleExport('json')}
            disabled={selectedIds.size === 0}
            data-testid="export-json-btn"
          >
            <Download className="h-3.5 w-3.5" />
            JSON ({selectedIds.size})
          </Button>
          <Button
            onClick={() => handleExport('csv')}
            disabled={selectedIds.size === 0}
            data-testid="export-csv-btn"
          >
            <Download className="h-3.5 w-3.5" />
            CSV ({selectedIds.size})
          </Button>
        </div>
      </div>
    </Modal>
  )
}
