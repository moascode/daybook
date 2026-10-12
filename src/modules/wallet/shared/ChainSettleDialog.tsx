import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { errorMessage, formatMYR } from '@/lib/utils'
import type { ChainPreview, SettleTransfer } from '@/types/household.types'

interface ChainAccount {
  id: string
  name: string
  isShared?: boolean
}

interface ChainSettleDialogProps {
  groupId: string
  /** The non-direct transfer the payer is starting. Null closes the dialog. */
  transfer: SettleTransfer | null
  accounts: ChainAccount[]
  onClose: () => void
  onStarted: () => void
}

/**
 * FEAT-024 PR C — the payer's half of starting a three-way settlement.
 * Opens from SettleGroupPlan's "Start three-way settle" button (viewer is
 * always the payer here — SettleGroupPlan never wires this up for anyone
 * else). Loads a read-only preview (POST /settlement-chains/preview) so the
 * payer sees exactly which edges this discharges before committing, then
 * POSTs /settlement-chains to create the chain, which every party —
 * including the payer, already confirmed server-side — must still agree to.
 */
export function ChainSettleDialog({ groupId, transfer, accounts, onClose, onStarted }: ChainSettleDialogProps) {
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<ChainPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const myAccounts = accounts.filter((a) => !a.isShared)

  useEffect(() => {
    setAccountId('') // eslint-disable-line react-hooks/set-state-in-effect
    setNote('')
    setError(null)
    setPreview(null)
    setPreviewError(null)
    if (!transfer) return
    let cancelled = false
    api
      .post<ChainPreview>('/settlement-chains/preview', {
        groupId,
        payeeId: transfer.toUserId,
        amount: transfer.amount,
      })
      .then((res) => { if (!cancelled) setPreview(res) })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(err, "Couldn't load how this would be routed."))
      })
    return () => { cancelled = true }
  }, [transfer, groupId])

  if (!transfer) return null

  const handleStart = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/settlement-chains', {
        groupId,
        payeeId: transfer.toUserId,
        amount: transfer.amount,
        accountId,
        note,
      })
      onStarted()
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not start this settlement.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={!!transfer} onOpenChange={(next) => { if (!next) onClose() }} title="Start three-way settle">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Pay <span className="font-semibold">{transfer.toUsername}</span>{' '}
          <span className="font-semibold">{formatMYR(transfer.amount)}</span> — this money does not
          flow directly between you two, so it routes through the debts in between.
        </p>

        {previewError && <p className="text-sm text-red-600" data-testid="chain-preview-error">{previewError}</p>}
        {preview && preview.hops.length > 0 && (
          <div className="rounded-lg border border-line-subtle bg-surface-sunken p-3 text-xs" data-testid="chain-preview">
            <p className="mb-1.5 font-medium text-fg-muted">Clears:</p>
            <p className="text-fg-muted">
              {preview.hops.map((h) => `${h.fromUsername} → ${h.toUsername}`).join(', ')}
            </p>
          </div>
        )}

        <Select
          label="Pay from (your account)"
          id="chain-settle-account"
          options={[
            { value: '', label: '— select account —' },
            ...myAccounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        />
        <p className="text-xs text-fg-faint" data-testid="chain-settle-explainer">
          Every party in the chain — including {transfer.toUsername} — has to confirm before this
          clears. Nothing moves on anyone's books until they do.
        </p>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Note (optional)</label>
          <Input
            placeholder="e.g. cash settlement"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600" data-testid="chain-settle-error">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleStart}
            disabled={submitting || !accountId}
          >
            {submitting ? 'Starting…' : 'Start settlement'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
