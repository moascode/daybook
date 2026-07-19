import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Trash2, ArrowRightLeft, Pencil, Scissors, Users } from 'lucide-react'
import { cn, formatMYR } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { Transaction, Account, Category, DailyGroup } from '@/types/wallet.types'

interface TransactionListProps {
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  onEdit: (transaction: Transaction) => void
  onDelete: (id: string) => void
  onSplit: (transaction: Transaction) => void
  selectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

function groupByDay(transactions: Transaction[]): DailyGroup[] {
  const grouped = new Map<string, Transaction[]>()

  for (const t of transactions) {
    const existing = grouped.get(t.date)
    if (existing) {
      existing.push(t)
    } else {
      grouped.set(t.date, [t])
    }
  }

  const groups: DailyGroup[] = []
  for (const [date, txns] of grouped) {
    let totalIncome = 0
    let totalExpense = 0
    for (const t of txns) {
      if (t.type === 'income') totalIncome += t.amount
      else if (t.type === 'expense') totalExpense += t.amount
      // transfers excluded
    }
    groups.push({ date, transactions: txns, totalIncome, totalExpense })
  }

  // Sort by date descending
  groups.sort((a, b) => b.date.localeCompare(a.date))
  return groups
}

function TransactionRow({
  transaction,
  accounts,
  categories,
  onEdit,
  onSplit,
  onRequestDelete,
  selectMode,
  isSelected,
  onToggleSelect,
}: {
  transaction: Transaction
  accounts: Account[]
  categories: Category[]
  onEdit: (t: Transaction) => void
  onSplit: (t: Transaction) => void
  onRequestDelete: (t: Transaction) => void
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const account = accounts.find((a) => a.id === transaction.accountId)
  const destAccount = transaction.destinationAccountId
    ? accounts.find((a) => a.id === transaction.destinationAccountId)
    : null
  const category = transaction.categoryId
    ? categories.find((c) => c.id === transaction.categoryId)
    : null
  const isOnSharedAccount = account?.isShared

  const amountColor =
    transaction.type === 'income'
      ? 'text-positive-600'
      : transaction.type === 'expense'
        ? 'text-red-600'
        : 'text-blue-600'

  const amountPrefix =
    transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''

  function handleRowClick() {
    if (selectMode) {
      onToggleSelect?.(transaction.id)
    } else {
      onEdit(transaction)
    }
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Nested action buttons handle their own keys; only act on the row itself.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleRowClick()
    }
  }

  return (
    <div
      data-testid="transaction-row"
      role="button"
      tabIndex={0}
      aria-label={`${selectMode ? 'Select' : 'Edit'} transaction ${transaction.merchant || transaction.description || 'Untitled'}`}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
        selectMode && isSelected ? 'bg-brand-50' : 'hover:bg-gray-50',
      )}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
    >
      {/* Checkbox (select mode) or type indicator */}
      {selectMode ? (
        <input
          type="checkbox"
          checked={isSelected ?? false}
          onChange={() => onToggleSelect?.(transaction.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 flex-shrink-0 rounded border-gray-300 text-brand-600 cursor-pointer"
          aria-label="Select transaction"
        />
      ) : (
        <div
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
            transaction.type === 'income'
              ? 'bg-positive-50 text-positive-600'
              : transaction.type === 'expense'
                ? 'bg-red-50 text-red-600'
                : 'bg-blue-50 text-blue-600'
          )}
        >
          {transaction.type === 'transfer' ? (
            <ArrowRightLeft className="h-3.5 w-3.5" />
          ) : transaction.type === 'income' ? (
            '+'
          ) : (
            '-'
          )}
        </div>
      )}

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {transaction.merchant || transaction.description || 'Untitled'}
          </span>
          {transaction.hasShares && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
              <Users className="h-2.5 w-2.5" />
              Split
            </span>
          )}
          {category && (
            <Badge color={category.color} className="flex-shrink-0">
              {category.name}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
          {account && <span>{account.name}</span>}
          {isOnSharedAccount && account?.sharedByUsername && (
            <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600 font-medium">
              {account.sharedByUsername}
            </span>
          )}
          {destAccount && (
            <>
              <ArrowRightLeft className="h-3 w-3" />
              <span>{destAccount.name}</span>
            </>
          )}
          {transaction.description && transaction.merchant && (
            <span className="truncate">- {transaction.description}</span>
          )}
          {transaction.tags.map((tag) => (
            <Badge key={tag} variant="default" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Amount */}
      <span className={cn('flex-shrink-0 text-sm font-semibold', amountColor)}>
        {amountPrefix}{formatMYR(transaction.amount)}
      </span>

      {/* Row actions — hidden in select mode */}
      {!selectMode && (
        <div
          className="flex flex-shrink-0 items-center gap-0.5 text-gray-400 transition-colors group-hover:text-gray-600"
          onClick={(e) => e.stopPropagation()}
        >
          {/* U-6: hide split button on transfer transactions */}
          {transaction.type !== 'transfer' && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
              onClick={() => onSplit(transaction)}
              aria-label="Split transaction"
              title="Split with household members"
              data-testid="split-transaction-btn"
            >
              <Scissors className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
            onClick={() => onEdit(transaction)}
            aria-label="Edit transaction"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
            onClick={() => onRequestDelete(transaction)}
            aria-label="Delete transaction"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </div>
      )}
    </div>
  )
}

export function TransactionList({
  transactions,
  accounts,
  categories,
  onEdit,
  onDelete,
  onSplit,
  selectMode,
  selectedIds,
  onToggleSelect,
}: TransactionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const dailyGroups = useMemo(() => groupByDay(transactions), [transactions])

  function handleConfirmDelete() {
    if (deleteTarget) {
      onDelete(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  if (dailyGroups.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        No transactions found for the selected filters.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-1">
        {dailyGroups.map((group) => (
          <div key={group.date}>
            {/* Day header */}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {format(parseISO(group.date), 'dd MMM yyyy')}
              </span>
              <div className="flex items-center gap-3 text-xs">
                {group.totalIncome > 0 && (
                  <span className="text-positive-600">
                    +{formatMYR(group.totalIncome)}
                  </span>
                )}
                {group.totalExpense > 0 && (
                  <span className="text-red-600">
                    -{formatMYR(group.totalExpense)}
                  </span>
                )}
              </div>
            </div>

            {/* Transactions in this day */}
            <div className="divide-y divide-gray-100">
              {group.transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  accounts={accounts}
                  categories={categories}
                  onEdit={onEdit}
                  onSplit={onSplit}
                  onRequestDelete={setDeleteTarget}
                  selectMode={selectMode}
                  isSelected={selectedIds?.has(t.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Transaction"
        description={`Delete transaction "${deleteTarget?.merchant || deleteTarget?.description || 'Untitled'}" for ${deleteTarget ? formatMYR(deleteTarget.amount) : ''}?`}
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </>
  )
}
