import { useState, useCallback } from 'react'
import { Scissors } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { TagInput } from '@/components/ui/TagInput'
import { cn, formatMYR } from '@/lib/utils'
import type { Transaction, Category } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'

interface SplitPart {
  amount: number
  merchant: string
  description: string
  categoryId: string | null
  tags: string[]
}

interface SplitTransactionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
  categories: Category[]
  availableTags?: string[]
  onConfirm: (parts: [TransactionFormData, TransactionFormData]) => Promise<void>
}

function defaultPart(transaction: Transaction): SplitPart {
  return {
    amount: parseFloat((transaction.amount / 2).toFixed(2)),
    merchant: transaction.merchant,
    description: transaction.description,
    categoryId: transaction.categoryId,
    tags: transaction.tags,
  }
}

export function SplitTransactionModal({
  open,
  onOpenChange,
  transaction,
  categories,
  availableTags,
  onConfirm,
}: SplitTransactionModalProps) {
  const [parts, setParts] = useState<[SplitPart, SplitPart]>(() => {
    if (!transaction) return [
      { amount: 0, merchant: '', description: '', categoryId: null, tags: [] },
      { amount: 0, merchant: '', description: '', categoryId: null, tags: [] },
    ]
    const half = parseFloat((transaction.amount / 2).toFixed(2))
    const other = parseFloat((transaction.amount - half).toFixed(2))
    return [
      { ...defaultPart(transaction), amount: half },
      { ...defaultPart(transaction), amount: other },
    ]
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Reset when transaction changes
  const [prevTransaction, setPrevTransaction] = useState(transaction)
  if (transaction !== prevTransaction) {
    setPrevTransaction(transaction)
    if (transaction && open) {
      const half = parseFloat((transaction.amount / 2).toFixed(2))
      const other = parseFloat((transaction.amount - half).toFixed(2))
      setParts([
        { ...defaultPart(transaction), amount: half },
        { ...defaultPart(transaction), amount: other },
      ])
      setErrors({})
    }
  }

  const total = transaction?.amount ?? 0

  const updateAmount = useCallback((idx: 0 | 1, raw: string) => {
    const val = parseFloat(raw) || 0
    const other = parseFloat((total - val).toFixed(2))
    setParts((prev) => {
      const next: [SplitPart, SplitPart] = [{ ...prev[0] }, { ...prev[1] }]
      next[idx].amount = val
      next[1 - idx as 0 | 1].amount = Math.max(0, other)
      return next
    })
  }, [total])

  const updateField = useCallback(<K extends keyof SplitPart>(idx: 0 | 1, key: K, value: SplitPart[K]) => {
    setParts((prev) => {
      const next: [SplitPart, SplitPart] = [{ ...prev[0] }, { ...prev[1] }]
      next[idx] = { ...next[idx], [key]: value }
      return next
    })
  }, [])

  const filteredCategories = (type: string) =>
    categories.filter((c) => {
      if (type === 'transfer') return false
      if (c.type === 'both') return true
      return c.type === type
    })

  async function handleConfirm() {
    if (!transaction) return
    const errs: Record<string, string> = {}
    const sum = parseFloat((parts[0].amount + parts[1].amount).toFixed(2))
    if (Math.abs(sum - total) > 0.01) {
      errs.total = `Split amounts must add up to ${formatMYR(total)} (currently ${formatMYR(sum)})`
    }
    if (parts[0].amount <= 0) errs.part0amount = 'Amount must be greater than 0'
    if (parts[1].amount <= 0) errs.part1amount = 'Amount must be greater than 0'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    try {
      const make = (p: SplitPart): TransactionFormData => ({
        accountId: transaction.accountId,
        destinationAccountId: transaction.destinationAccountId,
        date: transaction.date,
        merchant: p.merchant.trim(),
        description: p.description.trim(),
        amount: p.amount,
        type: transaction.type,
        categoryId: transaction.type === 'transfer' ? null : (p.categoryId || null),
        tags: p.tags,
      })
      await onConfirm([make(parts[0]), make(parts[1])])
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (!transaction) return null

  const catOptions = (type: string) => [
    { value: '', label: 'No category' },
    ...filteredCategories(type).map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Split Transaction"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Original transaction summary */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Original:</span>
            <span className="font-semibold text-gray-800">{formatMYR(total)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-gray-400">
            <span>{transaction.merchant || transaction.description || 'Untitled'}</span>
            <span>{transaction.date}</span>
          </div>
        </div>

        {errors.total && (
          <p className="text-sm text-red-600">{errors.total}</p>
        )}

        {/* Side-by-side split parts */}
        <div className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map((idx) => {
            const part = parts[idx]
            return (
              <div
                key={idx}
                data-testid={`split-part-${idx}`}
                className="rounded-xl border border-gray-200 p-4 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Scissors className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">
                    Part {idx + 1}
                  </span>
                  <span className={cn(
                    'ml-auto text-sm font-bold',
                    transaction.type === 'income' ? 'text-green-600' :
                    transaction.type === 'expense' ? 'text-red-600' : 'text-blue-600',
                  )}>
                    {formatMYR(part.amount)}
                  </span>
                </div>

                <Input
                  id={`split-amount-${idx}`}
                  label="Amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={part.amount || ''}
                  onChange={(e) => updateAmount(idx, e.target.value)}
                  error={errors[`part${idx}amount`]}
                />

                <Input
                  label="Merchant"
                  placeholder="e.g. Grab, Starbucks"
                  value={part.merchant}
                  onChange={(e) => updateField(idx, 'merchant', e.target.value)}
                />

                <Input
                  label="Description"
                  placeholder="Optional note"
                  value={part.description}
                  onChange={(e) => updateField(idx, 'description', e.target.value)}
                />

                {transaction.type !== 'transfer' && (
                  <Select
                    label="Category"
                    options={catOptions(transaction.type)}
                    value={part.categoryId ?? ''}
                    onChange={(e) => updateField(idx, 'categoryId', e.target.value || null)}
                  />
                )}

                {transaction.type !== 'transfer' && (
                  <TagInput
                    label="Tags"
                    value={part.tags}
                    onChange={(tags) => updateField(idx, 'tags', tags)}
                    suggestions={availableTags}
                    allowCreate
                    placeholder="Add tags..."
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Running total indicator */}
        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-2 text-sm">
          <span className="text-gray-500">
            {formatMYR(parts[0].amount)} + {formatMYR(parts[1].amount)}
          </span>
          <span className={cn(
            'font-semibold',
            Math.abs(parts[0].amount + parts[1].amount - total) < 0.01
              ? 'text-green-600'
              : 'text-red-600',
          )}>
            = {formatMYR(parts[0].amount + parts[1].amount)}
            {' '}
            {Math.abs(parts[0].amount + parts[1].amount - total) < 0.01 ? '✓' : `(need ${formatMYR(total)})`}
          </span>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="confirm-split-btn"
          >
            {submitting ? 'Creating…' : 'Create 2 Transactions'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
