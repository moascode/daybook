import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatMYR } from '@/lib/utils'

interface RejectableRow {
  id: string
  outstanding: number
  ownerUsername: string
  merchant: string
  shareAmount: number
}

/** Client-side mirror of the server's 2dp/positive/less-than-own-share rule
 * for a counter-offer (validated against the split's own share, not the
 * transaction's gross), so a doomed request never leaves the browser. */
function validateProposedAmount(raw: string, share: number): { amount?: number; error?: string } {
  if (raw.trim() === '') return {}
  const n = Number(raw)
  if (!Number.isFinite(n)) return { error: 'Enter a valid amount.' }
  const rounded = Math.round(n * 100) / 100
  if (rounded <= 0 || rounded >= share) {
    return { error: `Must be more than RM0 and less than your current share (${formatMYR(share)}).` }
  }
  return { amount: rounded }
}

/**
 * The reject confirm modal — shared by the single-row and bulk reject
 * actions in SharedActivity, so there is exactly one place that builds the
 * reject request. Owns its own reason/counter-offer form state internally
 * (reset whenever a fresh `rejecting` array identity arrives) so the caller
 * only has to hand over which rows are being rejected and what to do once
 * confirmed.
 */
export function RejectClaimModal({
  rejecting,
  busy,
  onConfirm,
  onClose,
}: {
  rejecting: RejectableRow[] | null
  busy: boolean
  onConfirm: (reason: string, proposedAmount?: number) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [proposedAmountInput, setProposedAmountInput] = useState('')
  const [proposalError, setProposalError] = useState<string | null>(null)

  // A fresh `rejecting` array (a new click on Reject/bulk-Reject) means a
  // fresh form, even if the modal never fully closed between the two.
  useEffect(() => {
    if (rejecting) {
      setReason('') // eslint-disable-line react-hooks/set-state-in-effect
      setProposedAmountInput('')
      setProposalError(null)
    }
  }, [rejecting])

  function handleConfirm() {
    if (!rejecting || rejecting.length === 0) return
    // The counter-offer only makes sense for a single claim — the field
    // itself is hidden for a bulk reject (below), so this is always
    // undefined for a multi-row reject.
    let proposedAmount: number | undefined
    if (rejecting.length === 1 && proposedAmountInput.trim() !== '') {
      const { amount, error } = validateProposedAmount(proposedAmountInput, rejecting[0].shareAmount)
      if (error) { setProposalError(error); return }
      proposedAmount = amount
    }
    onConfirm(reason, proposedAmount)
  }

  return (
    <Modal
      open={!!rejecting}
      onOpenChange={(next) => { if (!next) onClose() }}
      title={rejecting && rejecting.length > 1 ? `Reject ${rejecting.length} splits?` : 'Reject this split?'}
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          {rejecting && (rejecting.length === 1
            ? <>{formatMYR(rejecting[0].outstanding)} from {rejecting[0].ownerUsername} for <span className="font-medium">{rejecting[0].merchant || '(no merchant)'}</span>.</>
            : <>{formatMYR(rejecting.reduce((s, r) => s + r.outstanding, 0))} total across {rejecting.length} splits.</>
          )}
        </p>
        <div>
          <label htmlFor="reject-reason" className="mb-1 block text-xs font-medium text-fg-muted">
            Reason (optional{rejecting && rejecting.length > 1 ? ' — applied to all' : ''})
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        {/* Counter-offer — single-claim only. A bulk reject has no one gross
            amount to validate a proposal against, and one figure spread
            across several different claims would be misleading, so the
            field simply does not exist for that case. */}
        {rejecting && rejecting.length === 1 && (
          <div>
            <label htmlFor="reject-proposed-amount" className="mb-1 block text-xs font-medium text-fg-muted">
              Counter-offer (RM)
            </label>
            <input
              id="reject-proposed-amount"
              type="number"
              step="0.01"
              min="0"
              value={proposedAmountInput}
              onChange={(e) => { setProposedAmountInput(e.target.value); setProposalError(null) }}
              placeholder="Optional"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            {proposalError && (
              <p className="mt-1 text-xs text-red-600" data-testid="proposed-amount-error">{proposalError}</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={busy} data-testid="claim-reject-confirm">
            {rejecting && rejecting.length > 1 ? `Reject ${rejecting.length} splits` : 'Reject split'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
