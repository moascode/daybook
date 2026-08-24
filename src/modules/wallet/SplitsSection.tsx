import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { useSplits, approveSplit, approveSplits, cancelSplit, rejectSplit, unapproveSplit } from '@/hooks/useSplits'
import { useToastStore } from '@/stores/toast.store'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { SplitList } from './SplitList'
import { SplitStateBar } from './SplitStateBar'
import type { ClaimState, GroupBalance, SplitClaim } from '@/types/household.types'

/** Tab order is the claim's life, left to right. */
const TABS: { state: ClaimState; label: string }[] = [
  { state: 'pending', label: 'To review' },
  { state: 'approved', label: 'Agreed' },
  { state: 'awaiting_confirmation', label: 'Paid, unconfirmed' },
  { state: 'settled', label: 'Settled' },
  { state: 'rejected', label: 'Rejected' },
]

/** Which side of the pair is on screen. */
type Direction = 'owed-to-me' | 'i-owe'

interface SplitsSectionProps {
  groupId: string
  groupName: string
  /** Rendered only when the user is in more than one group. */
  showGroupName: boolean
  counterpartyId: string
  counterpartyUsername: string
  currentUserId: string
  balance: GroupBalance | null
  /** Bumped by the page when a claim changed elsewhere; refetches in place. */
  revision: number
  /** Called with the range on screen, so the dialog inherits the period. */
  onSettle: (range: { dateFrom: string; dateTo: string }) => void
  onChanged: () => void
}

/** Outstanding money in a set of claims — settled and rejected are not owed. */
function outstandingOf(claims: SplitClaim[]): number {
  return claims.reduce(
    (sum, c) => (c.state === 'settled' || c.state === 'rejected' ? sum : sum + c.outstanding),
    0,
  )
}

/**
 * One counterparty within one group: what stands between the two of you, in
 * both directions, with the actions that belong to your side of each.
 *
 * **Both directions is the point.** This card used to take a single
 * `iAmCreditor` decided by whichever way the *netted* balance pointed, and fetch
 * that one role. When two people owed each other, the smaller direction's claims
 * were never fetched — Kakon owed RM30 and owing RM15 saw "You owe RM15" in the
 * page total and "Nothing waiting on their review" in the list, with no row to
 * agree to, reject, or even look at. The toggle below is what makes that money
 * reachable.
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
  currentUserId,
  balance,
  revision,
  onSettle,
  onChanged,
}: SplitsSectionProps) {
  const [range, setRange] = useState({ dateFrom: '', dateTo: '' })
  // null until a side is settled on — first by the effect below, from the first
  // data to arrive, and after that only by the user.
  const [chosen, setChosen] = useState<Direction | null>(null)
  const [tab, setTab] = useState<ClaimState>('pending')
  const [rejecting, setRejecting] = useState<SplitClaim | null>(null)
  const [cancelling, setCancelling] = useState<SplitClaim | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const addToast = useToastStore((s) => s.addToast)

  const { owedToMe, iOwe, loading, reload } = useSplits({
    role: 'both',
    counterparty: counterpartyId,
    groupId,
    dateFrom: range.dateFrom || undefined,
    dateTo: range.dateTo || undefined,
    revision,
  })

  const theyOweYou = outstandingOf(owedToMe)
  const youOweThem = outstandingOf(iOwe)
  const net = theyOweYou - youOweThem

  // Open on the side with something waiting on YOU; failing that, the bigger pile.
  //
  // Decided once, on the first data to arrive, and never recomputed — because the
  // inputs move as you work. A live rule flips the card to the other direction the
  // moment you agree to or reject the last claim against you, taking the row you
  // just acted on and the tab you were heading for with it.
  useEffect(() => {
    if (chosen !== null || (owedToMe.length === 0 && iOwe.length === 0)) return
    setChosen( // eslint-disable-line react-hooks/set-state-in-effect
      iOwe.some((c) => c.state === 'pending')
        ? 'i-owe'
        : theyOweYou >= youOweThem
          ? 'owed-to-me'
          : 'i-owe',
    )
  }, [chosen, owedToMe, iOwe, theyOweYou, youOweThem])

  const direction: Direction = chosen ?? 'owed-to-me'

  const claims = direction === 'owed-to-me' ? owedToMe : iOwe
  // Your side of the claims on screen: they are yours to withdraw when you made
  // them, theirs to agree to or reject when you did not.
  const role = direction === 'owed-to-me' ? 'creditor' : 'debtor'

  const selectDirection = (next: Direction) => {
    setChosen(next)
    setTab('pending')
    setSelected(new Set())
  }

  const byState = useMemo(() => {
    const acc = {} as Record<ClaimState, SplitClaim[]>
    for (const { state } of TABS) acc[state] = []
    for (const claim of claims) (acc[claim.state] ??= []).push(claim)
    return acc
  }, [claims])

  // Selecting is only meaningful where a bulk action exists: unreviewed claims
  // the caller actually holds. Everything else is a read-only record.
  const canBulk = role === 'debtor' && tab === 'pending'
  const visible = byState[tab] ?? []
  const selectedHere = visible.filter((c) => selected.has(c.id))
  const selectedTotal = selectedHere.reduce((sum, c) => sum + c.outstanding, 0)

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A tab with nothing in it and nothing to gain is not worth a click. 'To
  // review' always shows so its zero is legible as "nothing waiting on you"
  // rather than as a missing tab.
  const visibleTabs = TABS.filter((t) => t.state === 'pending' || byState[t.state].length > 0)

  // Agreeing is one click with an undo rather than a confirm dialog: it moves no
  // money and is fully reversible, so making it cost a modal would tax the
  // common case — an uncontested split — which is exactly what the original
  // design was right to avoid.
  const handleApprove = async (claim: SplitClaim) => {
    try {
      await approveSplit(claim.id)
      await reload()
      onChanged()
      addToast({
        message: `Agreed: ${claim.merchant || 'split'}`,
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            unapproveSplit(claim.id)
              .then(async () => { await reload(); onChanged() })
              .catch((err: unknown) =>
                addToast({ message: errorMessage(err, 'Could not undo that.'), duration: 5000 }))
          },
        },
      })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not agree to this split.'), duration: 5000 })
    }
  }

  const handleBulkApprove = async () => {
    const ids = selectedHere.map((c) => c.id)
    if (ids.length === 0) return
    setBusy(true)
    try {
      const n = await approveSplits(ids)
      setSelected(new Set())
      await reload()
      onChanged()
      addToast({ message: `Agreed to ${n} split${n === 1 ? '' : 's'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not agree to those splits.'), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

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

  // Confirmed rather than offered with an undo, unlike agreeing. Agreeing is a
  // statement about your own view of a claim and costs nothing to redo;
  // cancelling deletes the claim outright, and the way back is re-splitting the
  // transaction from scratch — not an undo, so it should not be presented as one.
  const confirmCancel = async () => {
    if (!cancelling) return
    setBusy(true)
    try {
      await cancelSplit(cancelling.id)
      addToast({ message: `Split cancelled: ${cancelling.merchant || 'split'}`, duration: 4000 })
      setCancelling(null)
      await reload()
      onChanged()
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not cancel this split.'), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  // The settle button acts on the group balance, which is netted per pair — so
  // its direction comes from the balance, not from whichever side is on screen.
  const iAmNetCreditor = !!balance && balance.toUserId === currentUserId
  const netAmount = balance?.amount ?? 0

  return (
    <section
      className="card"
      data-testid="splits-section"
      data-counterparty={counterpartyUsername}
    >
      <header className="border-b border-line-subtle px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{counterpartyUsername}</h3>
            {showGroupName && <p className="mt-0.5 text-xs text-fg-faint">{groupName}</p>}
          </div>
          {balance && netAmount > 0.005 && (
            <Button size="sm" variant={iAmNetCreditor ? 'secondary' : 'primary'} onClick={() => onSettle(range)}>
              {iAmNetCreditor ? (
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

        {/* Both directions and then the net, in that order. The gross figures are
            what the two piles of claims are worth; the net is what one payment
            would clear. Showing only the net is what let a whole direction go
            missing from this card. */}
        <dl className="mt-2 space-y-1 text-xs" data-testid="section-totals">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fg-subtle">{counterpartyUsername} owes you</dt>
            <dd className="font-medium tabular-nums text-fg" data-testid="total-owed-to-me">
              {formatMYR(theyOweYou)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fg-subtle">You owe {counterpartyUsername}</dt>
            <dd className="font-medium tabular-nums text-fg" data-testid="total-i-owe">
              {formatMYR(youOweThem)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-line-subtle pt-1">
            <dt className="text-fg-subtle">Net</dt>
            <dd
              className={cn(
                'text-sm font-semibold',
                Math.abs(net) < 0.005
                  ? 'text-fg-subtle'
                  : net > 0
                    ? 'text-positive-700'
                    : 'text-red-700',
              )}
              data-testid="section-balance"
            >
              {Math.abs(net) < 0.005
                ? 'square'
                : net > 0
                  ? `${counterpartyUsername} owes you ${formatMYR(net)}`
                  : `you owe ${counterpartyUsername} ${formatMYR(-net)}`}
            </dd>
          </div>
        </dl>
      </header>

      {/* Opt-in, and starting at All time. A claim is outstanding until it is
          resolved, so defaulting to the current month here would recreate the
          original bug — a debt on screen with an empty list under it. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-2">
        <DateRangeControl value={range} onChange={setRange} />
        {canBulk && visible.length > 1 && (
          <button
            type="button"
            onClick={() =>
              setSelected(
                selectedHere.length === visible.length
                  ? new Set()
                  : new Set(visible.map((c) => c.id)),
              )
            }
            className="text-xs font-medium text-brand-600 hover:underline"
            data-testid="split-select-all"
          >
            {selectedHere.length === visible.length ? 'Clear selection' : 'Select all'}
          </button>
        )}
      </div>

      <div className="border-b border-line-subtle px-4 py-2">
        <div
          className="flex w-full rounded-lg bg-surface-hover p-0.5"
          role="tablist"
          aria-label="Direction"
        >
          {([
            ['owed-to-me', `${counterpartyUsername} owes you`],
            ['i-owe', `You owe ${counterpartyUsername}`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={direction === value}
              onClick={() => selectDirection(value)}
              data-testid={`direction-${value}`}
              className={cn(
                'min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs font-medium transition-colors',
                direction === value
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-subtle hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* The bar draws the direction on screen, over the date range on screen.
            Selecting a segment opens that tab. */}
        <div className="mt-2">
          <SplitStateBar
            claims={claims}
            personOf={(c) => (direction === 'owed-to-me' ? c.debtorUsername : c.ownerUsername)}
            onSelectState={(state) => { setTab(state); setSelected(new Set()) }}
            testId={`state-bar-${direction}`}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line-subtle px-2 py-2" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.state}
            type="button"
            role="tab"
            aria-selected={tab === t.state}
            onClick={() => { setTab(t.state); setSelected(new Set()) }}
            data-testid={`split-tab-${t.state}`}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t.state
                ? 'bg-brand-50 text-brand-700'
                : 'text-fg-subtle hover:bg-surface-sunken hover:text-fg',
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

      {selectedHere.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle bg-brand-50/60 px-4 py-2"
          data-testid="split-bulk-bar"
        >
          <span className="text-xs font-medium text-fg-muted">
            {selectedHere.length} selected · {formatMYR(selectedTotal)}
          </span>
          {/* Agree in bulk, but never reject in bulk: rejecting is a message to
              another person about a specific claim, and the reason is the useful
              half of it. One shared reason across a batch would be noise on
              every row it did not describe. */}
          <Button size="sm" onClick={handleBulkApprove} disabled={busy} data-testid="split-bulk-approve">
            Agree to {selectedHere.length}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="px-4 py-6 text-center text-xs text-fg-faint">Loading…</p>
      ) : (
        <SplitList
          claims={visible}
          role={role}
          emptyMessage={emptyFor(tab, role, counterpartyUsername)}
          onApprove={handleApprove}
          onReject={(claim) => { setRejecting(claim); setReason('') }}
          onCancel={setCancelling}
          selectedIds={canBulk ? selected : undefined}
          onToggleSelect={canBulk ? toggleSelect : undefined}
        />
      )}

      <Modal
        open={!!rejecting}
        onOpenChange={(next) => { if (!next) setRejecting(null) }}
        title="Reject this split?"
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {rejecting && (
              <>
                {formatMYR(rejecting.outstanding)} from {rejecting.ownerUsername} for{' '}
                <span className="font-medium">{rejecting.merchant || '(no merchant)'}</span>.
              </>
            )}
          </p>
          <p className="text-xs text-fg-subtle">
            No money moves. The whole amount goes back to {rejecting?.ownerUsername}, who can
            split it again with a different figure.
          </p>
          <div>
            <label htmlFor="reject-reason" className="mb-1 block text-xs font-medium text-fg-muted">
              Reason (optional)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. this one was mine alone"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
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

      <Modal
        open={!!cancelling}
        onOpenChange={(next) => { if (!next) setCancelling(null) }}
        title="Cancel this split?"
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {cancelling && (
              <>
                {formatMYR(cancelling.outstanding)} you claimed from{' '}
                {cancelling.debtorUsername} for{' '}
                <span className="font-medium">{cancelling.merchant || cancelling.description || '(no merchant)'}</span>.
              </>
            )}
          </p>
          <p className="text-xs text-fg-subtle">
            No money moves. The claim disappears from {cancelling?.debtorUsername}&rsquo;s review
            queue and the transaction goes back to costing you the full amount. You can split it
            again at any time.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={confirmCancel}
              disabled={busy}
              data-testid="claim-cancel-confirm"
            >
              Cancel split
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
