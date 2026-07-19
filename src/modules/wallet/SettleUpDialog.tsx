import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import type { GroupBalance } from '@/types/household.types'

interface SettleAccount {
  id: string
  name: string
  isShared?: boolean
  sharedByUsername?: string
}

interface SettleUpDialogProps {
  groupId: string
  balance: GroupBalance | null
  currentUserId: string
  accounts: SettleAccount[]
  onClose: () => void
  onSettled: () => void
}

/**
 * Records a settlement between the current user and a counterparty: creates
 * real transfer transactions on both ledgers (their side only when a shared
 * account is chosen).
 */
export function SettleUpDialog({ groupId, balance, currentUserId, accounts, onClose, onSettled }: SettleUpDialogProps) {
  const [form, setForm] = useState({ fromAccountId: '', toAccountId: '', amount: '', note: '' })
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (balance) {
      setError(null) // eslint-disable-line react-hooks/set-state-in-effect
      setForm({ fromAccountId: '', toAccountId: '', amount: String(Math.round(balance.amount * 100) / 100), note: '' })
    }
  }, [balance])

  // B-13: only own accounts (not shared-in) on the payer side
  const myAccounts = accounts.filter((a) => !a.isShared)

  const handleSettle = async () => {
    if (!balance) return
    setSettling(true)
    setError(null)
    try {
      await api.post('/settlements', {
        groupId,
        toUserId: balance.toUserId,
        amount: Number(form.amount),
        note: form.note,
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId || undefined,
      })
      onSettled()
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to record settlement')
    } finally {
      setSettling(false)
    }
  }

  if (!balance) return null

  return (
    <Modal open={!!balance} onOpenChange={onClose} title="Settle Up">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          {balance.toUserId === currentUserId
            ? <>Recording receipt from <strong>{balance.fromUsername}</strong></>
            : <>Recording payment to <strong>{balance.toUsername}</strong></>
          }
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
          <Input
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From account (your side)</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.fromAccountId}
            onChange={(e) => setForm((f) => ({ ...f, fromAccountId: e.target.value }))}
          >
            <option value="">— select account —</option>
            {myAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {/* U-4: their account — show shared accounts from counterparty if any */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To account (their side — optional)</label>
          {(() => {
            const targetUsername = balance.toUserId === currentUserId
              ? balance.fromUsername
              : balance.toUsername
            const theirAccounts = accounts.filter(
              (a) => a.isShared && a.sharedByUsername === targetUsername
            )
            if (theirAccounts.length === 0) {
              return <p className="text-xs text-gray-400">No shared accounts available from {targetUsername}.</p>
            }
            return (
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={form.toAccountId}
                onChange={(e) => setForm((f) => ({ ...f, toAccountId: e.target.value }))}
              >
                <option value="">— leave blank (records payer side only) —</option>
                {theirAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )
          })()}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
          <Input
            placeholder="e.g. cash settlement"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSettle}
            disabled={settling || !form.fromAccountId || !form.amount}
          >
            {settling ? 'Recording…' : 'Record Settlement'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
