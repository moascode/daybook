import { useState, useEffect } from 'react'
import { Share2, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import type { Account } from '@/types/wallet.types'
import type { AccountShare, Group } from '@/types/household.types'

interface AccountFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: Account | null
  onSubmit: (data: AccountFormData) => void | Promise<void>
}

export interface AccountFormData {
  name: string
  description: string
  type: Account['type']
  currency: string
  color: string
  icon: string
  openingBalance: number
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
    openingBalance: account?.openingBalance ?? 0,
  }
}

export function AccountForm({ open, onOpenChange, account, onSubmit }: AccountFormProps) {
  const [form, setForm] = useState<AccountFormData>(getInitialState(account))
  const [error, setError] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevAccount, setPrevAccount] = useState(account)
  const [shares, setShares] = useState<AccountShare[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [shareGroupId, setShareGroupId] = useState('')
  const [shareCanWrite, setShareCanWrite] = useState(false)
  const [sharingLoading, setSharingLoading] = useState(false)

  useEffect(() => {
    if (!open || !account) return
    Promise.all([
      api.get<AccountShare[]>(`/accounts/${account.id}/shares`),
      api.get<Group[]>('/groups'),
    ]).then(([s, g]) => { setShares(s); setGroups(g) }).catch(() => {})
  }, [open, account])

  // Reset the form to the (re)opened account's values — adjust state during
  // render when open/account changes, rather than in an effect.
  if (open !== prevOpen || account !== prevAccount) {
    setPrevOpen(open)
    setPrevAccount(account)
    if (open) {
      setForm(getInitialState(account))
      setError('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.name.trim()) {
      setError('Account name is required')
      return
    }

    await onSubmit({
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

        <Select
          label="Type"
          options={ACCOUNT_TYPES}
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Account['type'] }))}
        />
        {/* Currency is fixed to the app currency (MYR) — single-currency app, so
            net worth and balances stay meaningful. The value still flows through
            form state for the API. */}

        <div>
          <Input
            label="Opening Balance"
            id="opening-balance"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form.openingBalance || ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, openingBalance: parseFloat(e.target.value) || 0 }))
            }
          />
          <p className="mt-1 text-xs text-gray-500">
            The account&apos;s current balance, before recording any transactions.
          </p>
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

        {/* Sharing section — only when editing an account you own */}
        {isEdit && !account?.isShared && groups.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Share2 className="h-4 w-4" />
              Sharing
            </p>
            {shares.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {shares.map((s) => (
                  <li key={s.groupId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{s.groupName}</span>
                      <span className="ml-2 text-gray-500 text-xs">{s.canWrite ? 'can add/edit' : 'read-only'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-brand-600 hover:underline"
                        onClick={async () => {
                          await api.patch(`/accounts/${account!.id}/shares/${s.groupId}`, { canWrite: !s.canWrite })
                          const updated = await api.get<AccountShare[]>(`/accounts/${account!.id}/shares`)
                          setShares(updated)
                        }}
                      >
                        {s.canWrite ? 'Make read-only' : 'Allow editing'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.delete(`/accounts/${account!.id}/shares/${s.groupId}`)
                          setShares((prev) => prev.filter((x) => x.groupId !== s.groupId))
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Share with group</label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={shareGroupId}
                  onChange={(e) => setShareGroupId(e.target.value)}
                >
                  <option value="">— select group —</option>
                  {groups.filter((g) => !shares.some((s) => s.groupId === g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1 text-xs text-gray-600 pb-2">
                <input
                  type="checkbox"
                  checked={shareCanWrite}
                  onChange={(e) => setShareCanWrite(e.target.checked)}
                  className="rounded"
                />
                Write
              </label>
              <Button
                type="button"
                size="sm"
                disabled={!shareGroupId || sharingLoading}
                onClick={async () => {
                  if (!shareGroupId || !account) return
                  setSharingLoading(true)
                  try {
                    await api.post(`/accounts/${account.id}/shares`, { groupId: shareGroupId, canWrite: shareCanWrite })
                    const updated = await api.get<AccountShare[]>(`/accounts/${account.id}/shares`)
                    setShares(updated)
                    setShareGroupId('')
                  } finally {
                    setSharingLoading(false)
                  }
                }}
              >
                Share
              </Button>
            </div>
          </div>
        )}

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
