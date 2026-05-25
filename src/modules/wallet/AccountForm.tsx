import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Account } from '@/types/wallet.types'

interface AccountFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: Account | null
  onSubmit: (data: AccountFormData) => void
}

export interface AccountFormData {
  name: string
  description: string
  type: Account['type']
  currency: string
  color: string
  icon: string
}

const ACCOUNT_TYPES = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'e-wallet', label: 'E-Wallet' },
  { value: 'bank', label: 'Bank' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
]

const COLOR_PRESETS = [
  '#1D9E75', '#10b981', '#059669',
  '#3b82f6', '#6366f1', '#8b5cf6',
  '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6', '#6b7280',
]

const ICON_OPTIONS = [
  { value: 'wallet', label: 'Wallet' },
  { value: 'credit-card', label: 'Credit Card' },
  { value: 'banknote', label: 'Banknote' },
  { value: 'building', label: 'Building' },
  { value: 'piggy-bank', label: 'Piggy Bank' },
  { value: 'trending-up', label: 'Investment' },
  { value: 'smartphone', label: 'E-Wallet' },
  { value: 'coins', label: 'Coins' },
]

function getInitialState(account?: Account | null): AccountFormData {
  return {
    name: account?.name ?? '',
    description: account?.description ?? '',
    type: account?.type ?? 'cash',
    currency: account?.currency ?? 'MYR',
    color: account?.color ?? '#1D9E75',
    icon: account?.icon ?? 'wallet',
  }
}

export function AccountForm({ open, onOpenChange, account, onSubmit }: AccountFormProps) {
  const [form, setForm] = useState<AccountFormData>(getInitialState(account))
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(getInitialState(account))
      setError('')
    }
  }, [open, account])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.name.trim()) {
      setError('Account name is required')
      return
    }

    onSubmit({
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
    })
    onOpenChange(false)
  }

  const isEdit = !!account

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit Account' : 'New Account'}
      description={isEdit ? 'Update your account details.' : 'Add a new account to track your money.'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Account Name"
          placeholder="e.g. Maybank Savings"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={error}
          autoFocus
        />

        <Textarea
          label="Description"
          placeholder="Optional description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={2}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Type"
            options={ACCOUNT_TYPES}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Account['type'] }))}
          />

          <Input
            label="Currency"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
            maxLength={3}
          />
        </div>

        <Select
          label="Icon"
          options={ICON_OPTIONS}
          value={form.icon}
          onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
        />

        {/* Color swatches */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className={`h-7 w-7 rounded-full border-2 transition-transform ${
                  form.color === color
                    ? 'scale-110 border-gray-800'
                    : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setForm((f) => ({ ...f, color }))}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit">
            {isEdit ? 'Save Changes' : 'Create Account'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
