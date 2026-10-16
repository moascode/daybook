import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Ban, Check, Receipt, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { Modal } from '@/components/ui/Modal'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToastStore } from '@/stores/toast.store'
import { acceptProposal, approveSplit, approveSplits, cancelSplit, rejectSplit, unapproveSplit } from '@/hooks/useSplits'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { CategoryIcon, categoryTint, resolveCategoryIconKey } from '@/lib/categoryIcon'
import { SplitDetailModal } from './SplitDetailModal'
import { RejectClaimModal } from './RejectClaimModal'
import { computeSettleEligibility } from './bulkSettleEligibility'
import { SettleUpDialog } from '@/modules/wallet/SettleUpDialog'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'
import type { ClaimState, SplitClaim } from '@/types/household.types'
import type { Account, Category } from '@/types/wallet.types'

/**
 * `.lrow:hover` already tints the whole row on hover (data.css) — the same
 * surface-hover token the shared `Button` ghost variant uses for its own
 * hover, and in dark theme --surface-hover and --line are the same value, so
 * a ghost Button's hover was invisible against the row's: hovering any icon
 * looked identical to just hovering the row. bg-line-strong is a full step
 * further in both themes, so the icon you're actually over is unambiguous.
 */
function RowActionIcon({ label, testId, onClick, children }: { label: string; testId?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
        className="rounded-md text-fg-muted hover:bg-line-strong hover:text-fg md:h-7 md:w-7"
      >
        {children}
      </Button>
    </Tooltip>
  )
}

interface ActivityRow extends SplitClaim {
  role: 'debtor' | 'creditor'
  counterpartyId: string
  counterpartyUsername: string
}

type StatusFilter = 'open' | 'settled' | 'rejected' | 'all'

const AVATAR_PALETTE = [
  { bg: 'var(--calm-bg)', fg: 'var(--calm-fg)' },
  { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  { bg: 'var(--alt-bg)', fg: 'var(--alt-fg)' },
]

/** Single source of truth for what a claim's role+state combination allows —
 * shared by the row's own actions and the detail modal's, so the two can't
 * silently drift into offering different things for the same claim. */
function claimPermissions(row: Pick<ActivityRow, 'role' | 'state'>) {
  return {
    canApprove: row.role === 'debtor' && row.state === 'pending',
    canUndoApprove: row.role === 'debtor' && row.state === 'approved',
    canReject: row.role === 'debtor' && (row.state === 'pending' || row.state === 'approved'),
    canCancel: row.role === 'creditor' && (row.state === 'pending' || row.state === 'approved'),
  }
}

/**
 * The Shared page's detail list — one row per split claim, filterable by
 * member and status, matching proposal-v2/shared.html's "Shared activity"
 * card layout (.lhead/.lrow). This is where all the claim-review behaviour
 * that has no mockup equivalent lives: approve, reject, cancel, bulk actions.
 *
 * Quick actions are plain icon buttons in the trailing column — not a "…"
 * menu — so Agree/Reject/Undo/Cancel are one click. No separate "view"
 * action: the row itself opens the detail modal on click, so a dedicated
 * icon for that would just be a second way to do what clicking already does.
 *
 * "Your share" is signed by real direction (red when you owe, green when
 * you're owed) rather than the mockup's uniform red — the mockup only ever
 * shows the "you as debtor" case; the schema has no single "my kept share"
 * figure for a transaction you paid and split away, so a claim's own
 * shareAmount is what's shown, framed honestly rather than copying a number
 * the mockup didn't actually have to compute both ways.
 */
export function SharedActivity({
  claimsIOwe,
  claimsOwedToMe,
  currentUserId,
  accounts,
  categories,
  groupIdFor,
  onUpdateTransaction,
  onChanged,
}: {
  claimsIOwe: SplitClaim[]
  claimsOwedToMe: SplitClaim[]
  currentUserId: string
  accounts: Account[]
  categories: Category[]
  /**
   * A claim's own API shape carries no group id, so Settle Up's "same group"
   * requirement (POST /settlements needs a real groupId) is answered by the
   * caller instead — SharedPage already fetches every group's membership
   * list for other reasons and can say which group, if any, the viewer
   * shares with a given counterparty. Null means no shared group was found.
   */
  groupIdFor: (userId: string) => string | null
  onUpdateTransaction: (id: string, data: TransactionFormData) => Promise<unknown>
  onChanged: () => void
}) {
  const { addToast } = useToastStore()
  const [memberFilter, setMemberFilter] = useState<string[]>([])
  const [status, setStatus] = useState<StatusFilter>('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Holds one row for a single reject/cancel, or several for a bulk one — the
  // same confirm modal serves both so there is exactly one place that talks
  // to rejectSplit/cancelSplit, not two copies that could drift apart.
  const [rejecting, setRejecting] = useState<ActivityRow[] | null>(null)
  const [cancelling, setCancelling] = useState<ActivityRow[] | null>(null)
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  // Snapshot for the bulk-settle flow: which splits, who, and the sum to
  // prefill — captured at "Settle" click time so the dialog below renders
  // off a stable value rather than recomputing from a selection that keeps
  // changing underneath it (e.g. as rows are removed by onChanged refreshes).
  const [bulkSettle, setBulkSettle] = useState<{
    shareIds: string[]
    counterpartyId: string
    counterpartyUsername: string
    groupId: string | null
    total: number
  } | null>(null)

  const rows: ActivityRow[] = useMemo(() => {
    const debtorRows: ActivityRow[] = claimsIOwe.map((c) => ({
      ...c, role: 'debtor', counterpartyId: c.ownerId, counterpartyUsername: c.ownerUsername,
    }))
    const creditorRows: ActivityRow[] = claimsOwedToMe.map((c) => ({
      ...c, role: 'creditor', counterpartyId: c.debtorId, counterpartyUsername: c.debtorUsername,
    }))
    return [...debtorRows, ...creditorRows].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt.localeCompare(a.createdAt))
  }, [claimsIOwe, claimsOwedToMe])

  const participantsByTxn = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.transactionId, (map.get(r.transactionId) ?? 0) + 1)
    return map
  }, [rows])

  const memberOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) seen.set(r.counterpartyId, r.counterpartyUsername)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [rows])

  const filtered = rows.filter((r) => {
    if (memberFilter.length > 0 && !memberFilter.includes(r.counterpartyId)) return false
    if (status === 'settled') return r.state === 'settled'
    if (status === 'rejected') return r.state === 'rejected'
    if (status === 'open') return r.state === 'pending' || r.state === 'approved' || r.state === 'awaiting_confirmation'
    return true
  })
  const visible = filtered.slice(0, visibleCount)
  const openCount = rows.filter((r) => r.state === 'pending' || r.state === 'approved' || r.state === 'awaiting_confirmation').length
  const settledCount = rows.filter((r) => r.state === 'settled').length
  const rejectedCount = rows.filter((r) => r.state === 'rejected').length
  const emptyMessage =
    status === 'rejected' ? 'No rejected splits.'
      : status === 'settled' ? 'Nothing settled yet.'
        : status === 'open' ? "Nothing open — you're all caught up."
          : 'Nothing here.'

  // Selectable whenever anything at all could be done with it in bulk — not
  // just approvable, so a mixed selection of pending/approved rows across
  // both roles still gets checkboxes and the bulk bar shows whichever of
  // Agree/Reject/Cancel actually applies to what's selected.
  const isSelectable = (r: ActivityRow) => {
    const p = claimPermissions(r)
    return p.canApprove || p.canReject || p.canCancel
  }
  const selectableIds = new Set(visible.filter(isSelectable).map((r) => r.id))
  const selectedRows = visible.filter((r) => selected.has(r.id))
  const selectedApprovable = selectedRows.filter((r) => claimPermissions(r).canApprove)
  const selectedRejectable = selectedRows.filter((r) => claimPermissions(r).canReject)
  const selectedCancellable = selectedRows.filter((r) => claimPermissions(r).canCancel)

  // Whether the current selection can go straight to Settle Up — see
  // bulkSettleEligibility.ts for the actual rule (same debt direction, same
  // open state, same counterparty, and a group the viewer actually shares
  // with that counterparty).
  const settleEligibility = computeSettleEligibility(selectedRows, groupIdFor)

  function openBulkSettle() {
    if (!settleEligibility.ok || selectedRows.length === 0) return
    const first = selectedRows[0]
    setBulkSettle({
      shareIds: selectedRows.map((r) => r.id),
      counterpartyId: first.counterpartyId,
      counterpartyUsername: first.counterpartyUsername,
      groupId: groupIdFor(first.counterpartyId),
      total: Math.round(selectedRows.reduce((s, r) => s + r.outstanding, 0) * 100) / 100,
    })
  }

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = selectableIds.size > 0 && selected.size === selectableIds.size
  function handleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  async function handleApprove(row: ActivityRow) {
    try {
      await approveSplit(row.id)
      // Closes the detail popup on success only — on failure it stays open
      // with the error toasted, so the user can see what they were acting on
      // and try again rather than being dropped back to the list.
      setDetailRow(null)
      onChanged()
      addToast({ message: `Agreed: ${row.merchant || 'split'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not agree to this split.'), duration: 5000 })
    }
  }

  async function handleUndoApprove(row: ActivityRow) {
    try {
      await unapproveSplit(row.id)
      setDetailRow(null)
      onChanged()
      addToast({ message: `Undone: ${row.merchant || 'split'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not undo that.'), duration: 5000 })
    }
  }

  /** Payer accepts a debtor's counter-offer — works from either the row's own
   * Accept action or a different participant's row inside the detail modal,
   * so it is keyed by split id rather than a whole ActivityRow. */
  async function handleAcceptProposal(splitId: string, proposedAmount: number | null) {
    try {
      await acceptProposal(splitId)
      setDetailRow(null)
      onChanged()
      addToast({ message: `Accepted — share is now ${formatMYR(proposedAmount ?? 0)}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not accept that proposal.'), duration: 5000 })
    }
  }

  async function handleBulkApprove() {
    const ids = selectedApprovable.map((r) => r.id)
    if (ids.length === 0) return
    setBusy(true)
    try {
      const n = await approveSplits(ids)
      setSelected(new Set())
      onChanged()
      addToast({ message: `Agreed to ${n} split${n === 1 ? '' : 's'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not agree to those splits.'), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  function openReject(rowsToReject: ActivityRow[]) {
    setDetailRow(null)
    setRejecting(rowsToReject)
  }

  function openCancel(rowsToCancel: ActivityRow[]) {
    setDetailRow(null)
    setCancelling(rowsToCancel)
  }

  // No bulk reject/cancel endpoint exists server-side — this loops the same
  // per-claim call the single-row path uses (Promise.allSettled so one
  // failure in the batch doesn't hide the rest, mirroring MarkAllSettled's
  // partial-failure handling). The reason/proposedAmount validation itself
  // lives in RejectClaimModal, which only calls this once both are settled.
  async function confirmReject(reason: string, proposedAmount?: number) {
    if (!rejecting || rejecting.length === 0) return
    setBusy(true)
    try {
      const results = await Promise.allSettled(rejecting.map((r) => rejectSplit(r.id, reason, proposedAmount)))
      const failed = results.filter((r) => r.status === 'rejected').length
      const rejectedCount = rejecting.length
      setRejecting(null)
      setSelected(new Set())
      onChanged()
      if (failed > 0) {
        addToast({ message: `${failed} of ${rejectedCount} couldn't be rejected. The rest were.`, duration: 5000 })
      } else if (proposedAmount != null) {
        addToast({ message: `Rejected — proposed ${formatMYR(proposedAmount)}`, duration: 4000 })
      } else {
        addToast({ message: rejectedCount === 1 ? 'Split rejected' : `${rejectedCount} splits rejected`, duration: 4000 })
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmCancel() {
    if (!cancelling || cancelling.length === 0) return
    setBusy(true)
    try {
      const results = await Promise.allSettled(cancelling.map((r) => cancelSplit(r.id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      setCancelling(null)
      setSelected(new Set())
      onChanged()
      if (failed > 0) {
        addToast({ message: `${failed} of ${cancelling.length} couldn't be cancelled. The rest were.`, duration: 5000 })
      } else {
        addToast({ message: cancelling.length === 1 ? `Split cancelled: ${cancelling[0].merchant || 'split'}` : `${cancelling.length} splits cancelled`, duration: 4000 })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card c12" data-testid="shared-activity">
      <div className="card-head" style={{ padding: 'var(--s4) var(--s4) 0' }}>
        <div className="card-title">Shared activity</div>
        <div className="filters" style={{ marginLeft: 'auto' }}>
          <MultiSelect
            options={memberOptions}
            selected={memberFilter}
            onChange={setMemberFilter}
            allLabel="Everyone"
            testId="activity-member-filter"
          />
          <div className="segment" role="tablist">
            {(['open', 'settled', 'rejected', 'all'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'settled' ? 'Settled' : s === 'rejected' ? 'Rejected' : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 var(--s4)' }}>
        <div className="lhead lhead--activity">
          <span>Expense</span>
          <span className="col-hide-md">Paid by</span>
          <span className="col-hide-md">Split</span>
          <span className="num">Total</span>
          <span className="num">Your share</span>
          <span className="text-right">Actions</span>
        </div>

        {visible.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-fg-faint" data-testid="split-list-empty">{emptyMessage}</p>
        )}

        {visible.map((row) => {
          const { canApprove, canUndoApprove, canReject, canCancel } = claimPermissions(row)
          // Payer-only, and only once the debtor has put a counter-offer on
          // the table — the claim's own role+state says who is looking at it.
          const canAcceptProposal = row.role === 'creditor' && row.state === 'rejected' && row.proposedAmount != null
          const participants = (participantsByTxn.get(row.transactionId) ?? 0) + 1
          const isNegative = row.role === 'debtor'
          const title = row.merchant || row.description || '(no merchant)'
          const paletteIdx = memberOptions.findIndex((m) => m.value === row.counterpartyId)
          const palette = AVATAR_PALETTE[Math.max(0, paletteIdx) % AVATAR_PALETTE.length]
          const category = row.categoryId ? categories.find((c) => c.id === row.categoryId) : null
          // The claim carries the owner's category name, so a debtor-side row is
          // labelled too; the local lookup only covers the viewer's own categories.
          const categoryName = row.categoryName ?? category?.name ?? null
          const categoryColor = row.categoryColor ?? category?.color ?? null

          return (
            <div
              className="lrow lrow--activity cursor-pointer"
              key={row.id}
              data-testid="split-row"
              data-state={row.state}
              onClick={() => setDetailRow(row)}
            >
              <div className="tlead">
                {selectableIds.has(row.id) && (
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-brand-600"
                    aria-label={`Select ${title}`}
                  />
                )}
                <ActivityAvatar row={row} category={category} palette={palette} />
                <div style={{ minWidth: 0 }}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="tname min-w-0" data-testid="split-row-link">{title}</span>
                    <StatusChip state={row.state} />
                  </div>
                  {/* The debtor's counter-offer on a rejected claim — shown to
                      whichever side is reading it; only the payer also gets
                      the Accept action (trailing column, canAcceptProposal). */}
                  {row.state === 'rejected' && row.proposedAmount != null && (
                    <p className="tsub" data-testid="split-row-proposed-amount">
                      Proposed {formatMYR(row.proposedAmount)}
                    </p>
                  )}
                  {/* A merchant and an amount are not enough to judge a claim
                      by — shown whenever it differs from the title above, so
                      it is never silently dropped just because a merchant
                      also exists. */}
                  {row.description && row.description !== title && (
                    <p className="tsub" data-testid="split-row-description">{row.description}</p>
                  )}
                  <div className="tsub flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">{row.date && format(parseISO(row.date), 'dd MMM yyyy')}</span>
                    {categoryName && (
                      <Badge color={categoryColor ?? undefined} className="shrink-0 px-1.5 text-[10px]" data-testid="split-row-category">
                        {categoryName}
                      </Badge>
                    )}
                    {row.tags.map((tag) => (
                      <Badge key={tag} className="shrink-0 px-1.5 text-[10px]" data-testid="split-row-tag">{tag}</Badge>
                    ))}
                    {row.note && <span className="truncate italic" data-testid="split-row-note">&ldquo;{row.note}&rdquo;</span>}
                  </div>
                </div>
              </div>
              <div className="tmeta col-hide-md">
                <span className="tag">
                  <span className="avatar" style={{ width: 20, height: 20, fontSize: 9, background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' }}>
                    {row.role === 'debtor' ? row.ownerUsername.slice(0, 2).toUpperCase() : 'ME'}
                  </span>
                  {row.role === 'debtor' ? row.ownerUsername : 'You'}
                </span>
              </div>
              <div className="tmeta col-hide-md">{participants}-way split</div>
              <div className="num tmeta">{formatMYR(row.transactionAmount)}</div>
              <div className={cn('num amt money', isNegative ? 'neg' : 'pos')} data-testid="split-row-amount">
                {isNegative ? '−' : '+'}{formatMYR(row.state === 'settled' ? row.shareAmount : row.outstanding)}
              </div>
              <div className="trow-actions flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {canApprove && (
                  <RowActionIcon label="Agree" testId="claim-approve" onClick={() => handleApprove(row)}>
                    <Check className="h-3.5 w-3.5 text-positive-600" />
                  </RowActionIcon>
                )}
                {canUndoApprove && (
                  <RowActionIcon label="Undo agreement" testId="claim-unapprove" onClick={() => handleUndoApprove(row)}>
                    <Undo2 className="h-3.5 w-3.5" />
                  </RowActionIcon>
                )}
                {canReject && (
                  <RowActionIcon label="Reject" testId="claim-reject" onClick={() => openReject([row])}>
                    <X className="h-3.5 w-3.5 text-red-600" />
                  </RowActionIcon>
                )}
                {canCancel && (
                  <RowActionIcon label="Cancel split" testId="claim-cancel" onClick={() => openCancel([row])}>
                    <Ban className="h-3.5 w-3.5 text-red-600" />
                  </RowActionIcon>
                )}
                {canAcceptProposal && (
                  <RowActionIcon
                    label={`Accept proposed ${formatMYR(row.proposedAmount ?? 0)}`}
                    testId="claim-accept-proposal"
                    onClick={() => handleAcceptProposal(row.id, row.proposedAmount)}
                  >
                    <Check className="h-3.5 w-3.5 text-positive-600" />
                  </RowActionIcon>
                )}
              </div>
            </div>
          )
        })}

        <div className="divider" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
          <span style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>
            {openCount} open · {settledCount} settled · {rejectedCount} rejected
          </span>
          {filtered.length > visible.length && (
            <Button variant="secondary" style={{ marginLeft: 'auto' }} onClick={() => setVisibleCount((n) => n + 20)}>
              Load more
            </Button>
          )}
        </div>
      </div>

      {/* Fixed floating pill, not a bar embedded in card flow — same position
          and shape as WalletPage's own bulk-action bar (WalletPage.tsx),
          including the "Select all" link when the selection is partial. */}
      {selectedRows.length > 0 && (
        <BulkActionBar
          testId="split-bulk-bar"
          count={selectedRows.length}
          onClear={() => setSelected(new Set())}
          selectAll={
            !allSelected ? (
              <button
                type="button"
                onClick={handleSelectAll}
                data-testid="split-select-all"
                className="whitespace-nowrap text-sm font-medium text-brand-600 hover:underline"
              >
                Select all {selectableIds.size}
              </button>
            ) : undefined
          }
        >
          {selectedApprovable.length > 0 && (
            <Button size="sm" onClick={handleBulkApprove} disabled={busy} data-testid="split-bulk-approve">
              <Check className="h-3.5 w-3.5" /> Agree to {selectedApprovable.length}
            </Button>
          )}
          {selectedRejectable.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => openReject(selectedRejectable)} disabled={busy} data-testid="bulk-reject">
              <X className="h-3.5 w-3.5" /> Reject {selectedRejectable.length}
            </Button>
          )}
          {selectedCancellable.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => openCancel(selectedCancellable)} disabled={busy} data-testid="bulk-cancel">
              <Ban className="h-3.5 w-3.5" /> Cancel {selectedCancellable.length}
            </Button>
          )}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={openBulkSettle}
              disabled={!settleEligibility.ok || busy}
              title={settleEligibility.ok ? undefined : settleEligibility.reason}
              aria-describedby={settleEligibility.ok ? undefined : 'split-bulk-settle-reason'}
              data-testid="split-bulk-settle"
            >
              Settle {selectedRows.length}
            </Button>
            {/* Visible, not just a hover tooltip (CLAUDE.md §2 rule 10) — a
                disabled button with no reason reads as "nothing happened". */}
            {!settleEligibility.ok && (
              <span id="split-bulk-settle-reason" className="max-w-[16rem] text-xs text-fg-faint" data-testid="split-bulk-settle-reason">
                {settleEligibility.reason}
              </span>
            )}
          </div>
        </BulkActionBar>
      )}

      <RejectClaimModal
        rejecting={rejecting}
        busy={busy}
        onConfirm={confirmReject}
        onClose={() => setRejecting(null)}
      />

      <Modal
        open={!!cancelling}
        onOpenChange={(next) => { if (!next) setCancelling(null) }}
        title={cancelling && cancelling.length > 1 ? `Cancel ${cancelling.length} splits?` : 'Cancel this split?'}
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {cancelling && (cancelling.length === 1
              ? <>{formatMYR(cancelling[0].outstanding)} you claimed from {cancelling[0].debtorUsername} for <span className="font-medium">{cancelling[0].merchant || cancelling[0].description || '(no merchant)'}</span>.</>
              : <>{formatMYR(cancelling.reduce((s, r) => s + r.outstanding, 0))} total across {cancelling.length} splits.</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCancelling(null)}>Keep {cancelling && cancelling.length > 1 ? 'them' : 'it'}</Button>
            <Button variant="danger" size="sm" onClick={confirmCancel} disabled={busy} data-testid="claim-cancel-confirm">
              {cancelling && cancelling.length > 1 ? `Cancel ${cancelling.length} splits` : 'Cancel split'}
            </Button>
          </div>
        </div>
      </Modal>

      <SplitDetailModal
        row={detailRow ? {
          id: detailRow.id,
          transactionId: detailRow.transactionId,
          ownerId: detailRow.ownerId,
          ownerUsername: detailRow.ownerUsername,
          categoryName: detailRow.categoryName ?? categories.find((c) => c.id === detailRow.categoryId)?.name ?? null,
          categoryColor: detailRow.categoryColor ?? categories.find((c) => c.id === detailRow.categoryId)?.color ?? null,
          merchant: detailRow.merchant,
          description: detailRow.description,
          date: detailRow.date,
          transactionAmount: detailRow.transactionAmount,
          role: detailRow.role,
          ...claimPermissions(detailRow),
        } : null}
        currentUserId={currentUserId}
        accounts={accounts}
        categories={categories}
        onApprove={() => detailRow && handleApprove(detailRow)}
        onUndoApprove={() => detailRow && handleUndoApprove(detailRow)}
        onReject={() => detailRow && openReject([detailRow])}
        onCancel={() => detailRow && openCancel([detailRow])}
        onAcceptProposal={(splitId, proposedAmount) => handleAcceptProposal(splitId, proposedAmount)}
        onUpdateTransaction={onUpdateTransaction}
        onClose={() => setDetailRow(null)}
      />

      <SettleUpDialog
        groupId={bulkSettle?.groupId ?? ''}
        balance={bulkSettle ? {
          fromUserId: currentUserId,
          fromUsername: '',
          toUserId: bulkSettle.counterpartyId,
          toUsername: bulkSettle.counterpartyUsername,
          amount: bulkSettle.total,
        } : null}
        currentUserId={currentUserId}
        accounts={accounts.map((a) => ({ ...a, sharedByUsername: a.sharedByUsername ?? undefined }))}
        shareIds={bulkSettle?.shareIds}
        totalOutstanding={bulkSettle?.total}
        onClose={() => setBulkSettle(null)}
        onSettled={() => {
          // Recording is a claim, not a clearance (W4) — the counterparty
          // still has to confirm the money arrived, so "Settled" overstates
          // what just happened.
          const name = bulkSettle?.counterpartyUsername ?? ''
          setBulkSettle(null)
          setSelected(new Set())
          onChanged()
          addToast({ message: `Payment recorded — waiting for ${name} to confirm`, duration: 4000 })
        }}
      />
    </section>
  )
}

/**
 * A claim's leading glyph, in priority order:
 *
 * 1. `row.categoryIcon`/`row.categoryColor` — carried on the claim itself
 *    (GET /transactions/splits/mine LEFT JOINs categories on the underlying
 *    transaction's own category, worker/routes/wallet.ts). Resolves on
 *    EITHER side of a claim, because it's the transaction owner's category
 *    regardless of who is viewing.
 * 2. The local `categories` lookup (`category` below) — GET /categories is
 *    scoped to the caller's own rows, so this only resolves when the viewer
 *    owns that category (typically the creditor side). Kept as a fallback
 *    for a cached/older claim shape that predates `categoryIcon`/`Color`.
 * 3. The existing counterparty-palette `Receipt` glyph — never a blank
 *    avatar (CLAUDE.md §2 rule 10).
 *
 * `data-category-icon` stamps the RESOLVED icon key, not a raw `icon`
 * string.
 */
function ActivityAvatar({
  row,
  category,
  palette,
}: {
  row: Pick<SplitClaim, 'categoryIcon' | 'categoryColor'>
  category: Category | null | undefined
  palette: { bg: string; fg: string }
}) {
  const icon = row.categoryIcon ?? category?.icon ?? null
  const color = row.categoryColor ?? category?.color ?? null
  const tint = color ? categoryTint(color) : undefined
  const style = tint ?? { background: `rgb(${palette.bg})`, color: `rgb(${palette.fg})` }
  return (
    <div
      className="tavatar"
      style={style}
      aria-hidden="true"
      data-testid="activity-avatar"
      data-category-icon={icon ? resolveCategoryIconKey(icon) : 'none'}
    >
      {icon ? <CategoryIcon name={icon} className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
    </div>
  )
}

function StatusChip({ state }: { state: ClaimState }) {
  const style: Record<ClaimState, { label: string; cls: string }> = {
    pending: { label: 'To review', cls: 'chip-warn' },
    approved: { label: 'Agreed', cls: 'chip-info' },
    awaiting_confirmation: { label: 'Paid, unconfirmed', cls: 'chip-warn' },
    settled: { label: 'Settled', cls: 'chip-pos' },
    rejected: { label: 'Rejected', cls: 'chip-neg' },
  }
  const { label, cls } = style[state]
  return <span className={cn('chip', cls, 'shrink-0')} data-testid="activity-row-status">{label}</span>
}
