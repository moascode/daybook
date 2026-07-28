import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { formatMYR, errorMessage } from '@/lib/utils'
import type { Settlement } from '@/types/household.types'

interface ConfirmAccount {
  id: string
  name: string
  isShared?: boolean
}

/**
 * The creditor's half of the settlement handshake (§2).
 *
 * The debtor's payment is a *claim*: their cash has left, but nothing on this
 * side moves until the person owed says it arrived. Confirming books the money
 * into an account the creditor picks themselves — which is the whole point, and
 * the reason the old flow was broken. It used to require the creditor to have
 * shared a writable account into the group *in advance*, so in practice their
 * leg was never recorded at all and their balance stayed short forever.
 *
 * Rejecting is symmetric with the recipient's right to reject a split: the debt
 * goes back to outstanding and the debtor's expense leg is removed.
 */
export function ConfirmReceiptDialog({
  settlement,
  accounts,
  onClose,
  onDone,
}: {
  settlement: Settlement | null
  accounts: ConfirmAccount[]
  onClose: () => void
  onDone: () => void
}) {
  const [accountId, setAccountId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)

  const myAccounts = accounts.filter((a) => !a.isShared)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setAccountId('')
      setReason('')
      setRejecting(false)
      onDone()
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not update this settlement.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!settlement} onOpenChange={(next) => { if (!next) onClose() }} title="Confirm payment received">
      {settlement && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">{settlement.fromUsername}</span> recorded a payment of{' '}
            <span className="font-semibold">{formatMYR(settlement.amount)}</span> to you.
          </p>
          {settlement.note && <p className="text-xs text-gray-500">Note: {settlement.note}</p>}

          {!rejecting ? (
            <>
              <Select
                label="Received into (your account)"
                id="confirm-account"
                options={[
                  { value: '', label: '— select account —' },
                  ...myAccounts.map((a) => ({ value: a.id, label: a.name })),
                ]}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              />
              <p className="text-xs text-gray-400">
                Confirming books the money into that account and clears the balance. It is recorded
                as a repayment, so it does not count as income.
              </p>
            </>
          ) : (
            <div>
              <label htmlFor="confirm-reject-reason" className="mb-1 block text-xs font-medium text-gray-700">
                Reason (optional)
              </label>
              <textarea
                id="confirm-reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="e.g. nothing has arrived yet"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                The debt goes back to outstanding and {settlement.fromUsername}&rsquo;s payment entry
                is removed.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-600" data-testid="confirm-error">{error}</p>}

          <div className="flex justify-end gap-2">
            {!rejecting ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setRejecting(true)} data-testid="confirm-not-received">
                  Not received
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !accountId}
                  data-testid="confirm-receipt"
                  onClick={() => run(() => api.post(`/settlements/${settlement.id}/confirm`, { accountId }))}
                >
                  Confirm received
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  data-testid="confirm-reject"
                  onClick={() => run(() => api.post(`/settlements/${settlement.id}/reject`, { reason }))}
                >
                  Reject payment
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
