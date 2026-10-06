import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/Button'
import type { Account, RecurrenceFrequency, TransactionType } from '@/types/wallet.types'

export interface RecurringFormData {
  accountId: string
  amount: string
  merchant: string
  type: TransactionType
  categoryId: string
  frequency: RecurrenceFrequency
  nextDueDate: string
}

interface RecurringFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isEdit: boolean
  form: RecurringFormData
  setForm: (updater: (f: RecurringFormData) => RecurringFormData) => void
  accounts: Account[]
  categoryOptions: { value: string; label: string }[]
  formError: string | null
  saving: boolean
  onSubmit: () => void
}

/** The New/Edit Recurring Rule modal — extracted from RecurringPage (FEAT-068) so the page stays assembly-only. Also used, pre-filled, by DetectFromHistoryModal's "Add as recurring". */
export function RecurringFormModal({
  open, onOpenChange, isEdit, form, setForm, accounts, categoryOptions, formError, saving, onSubmit,
}: RecurringFormModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit Recurring Rule' : 'New Recurring Rule'}>
      <div className="flex flex-col gap-4">
        <Select
          label="Type"
          id="type"
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TransactionType, categoryId: '' }))}
        />
        <Input
          label="Amount"
          id="amount"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
        <Select
          label="Account"
          id="account"
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          placeholder="Select account"
          value={form.accountId}
          onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
        />
        <Input
          label="Merchant"
          id="merchant"
          type="text"
          placeholder="e.g. Netflix"
          value={form.merchant}
          onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
        />
        <Select
          label="Category"
          id="category"
          options={[{ value: '', label: 'No category' }, ...categoryOptions]}
          value={form.categoryId}
          onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
        />
        <Select
          label="Frequency"
          id="frequency"
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'weekly', label: 'Weekly' },
          ]}
          value={form.frequency}
          onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFrequency }))}
        />
        <DatePicker
          label="Next due"
          value={form.nextDueDate}
          onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))}
        />
        {formError && <p className="-mt-1 text-xs text-red-600">{formError}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={onSubmit} loading={saving}>{isEdit ? 'Save Changes' : 'Create Rule'}</Button>
        </div>
      </div>
    </Modal>
  )
}
