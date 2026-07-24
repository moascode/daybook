import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
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
  const [form, setForm] = useState({ myAccountId: '', theirAccountId: '', amount: '', note: '' })
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (balance) {
      setError(null) // eslint-disable-line react-hooks/set-state-in-effect
      setNotice(null)
      setForm({ myAccountId: '', theirAccountId: '', amount: String(Math.round(balance.amount * 100) / 100), note: '' })
    }
  }, [balance])

  // balance semantics: fromUserId owes toUserId. Direction from the caller's view:
  const iAmCreditor = !!balance && balance.toUserId === currentUserId
  const counterpartyUsername = balance ? (iAmCreditor ? balance.fromUsername : balance.toUsername) : ''

  // Only my own accounts on my side; the counterparty's shared-in accounts on theirs.
  const myAccounts = accounts.filter((a) => !a.isShared)
  const theirAccounts = accounts.filter((a) => a.isShared && a.sharedByUsername === counterpartyUsername)

  const handleSettle = async () => {
    if (!balance) return
    setSettling(true)
    setError(null)
    try {
      // The debtor-side leg is an expense on fromAccountId; the creditor-side leg
      // is an income on toAccountId. Map "my"/"their" account onto those roles by
      // direction, and tell the server who the debtor is (B-01).
      const fromAccountId = iAmCreditor ? form.theirAccountId : form.myAccountId
      const toAccountId = iAmCreditor ? form.myAccountId : form.theirAccountId
      const res = await api.post<{ id: string; message?: string }>('/settlements', {
        groupId,
        ...(iAmCreditor ? { fromUserId: balance.fromUserId } : { toUserId: balance.toUserId }),
        amount: Number(form.amount),
        note: form.note,
        fromAccountId: fromAccountId || undefined,
        toAccountId: toAccountId || undefined,
      })
      // B-18: surface a capped-amount notice; the settlement is already recorded.
      if (res?.message) {
        setNotice(res.message)
        setSettling(false)
        return
      }
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
          {iAmCreditor
            ? <>Recording that <strong>{balance.fromUsername}</strong> paid you</>
            : <>Recording your payment to <strong>{balance.toUsername}</strong></>
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
          <p className="mt-1 text-xs text-gray-400">Pay less than the full amount to settle part of it.</p>
        </div>
        <Select
          label={iAmCreditor ? 'Deposit into (your account)' : 'Pay from (your account)'}
          id="settle-my-account"
          options={[
            { value: '', label: '— select account —' },
            ...myAccounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          value={form.myAccountId}
          onChange={(e) => setForm((f) => ({ ...f, myAccountId: e.target.value }))}
        />
        <div>
          {theirAccounts.length === 0 ? (
            <>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {counterpartyUsername}&rsquo;s account (optional)
              </label>
              <p className="text-xs text-gray-400">
                No shared accounts from {counterpartyUsername}. Only your side will be recorded.
              </p>
            </>
          ) : (
            <Select
              label={`${counterpartyUsername}’s account (optional)`}
              id="settle-their-account"
              options={[
                { value: '', label: '— leave blank (records your side only) —' },
                ...theirAccounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              value={form.theirAccountId}
              onChange={(e) => setForm((f) => ({ ...f, theirAccountId: e.target.value }))}
            />
          )}
        </div>
        {/* U-13: clarify that this books a real ledger transfer, and nudges
            toward filling in the counterparty's account when one is shared. */}
        <p className="text-xs text-gray-400">
          This books a real transfer in your ledger; add their account too if they&rsquo;ve shared one with you.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
          <Input
            placeholder="e.g. cash settlement"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice ? (
          <>
            <p className="text-sm text-amber-700">{notice}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={onSettled}>Done</Button>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSettle}
              disabled={settling || !form.myAccountId || !form.amount}
            >
              {settling ? 'Recording…' : 'Record Settlement'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
