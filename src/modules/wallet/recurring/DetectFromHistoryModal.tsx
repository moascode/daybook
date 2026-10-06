import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { DetectCandidate } from '@/modules/wallet/recurring/insights'

interface DetectFromHistoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null while history hasn't loaded yet / failed — rendered as "loading" or "unavailable" (see `historyFailed`), never as an empty list. */
  candidates: DetectCandidate[] | null
  /** History actively FAILED to load (as opposed to still loading) — distinguishes the two `candidates === null` states. */
  historyFailed: boolean
  onAdd: (candidate: DetectCandidate) => void
}

/** "Detect from history" — repeating, unregistered charges found in the last 6 months (FEAT-068). The click is never silent. */
export function DetectFromHistoryModal({ open, onOpenChange, candidates, historyFailed, onAdd }: DetectFromHistoryModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Detect from history">
      <div className="flex flex-col gap-3">
        {candidates === null && historyFailed && (
          <p className="text-sm text-fg-subtle">
            Transaction history isn&rsquo;t available right now, so charges can&rsquo;t be scanned for repeats. Try again in a moment.
          </p>
        )}
        {candidates === null && !historyFailed && (
          <p className="text-sm text-fg-subtle">Loading recent transactions&hellip;</p>
        )}
        {candidates !== null && candidates.length === 0 && (
          <p className="text-sm text-fg-subtle">No repeating charges found that aren&rsquo;t already recurring.</p>
        )}
        {candidates !== null && candidates.map((c) => (
          <div key={`${c.merchant}-${c.accountId}`} className="prow" data-testid="detect-candidate-row">
            <div style={{ minWidth: 0 }}>
              <div className="pname">{c.merchant}</div>
              <div className="psub">{formatMYR(c.amount)} · seen {c.monthsRunning} months running</div>
            </div>
            <Button variant="secondary" size="sm" style={{ marginLeft: 'auto' }} onClick={() => onAdd(c)}>
              Add as recurring
            </Button>
          </div>
        ))}
        <div className="flex justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
