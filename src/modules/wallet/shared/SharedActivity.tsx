import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Ban, Check, Receipt, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToastStore } from '@/stores/toast.store'
import { approveSplit, approveSplits, cancelSplit, rejectSplit, unapproveSplit } from '@/hooks/useSplits'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import { SplitDetailModal } from './SplitDetailModal'
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
      <button
        type="button"
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-line-strong hover:text-fg"
      >
        {children}
      </button>
    </Tooltip>
  )
}

interface ActivityRow extends SplitClaim {
  role: 'debtor' | 'creditor'
  counterpartyId: string
  counterpartyUsername: string
}

type StatusFilter = 'open' | 'settled' | 'all'

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
  onUpdateTransaction,
  onChanged,
}: {
  claimsIOwe: SplitClaim[]
  claimsOwedToMe: SplitClaim[]
  currentUserId: string
  accounts: Account[]
  categories: Category[]
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
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)

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
    if (status === 'open') return r.state === 'pending' || r.state === 'approved' || r.state === 'awaiting_confirmation'
    return true
  })
  const visible = filtered.slice(0, visibleCount)
  const openCount = rows.filter((r) => r.state === 'pending' || r.state === 'approved' || r.state === 'awaiting_confirmation').length
  const settledCount = rows.filter((r) => r.state === 'settled').length

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
      onChanged()
      addToast({ message: `Agreed: ${row.merchant || 'split'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not agree to this split.'), duration: 5000 })
    }
  }

  async function handleUndoApprove(row: ActivityRow) {
    try {
      await unapproveSplit(row.id)
      onChanged()
      addToast({ message: `Undone: ${row.merchant || 'split'}`, duration: 4000 })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not undo that.'), duration: 5000 })
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
    setReason('')
  }

  function openCancel(rowsToCancel: ActivityRow[]) {
    setDetailRow(null)
    setCancelling(rowsToCancel)
  }

  // No bulk reject/cancel endpoint exists server-side — this loops the same
  // per-claim call the single-row path uses (Promise.allSettled so one
  // failure in the batch doesn't hide the rest, mirroring MarkAllSettled's
  // partial-failure handling).
  async function confirmReject() {
    if (!rejecting || rejecting.length === 0) return
    setBusy(true)
    try {
      const results = await Promise.allSettled(rejecting.map((r) => rejectSplit(r.id, reason)))
      const failed = results.filter((r) => r.status === 'rejected').length
      setRejecting(null)
      setReason('')
      setSelected(new Set())
      onChanged()
      if (failed > 0) {
        addToast({ message: `${failed} of ${rejecting.length} couldn't be rejected. The rest were.`, duration: 5000 })
      } else {
        addToast({ message: rejecting.length === 1 ? 'Split rejected' : `${rejecting.length} splits rejected`, duration: 4000 })
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
            {(['open', 'settled', 'all'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'settled' ? 'Settled' : 'All'}
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
          <p className="px-2 py-6 text-center text-xs text-fg-faint" data-testid="split-list-empty">Nothing here.</p>
        )}

        {visible.map((row) => {
          const { canApprove, canUndoApprove, canReject, canCancel } = claimPermissions(row)
          const participants = (participantsByTxn.get(row.transactionId) ?? 0) + 1
          const isNegative = row.role === 'debtor'
          const title = row.merchant || row.description || '(no merchant)'
          const paletteIdx = memberOptions.findIndex((m) => m.value === row.counterpartyId)
          const palette = AVATAR_PALETTE[Math.max(0, paletteIdx) % AVATAR_PALETTE.length]

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
                <div className="tavatar" style={{ background: `rgb(${palette.bg})`, color: `rgb(${palette.fg})` }}>
                  <Receipt className="h-4 w-4" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="tname min-w-0" data-testid="split-row-link">{title}</span>
                    <StatusChip state={row.state} />
                  </div>
                  {/* A merchant and an amount are not enough to judge a claim
                      by — shown whenever it differs from the title above, so
                      it is never silently dropped just because a merchant
                      also exists. */}
                  {row.description && row.description !== title && (
                    <p className="tsub" data-testid="split-row-description">{row.description}</p>
                  )}
                  <div className="tsub">
                    {row.date && format(parseISO(row.date), 'dd MMM yyyy')}
                    {row.note && <span className="italic" data-testid="split-row-note"> · &ldquo;{row.note}&rdquo;</span>}
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
              </div>
            </div>
          )
        })}

        <div className="divider" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
          <span style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>
            {openCount} open · {settledCount} settled
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
        <div
          data-testid="split-bulk-bar"
          className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-full border border-line bg-surface-raised px-3 py-2 shadow-xl shadow-line/60"
        >
          <span className="whitespace-nowrap px-2 text-sm font-medium text-fg">
            {selectedRows.length} selected
          </span>
          {!allSelected && (
            <button
              type="button"
              onClick={handleSelectAll}
              data-testid="split-select-all"
              className="whitespace-nowrap text-sm font-medium text-brand-600 hover:underline"
            >
              Select all {selectableIds.size}
            </button>
          )}
          <div className="mx-1 h-5 w-px bg-line" />
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
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
            title="Clear selection"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Modal
        open={!!rejecting}
        onOpenChange={(next) => { if (!next) setRejecting(null) }}
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={confirmReject} disabled={busy} data-testid="claim-reject-confirm">
              {rejecting && rejecting.length > 1 ? `Reject ${rejecting.length} splits` : 'Reject split'}
            </Button>
          </div>
        </div>
      </Modal>

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
        onUpdateTransaction={onUpdateTransaction}
        onClose={() => setDetailRow(null)}
      />
    </section>
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
