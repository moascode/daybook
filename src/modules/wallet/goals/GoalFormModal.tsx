import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Account } from '@/types/wallet.types'

export interface GoalFormData {
  name: string
  targetAmount: string
  accountId: string
  targetDate: string
  note: string
}

interface GoalFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isEdit: boolean
  form: GoalFormData
  setForm: (updater: (f: GoalFormData) => GoalFormData) => void
  accounts: Account[]
  formError: string | null
  saving: boolean
  onSubmit: () => void
}

/** The New/Edit Goal modal — extracted from GoalsPage so the page stays assembly-only (FEAT-067). */
export function GoalFormModal({
  open, onOpenChange, isEdit, form, setForm, accounts, formError, saving, onSubmit,
}: GoalFormModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit Goal' : 'New Goal'}>
      <div className="flex flex-col gap-4">
        <Input
          label="Goal name"
          id="goal-name"
          placeholder="e.g. Emergency Fund"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          label="Target amount"
          id="target-amount"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={form.targetAmount}
          onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
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
          label="Target date"
          id="goal-target-date"
          type="date"
          value={form.targetDate}
          onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
        />
        <Input
          label="Note"
          id="goal-note-input"
          placeholder="Optional — shown on the card"
          maxLength={80}
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
        {formError && <p className="-mt-1 text-xs text-red-600">{formError}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={onSubmit} loading={saving}>{isEdit ? 'Save Changes' : 'Create Goal'}</Button>
        </div>
      </div>
    </Modal>
  )
}
