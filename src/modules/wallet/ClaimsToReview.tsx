import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { api } from '@/lib/api'
import { formatMYR, errorMessage } from '@/lib/utils'
import { useHouseholdStore } from '@/stores/household.store'
import { useToastStore } from '@/stores/toast.store'

export interface Claim {
  id: string
  transaction_id: string
  share_amount: number
  settled_amount: number
  status: string
  date: string
  merchant: string
  description: string
  transaction_amount: number
  owner_username: string
}

/**
 * The review queue: every split claim standing against the current user.
 *
 * This is the answer to "the recipient has no say". A claim is not a fact
 * imposed on their ledger — they either settle it or reject it. Rejection is
 * deliberately the only *free* action here: the common case (an uncontested
 * split) costs nothing, and only disagreement costs a click.
 *
 * Not date-filtered, on purpose. The bug that started this workstream was a
 * recipient who could not find 15 splits because the transaction list defaulted
 * to the current month; a claim is outstanding until it is resolved.
 */
export function ClaimsToReview({ onChanged }: { onChanged?: () => void }) {
  const [claims, setClaims] = useState<Claim[]>([])
  const [rejecting, setRejecting] = useState<Claim | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const setPendingClaimCount = useHouseholdStore((s) => s.setPendingClaimCount)
  const addToast = useToastStore((s) => s.addToast)

  const load = useCallback(async () => {
    try {
      const rows = await api.get<Claim[]>('/transactions/splits/mine?status=pending')
      setClaims(rows)
      setPendingClaimCount(rows.length)
    } catch { /* the page's own error state covers the load failure */ }
  }, [setPendingClaimCount])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const confirmReject = async () => {
    if (!rejecting) return
    setBusy(true)
    try {
      await api.post(`/transactions/splits/${rejecting.id}/reject`, { reason })
      addToast({ message: 'Split rejected', duration: 4000 })
      setRejecting(null)
      setReason('')
      await load()
      onChanged?.()
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not reject this split.'), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  if (claims.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white" data-testid="claims-to-review">
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          To review
          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
            {claims.length}
          </span>
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Splits others have asked you to cover. Settle them below, or reject one you disagree with.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {claims.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-3" data-testid="claim-row">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{c.merchant || '(no merchant)'}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {format(parseISO(c.date), 'dd MMM yyyy')} · from {c.owner_username}
                {/* Both figures: the claim is a slice of a larger transaction and
                    hiding the total invites "why do I owe that?" */}
                {c.share_amount !== c.transaction_amount && (
                  <> · {formatMYR(c.transaction_amount)} total</>
                )}
              </p>
            </div>
            <span className="text-sm font-semibold text-red-700">{formatMYR(c.share_amount)}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setRejecting(c); setReason('') }}
              data-testid="claim-reject"
            >
              Reject
            </Button>
          </li>
        ))}
      </ul>

      <Modal
        open={!!rejecting}
        onOpenChange={(next) => { if (!next) setRejecting(null) }}
        title="Reject this split?"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {rejecting && (
              <>
                {formatMYR(rejecting.share_amount)} from {rejecting.owner_username} for{' '}
                <span className="font-medium">{rejecting.merchant || '(no merchant)'}</span>.
              </>
            )}
          </p>
          <p className="text-xs text-gray-500">
            No money moves. The whole amount goes back to {rejecting?.owner_username}, who can
            split it again with a different figure.
          </p>
          <div>
            <label htmlFor="reject-reason" className="mb-1 block text-xs font-medium text-gray-700">
              Reason (optional)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. this one was mine alone"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={confirmReject}
              disabled={busy}
              data-testid="claim-reject-confirm"
            >
              Reject split
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
