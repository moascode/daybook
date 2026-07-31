import { useState, useEffect, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import type { GroupBalance } from '@/types/household.types'

interface PreviewLine {
  splitId: string
  merchant: string
  date: string
  applied: number
  clears: boolean
}

interface Preview {
  outstanding: number
  requested: number
  applied: number
  capped: boolean
  lines: PreviewLine[]
}

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
  const [form, setForm] = useState({ myAccountId: '', amount: '', note: '' })
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    if (balance) {
      setError(null) // eslint-disable-line react-hooks/set-state-in-effect
      setNotice(null)
      setForm({ myAccountId: '', amount: String(Math.round(balance.amount * 100) / 100), note: '' })
    }
  }, [balance])

  // balance semantics: fromUserId owes toUserId. Direction from the caller's view:
  const iAmCreditor = !!balance && balance.toUserId === currentUserId
  const counterpartyUsername = balance ? (iAmCreditor ? balance.fromUsername : balance.toUsername) : ''

  // Only my own accounts. The counterparty's selector is gone: when I am the
  // debtor they book their own leg on confirmation, and when I am the creditor
  // I am recording receipt, which needs only my side. That selector was filtered
  // to accounts the other person had shared into the group — which nobody had —
  // so it silently dropped the other half of every settlement.
  const myAccounts = accounts.filter((a) => !a.isShared)

  // What this amount would actually clear, computed server-side by the same
  // functions the commit uses — a preview that reimplemented the FIFO spread
  // would be a promise the commit does not have to keep.
  const loadPreview = useCallback(async () => {
    if (!balance || !form.amount || Number(form.amount) <= 0) { setPreview(null); return }
    try {
      const res = await api.post<Preview>('/settlements/preview', {
        groupId,
        counterpartyId: iAmCreditor ? balance.fromUserId : balance.toUserId,
        role: iAmCreditor ? 'creditor' : 'debtor',
        amount: Number(form.amount),
      })
      setPreview(res)
    } catch {
      // A preview is an aid, not a gate: if it fails the dialog still settles.
      setPreview(null)
    }
  }, [balance, form.amount, groupId, iAmCreditor])

  useEffect(() => {
    // Debounced so typing an amount does not fire a request per keystroke.
    const t = setTimeout(loadPreview, 300)
    return () => clearTimeout(t)
  }, [loadPreview])

  const handleSettle = async () => {
    if (!balance) return
    setSettling(true)
    setError(null)
    try {
      // The debtor-side leg is an expense on fromAccountId; the creditor-side leg
      // is an income on toAccountId. Map "my"/"their" account onto those roles by
      // direction, and tell the server who the debtor is (B-01).
      // My account fills whichever role I am in; the other side is left for the
      // other person.
      const res = await api.post<{ id: string; message?: string }>('/settlements', {
        groupId,
        ...(iAmCreditor ? { fromUserId: balance.fromUserId } : { toUserId: balance.toUserId }),
        amount: Number(form.amount),
        note: form.note,
        ...(iAmCreditor
          ? { toAccountId: form.myAccountId }
          : { fromAccountId: form.myAccountId }),
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

        {preview && preview.lines.length > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="settle-preview">
            <p className="mb-1.5 text-xs font-medium text-gray-700">
              {preview.capped
                ? `More than is owed — ${formatMYR(preview.applied)} will be applied, clearing:`
                : 'This clears:'}
            </p>
            <ul className="space-y-1">
              {preview.lines.map((l) => (
                <li key={l.splitId} className="flex items-center justify-between text-xs" data-testid="settle-preview-line">
                  <span className="min-w-0 truncate text-gray-600">
                    {l.merchant || '(no merchant)'}
                    <span className="ml-1.5 text-gray-400">
                      {l.date && format(parseISO(l.date), 'dd MMM')}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 tabular-nums text-gray-700">
                    {formatMYR(l.applied)}
                    {/* Says which of these the payment finishes off. Chipping at
                        a claim and clearing it look identical in a list of
                        amounts, and only one of them removes it from the queue. */}
                    {!l.clears && <span className="ml-1 text-gray-400">part</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
        {/* Says what happens next. Recording a payment does not clear the debt
            on its own — the other person has to say it arrived. */}
        <p className="text-xs text-gray-400" data-testid="settle-explainer">
          {iAmCreditor
            ? `This records that ${counterpartyUsername} paid you, and books the money into your account.`
            : `This books the payment out of your account. ${counterpartyUsername} confirms it arrived before the balance clears.`}
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
