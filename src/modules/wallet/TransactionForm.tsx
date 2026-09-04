import { useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TagInput } from '@/components/ui/TagInput'
import { cn, todayISO } from '@/lib/utils'
import { TransferMatchHint, type TransferMatchCandidate } from '@/modules/wallet/TransferMatchHint'
import { TransferLinkHint } from '@/modules/wallet/TransferLinkHint'
import type { Account, Transaction, Category, TransactionType } from '@/types/wallet.types'

interface TransactionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  defaultAccountId?: string | null
  availableTags?: string[]
  onSubmit: (data: TransactionFormData) => void | Promise<void>
  /** Edit mode only: opens the link-as-transfer picker for this transaction. */
  onLinkTransfer?: () => void
  /**
   * Edit mode only: links this transaction directly to `candidateId` — the
   * one-click path when TransferLinkHint's proactive search already found the
   * twin, skipping the manual picker onLinkTransfer opens.
   */
  onQuickLinkTransfer?: (candidateId: string) => Promise<void>
  /**
   * Create mode only, type=transfer: creates the missing leg from the form's
   * current fields and links it to `candidate` instead of inserting a new
   * transfer row. Closes the form on success, same as a normal submit.
   */
  onLinkExistingTransfer?: (candidate: TransferMatchCandidate, data: TransactionFormData) => Promise<void>
  /**
   * Create mode only: partial field values to pre-fill on top of the normal
   * create-mode defaults (e.g. from a composer draft). Ignored entirely when
   * `transaction` is provided (edit mode).
   */
  initialDraft?: Partial<TransactionFormData>
}

export interface TransactionFormData {
  accountId: string
  destinationAccountId: string | null
  date: string
  merchant: string
  description: string
  amount: number
  type: TransactionType
  categoryId: string | null
  tags: string[]
}

const TYPE_OPTIONS: { value: TransactionType; label: string; color: string }[] = [
  { value: 'expense', label: 'Expense', color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'income', label: 'Income', color: 'text-positive-600 bg-positive-50 border-positive-200' },
  { value: 'transfer', label: 'Transfer', color: 'text-blue-600 bg-blue-50 border-blue-200' },
]

function getInitialState(
  transaction?: Transaction | null,
  defaultAccountId?: string | null,
  accounts: Account[] = [],
  initialDraft?: Partial<TransactionFormData> | null,
): TransactionFormData {
  const base: TransactionFormData = {
    // Pre-select an account so the common single-account case needs no extra
    // click: the active account filter if set, otherwise the first account.
    accountId: transaction?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? '',
    destinationAccountId: transaction?.destinationAccountId ?? null,
    date: transaction?.date ?? todayISO(),
    merchant: transaction?.merchant ?? '',
    description: transaction?.description ?? '',
    amount: transaction?.amount ?? 0,
    type: transaction?.type ?? 'expense',
    categoryId: transaction?.categoryId ?? null,
    tags: transaction?.tags ?? [],
  }
  // Create mode only: a partial draft pre-fills over the defaults above.
  // Edit mode (transaction set) never applies a draft.
  if (!transaction && initialDraft) {
    return { ...base, ...initialDraft }
  }
  return base
}

export function TransactionForm({
  open,
  onOpenChange,
  transaction,
  accounts,
  categories,
  defaultAccountId,
  availableTags,
  onSubmit,
  onLinkTransfer,
  onQuickLinkTransfer,
  onLinkExistingTransfer,
  initialDraft,
}: TransactionFormProps) {
  const [form, setForm] = useState<TransactionFormData>(
    getInitialState(transaction, defaultAccountId, accounts, initialDraft)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [linkingExisting, setLinkingExisting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevTransaction, setPrevTransaction] = useState(transaction)
  const [prevDefaultAccountId, setPrevDefaultAccountId] = useState(defaultAccountId)
  const [prevInitialDraft, setPrevInitialDraft] = useState(initialDraft)
  const amountRef = useRef<HTMLInputElement>(null)

  // Reset the form when the modal (re)opens or its inputs change — adjust state
  // during render rather than in an effect.
  if (
    open !== prevOpen ||
    transaction !== prevTransaction ||
    defaultAccountId !== prevDefaultAccountId ||
    initialDraft !== prevInitialDraft
  ) {
    setPrevOpen(open)
    setPrevTransaction(transaction)
    setPrevDefaultAccountId(defaultAccountId)
    setPrevInitialDraft(initialDraft)
    if (open) {
      setForm(getInitialState(transaction, defaultAccountId, accounts, initialDraft))
      setErrors({})
    }
  }

  // Filter categories based on transaction type
  const filteredCategories = categories.filter((c) => {
    if (form.type === 'transfer') return false
    if (c.type === 'both') return true
    return c.type === form.type
  })

  // Account options for select
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.name,
  }))

  // Destination account options (exclude source account)
  const destAccountOptions = accounts
    .filter((a) => a.id !== form.accountId)
    .map((a) => ({ value: a.id, label: a.name }))

  const categoryOptions = [
    { value: '', label: 'No category' },
    ...filteredCategories.map((c) => ({
      value: c.id,
      label: c.name,
    })),
  ]

  function validate(): boolean {
    const errs: Record<string, string> = {}

    if (!form.accountId) errs.accountId = 'Select an account'
    if (form.amount <= 0) errs.amount = 'Amount must be greater than 0'
    if (!form.date) errs.date = 'Date is required'
    if (form.type === 'transfer' && !form.destinationAccountId) {
      errs.destinationAccountId = 'Select a destination account'
    }
    if (form.type === 'transfer' && form.destinationAccountId === form.accountId) {
      errs.destinationAccountId = 'Cannot transfer to the same account'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function buildSubmitData(): TransactionFormData {
    return {
      ...form,
      merchant: form.merchant.trim(),
      description: form.description.trim(),
      categoryId: form.type === 'transfer' ? null : (form.categoryId || null),
      destinationAccountId: form.type === 'transfer' ? form.destinationAccountId : null,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !validate()) return
    setSaving(true)
    try {
      await onSubmit(buildSubmitData())
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  // B2: submit but keep the modal open for rapid entry — clear the per-item
  // fields, keep date/account/type (and category), and refocus Amount.
  async function handleSaveAndAddAnother() {
    if (saving || !validate()) return
    setSaving(true)
    try {
      await onSubmit(buildSubmitData())
      setForm((f) => ({ ...f, amount: 0, merchant: '', description: '', tags: [] }))
      setErrors({})
      amountRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  async function handlePickExistingMatch(candidate: TransferMatchCandidate) {
    if (!onLinkExistingTransfer || linkingExisting) return
    setLinkingExisting(true)
    try {
      await onLinkExistingTransfer(candidate, buildSubmitData())
      onOpenChange(false)
    } finally {
      setLinkingExisting(false)
    }
  }

  const isEdit = !!transaction

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit Transaction' : 'New Transaction'}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg-muted">Type</label>
          <div className="flex gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  form.type === opt.value
                    ? opt.color
                    : 'border-line text-fg-subtle hover:bg-surface-sunken'
                )}
                onClick={() => setForm((f) => ({ ...f, type: opt.value }))}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Imported rows between own accounts are often really one transfer —
              point at the fix without changing any behaviour. */}
          {isEdit && !!transaction?.importHash && form.type !== 'transfer' && (
            <p className="text-xs text-fg-faint" data-testid="transfer-hint">
              Moved money between your own accounts? Switch Type to Transfer, or
              link it to the other side below.
            </p>
          )}
          {isEdit && form.type !== 'transfer' && onLinkTransfer && (
            <TransferLinkHint
              transactionId={transaction!.id}
              accountId={form.accountId}
              type={form.type as 'expense' | 'income'}
              amount={form.amount}
              date={form.date}
              accounts={accounts}
              onLink={onQuickLinkTransfer ?? (async () => onLinkTransfer())}
              onOpenPicker={onLinkTransfer}
            />
          )}
        </div>

        {/* Date + Amount row */}
        <div className="grid grid-cols-2 gap-4">
          <DatePicker
            label="Date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            error={errors.date}
          />
          <Input
            ref={amountRef}
            label="Amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.amount || ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
            }
            error={errors.amount}
          />
        </div>

        {/* Account */}
        <Select
          label={form.type === 'transfer' ? 'From Account' : 'Account'}
          options={accountOptions}
          value={form.accountId}
          onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          placeholder="Select account"
          error={errors.accountId}
        />

        {/* Destination account for transfers */}
        {form.type === 'transfer' && (
          <Select
            label="To Account"
            options={destAccountOptions}
            value={form.destinationAccountId ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                destinationAccountId: e.target.value || null,
              }))
            }
            placeholder="Select destination"
            error={errors.destinationAccountId}
          />
        )}

        {/* Proactive merge suggestion — create mode only. See TransferMatchHint. */}
        {!isEdit &&
          form.type === 'transfer' &&
          form.destinationAccountId &&
          onLinkExistingTransfer && (
            <TransferMatchHint
              sourceAccountId={form.accountId}
              destinationAccountId={form.destinationAccountId}
              amount={form.amount}
              date={form.date}
              accounts={accounts}
              onLink={handlePickExistingMatch}
            />
          )}

        {/* Merchant */}
        <Input
          label="Merchant"
          placeholder="e.g. Grab, Starbucks"
          value={form.merchant}
          onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
        />

        {/* Description */}
        <Input
          label="Description"
          placeholder="Optional note"
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
        />

        {/* Category — hidden for transfers */}
        {form.type !== 'transfer' && (
          <Select
            label="Category"
            options={categoryOptions}
            value={form.categoryId ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                categoryId: e.target.value || null,
              }))
            }
          />
        )}

        {/* Tags */}
        {form.type !== 'transfer' && (
          <TagInput
            id="tags"
            label="Tags"
            value={form.tags}
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
            suggestions={availableTags}
            allowCreate
            placeholder="Add tags..."
          />
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {!isEdit && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveAndAddAnother}
              disabled={saving || linkingExisting}
              data-testid="save-add-another"
            >
              Save &amp; Add Another
            </Button>
          )}
          <Button type="submit" loading={saving} disabled={linkingExisting}>
            {isEdit ? 'Save Changes' : 'Add Transaction'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
