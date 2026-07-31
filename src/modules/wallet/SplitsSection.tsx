import { useMemo, useState } from 'react'
import { ArrowRightLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { useSplits, rejectSplit } from '@/hooks/useSplits'
import { useToastStore } from '@/stores/toast.store'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { SplitList } from './SplitList'
import type { ClaimState, GroupBalance, SplitClaim } from '@/types/household.types'

/** Tab order is the claim's life, left to right. */
const TABS: { state: ClaimState; label: string }[] = [
  { state: 'pending', label: 'To review' },
  { state: 'approved', label: 'Agreed' },
  { state: 'awaiting_confirmation', label: 'Paid, unconfirmed' },
  { state: 'settled', label: 'Settled' },
  { state: 'rejected', label: 'Rejected' },
]

interface SplitsSectionProps {
  groupId: string
  groupName: string
  /** Rendered only when the user is in more than one group. */
  showGroupName: boolean
  counterpartyId: string
  counterpartyUsername: string
  /** True when the counterparty owes the current user. */
  iAmCreditor: boolean
  balance: GroupBalance | null
  onSettle: () => void
  onChanged: () => void
}

/**
 * One counterparty within one group: what stands between the two of you, in
 * whatever state, with the actions that belong to your side of it.
 *
 * Keyed on the (group, counterparty) pair rather than the person alone. Person
 * first is how it reads — the group name is a subtitle, and only when there is
 * more than one — but balances and settlements are per-group in the data model
 * and SettleUpDialog requires a groupId, so a section spanning two groups could
 * not settle what it displayed.
 */
export function SplitsSection({
  groupId,
  groupName,
  showGroupName,
  counterpartyId,
  counterpartyUsername,
  iAmCreditor,
  balance,
  onSettle,
  onChanged,
}: SplitsSectionProps) {
  const role = iAmCreditor ? 'creditor' : 'debtor'
  const [range, setRange] = useState({ dateFrom: '', dateTo: '' })
  const [tab, setTab] = useState<ClaimState>('pending')
  const [rejecting, setRejecting] = useState<SplitClaim | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const addToast = useToastStore((s) => s.addToast)

  const { claims, loading, reload } = useSplits({
    role,
    counterparty: counterpartyId,
    groupId,
    dateFrom: range.dateFrom || undefined,
    dateTo: range.dateTo || undefined,
  })

  const byState = useMemo(() => {
    const acc = {} as Record<ClaimState, SplitClaim[]>
    for (const { state } of TABS) acc[state] = []
    for (const claim of claims) (acc[claim.state] ??= []).push(claim)
    return acc
  }, [claims])

  // A tab with nothing in it and nothing to gain is not worth a click. 'To
  // review' always shows so its zero is legible as "nothing waiting on you"
  // rather than as a missing tab.
  const visibleTabs = TABS.filter((t) => t.state === 'pending' || byState[t.state].length > 0)

  const confirmReject = async () => {
    if (!rejecting) return
    setBusy(true)
    try {
      await rejectSplit(rejecting.id, reason)
      addToast({ message: 'Split rejected', duration: 4000 })
      setRejecting(null)
      setReason('')
      await reload()
      onChanged()
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not reject this split.'), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  const amount = balance?.amount ?? 0

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white"
      data-testid="splits-section"
      data-counterparty={counterpartyUsername}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{counterpartyUsername}</h3>
          {showGroupName && <p className="mt-0.5 text-xs text-gray-400">{groupName}</p>}
        </div>
        <div className="flex items-center gap-3">
          {amount > 0.005 && (
            <span
              className={cn(
                'text-sm font-semibold',
                iAmCreditor ? 'text-positive-700' : 'text-red-700',
              )}
              data-testid="section-balance"
            >
              {iAmCreditor ? 'owes you ' : 'you owe '}
              {formatMYR(amount)}
            </span>
          )}
          {balance && amount > 0.005 && (
            <Button size="sm" variant={iAmCreditor ? 'secondary' : 'primary'} onClick={onSettle}>
              {iAmCreditor ? (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Mark Received
                </>
              ) : (
                <>
                  <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                  Settle Up
                </>
              )}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-gray-100 px-2 py-2" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.state}
            type="button"
            role="tab"
            aria-selected={tab === t.state}
            onClick={() => setTab(t.state)}
            data-testid={`split-tab-${t.state}`}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t.state
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
            )}
          >
            {t.label}
            {byState[t.state].length > 0 && (
              <span className="ml-1.5 text-[11px] tabular-nums opacity-70">
                {byState[t.state].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Opt-in, and starting at All time. A claim is outstanding until it is
          resolved, so defaulting to the current month here would recreate the
          original bug — a debt on screen with an empty list under it. */}
      <div className="border-b border-gray-100 px-4 py-2">
        <DateRangeControl value={range} onChange={setRange} />
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-xs text-gray-400">Loading…</p>
      ) : (
        <SplitList
          claims={byState[tab] ?? []}
          role={role}
          emptyMessage={emptyFor(tab, role, counterpartyUsername)}
          onReject={(claim) => { setRejecting(claim); setReason('') }}
        />
      )}

      <Modal
        open={!!rejecting}
        onOpenChange={(next) => { if (!next) setRejecting(null) }}
        title="Reject this split?"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {rejecting && (
              <>
                {formatMYR(rejecting.outstanding)} from {rejecting.ownerUsername} for{' '}
                <span className="font-medium">{rejecting.merchant || '(no merchant)'}</span>.
              </>
            )}
          </p>
          <p className="text-xs text-gray-500">
            No money moves. The whole amount goes back to {rejecting?.ownerUsername}, who can
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
    </section>
  )
}

function emptyFor(tab: ClaimState, role: 'debtor' | 'creditor', who: string): string {
  if (tab === 'pending') {
    return role === 'debtor'
      ? 'Nothing waiting on your review.'
      : `Nothing waiting on ${who}’s review.`
  }
  if (tab === 'rejected') return 'No rejected splits.'
  if (tab === 'settled') return 'Nothing settled yet.'
  if (tab === 'awaiting_confirmation') return 'No payments waiting to be confirmed.'
  return 'Nothing here.'
}
