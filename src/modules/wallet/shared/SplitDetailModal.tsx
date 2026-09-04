import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Check, ExternalLink, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TransactionForm, type TransactionFormData } from '@/modules/wallet/TransactionForm'
import { api } from '@/lib/api'
import { cn, formatMYR } from '@/lib/utils'
import { mapTransaction, type TransactionRow } from '@/hooks/useWallet'
import type { Account, Category, Transaction } from '@/types/wallet.types'

interface Participant {
  id: string
  user_id: string
  username: string
  share_amount: number
  note: string
  status: 'pending' | 'approved' | 'settled' | 'rejected'
  rejected_reason: string
  rejected_at: string | null
  settled_at: string | null
}

interface RowInfo {
  id: string
  transactionId: string
  ownerId: string
  merchant: string
  description: string
  date: string
  transactionAmount: number
  role: 'debtor' | 'creditor'
  canApprove: boolean
  canUndoApprove: boolean
  canReject: boolean
  canCancel: boolean
}

const RAW_STATUS_LABEL: Record<Participant['status'], string> = {
  pending: 'To review',
  approved: 'Agreed',
  settled: 'Settled',
  rejected: 'Rejected',
}
const RAW_STATUS_CHIP: Record<Participant['status'], string> = {
  pending: 'chip-warn',
  approved: 'chip-info',
  settled: 'chip-pos',
  rejected: 'chip-neg',
}

/**
 * The transaction owner's own split row is not a claim anyone reviews — it's
 * the remainder they kept, created automatically alongside everyone else's
 * share. Showing it with the same "To review" chip as the actual recipients
 * read as if the owner had something pending too, when the real distinction
 * is "claimed this from them" vs "still needs to act." Who it is is already
 * the row's own name on the left — the chip only needs to say what, not who.
 */
function statusLabelFor(p: Participant, ownerId: string): { label: string; cls: string } {
  if (p.user_id === ownerId) return { label: 'Claimed', cls: 'chip-mute' }
  if (p.status === 'pending') return { label: 'To review', cls: RAW_STATUS_CHIP.pending }
  return { label: RAW_STATUS_LABEL[p.status], cls: RAW_STATUS_CHIP[p.status] }
}

/**
 * The transaction's full split breakdown, in place — click a Shared activity
 * row and see everyone's share, status and note without leaving the page.
 * Routing to /wallet?txn=... for this was real information loss: a payer's
 * note is written to one specific recipient's split row, so viewing it
 * required navigating away and hoping to spot it there — most people never
 * would.
 *
 * "Edit transaction" opens the real TransactionForm in place too, for the
 * owner only (editing someone else's transaction was never authorised —
 * the server rejects it, so a debtor-side row gets a plain "View transaction"
 * link instead of a button promising an edit that would just fail). There is
 * no GET /transactions/:id — the transaction is located via the day it fell
 * on (dateFrom=dateTo=the claim's own date) and matched by id, since that is
 * the only filter the existing list endpoint offers.
 */
export function SplitDetailModal({
  row,
  currentUserId,
  accounts,
  categories,
  onApprove,
  onUndoApprove,
  onReject,
  onCancel,
  onUpdateTransaction,
  onClose,
}: {
  row: RowInfo | null
  currentUserId: string
  accounts: Account[]
  categories: Category[]
  onApprove: () => void
  onUndoApprove: () => void
  onReject: () => void
  onCancel: () => void
  /** Reuses useWallet's updateTransaction so the shared wallet store (read by
   * Overview/Transactions) stays in sync — a raw PUT here would leave those
   * pages showing stale merchant/amount/etc. until their own next refetch. */
  onUpdateTransaction: (id: string, data: TransactionFormData) => Promise<unknown>
  onClose: () => void
}) {
  const [participants, setParticipants] = useState<Participant[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editLoading, setEditLoading] = useState(false)

  function loadParticipants(transactionId: string) {
    setLoadError(false)
    api.get<Participant[]>(`/transactions/${transactionId}/splits`)
      .then(setParticipants)
      .catch(() => setLoadError(true))
  }

  useEffect(() => {
    if (!row) { setParticipants(null); return } // eslint-disable-line react-hooks/set-state-in-effect
    loadParticipants(row.transactionId)
  }, [row])

  async function openEdit() {
    if (!row) return
    setEditLoading(true)
    try {
      const rows = await api.get<TransactionRow[]>(`/transactions?dateFrom=${row.date}&dateTo=${row.date}`)
      const match = rows.find((r) => r.id === row.transactionId)
      if (!match) throw new Error('Transaction not found')
      setEditingTransaction(mapTransaction(match))
      // Deliberately not onClose(): the detail Modal stays mounted with `row`
      // intact underneath, gated open only by `!editingTransaction` below —
      // so cancelling or finishing the edit form returns to this view instead
      // of dropping the user back to nothing.
    } catch {
      setLoadError(true)
    } finally {
      setEditLoading(false)
    }
  }

  async function handleUpdate(data: TransactionFormData) {
    if (!editingTransaction) return
    await onUpdateTransaction(editingTransaction.id, data)
    setEditingTransaction(null)
    loadParticipants(editingTransaction.id)
  }

  const title = row ? (row.merchant || row.description || '(no merchant)') : ''
  const isOwner = row?.role === 'creditor'
  const anyRejected = participants?.some((p) => p.status === 'rejected') ?? false

  return (
    <>
      <Modal open={!!row && !editingTransaction} onOpenChange={(next) => { if (!next) onClose() }} title={title}>
        {row && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-fg-subtle">{row.date && format(parseISO(row.date), 'dd MMM yyyy')}</span>
              <span className="text-base font-semibold text-fg">{formatMYR(row.transactionAmount)} total</span>
            </div>

            {isOwner && anyRejected && (
              <div className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  Someone rejected this split — see their note below.
                  <Link
                    to={`/wallet?txn=${row.transactionId}&split=1&view=all&range=all`}
                    className="mt-1 block font-medium underline underline-offset-2 hover:no-underline"
                  >
                    Re-split this transaction
                  </Link>
                </div>
              </div>
            )}

            {loadError && <p className="text-sm text-red-600">Something went wrong loading this split.</p>}

            {participants && (
              <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
                {participants.map((p) => {
                  const { label, cls } = statusLabelFor(p, row.ownerId)
                  return (
                    <li key={p.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">
                          {p.user_id === currentUserId ? 'You' : p.username}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm tabular-nums text-fg">{formatMYR(p.share_amount)}</span>
                          <span className={cn('chip', cls)}>{label}</span>
                        </div>
                      </div>
                      {p.note && (
                        <p className="mt-1 text-xs italic text-fg-muted">&ldquo;{p.note}&rdquo;</p>
                      )}
                      {p.status === 'rejected' && p.rejected_reason && (
                        <p className="mt-1 text-xs text-red-600">Rejected &mdash; &ldquo;{p.rejected_reason}&rdquo;</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
              {isOwner ? (
                <Button variant="secondary" size="sm" onClick={openEdit} disabled={editLoading}>
                  {editLoading ? 'Opening…' : 'Edit transaction'}
                </Button>
              ) : (
                <Link
                  to={`/wallet?txn=${row.transactionId}&view=all&range=all`}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View transaction
                </Link>
              )}
              <div className="flex gap-2">
                {row.canApprove && <Button size="sm" onClick={onApprove}><Check className="mr-1 h-3.5 w-3.5" />Agree</Button>}
                {row.canUndoApprove && <Button size="sm" variant="secondary" onClick={onUndoApprove}><Undo2 className="mr-1 h-3.5 w-3.5" />Undo agreement</Button>}
                {row.canReject && <Button size="sm" variant="danger" onClick={onReject}><X className="mr-1 h-3.5 w-3.5" />Reject</Button>}
                {row.canCancel && <Button size="sm" variant="danger" onClick={onCancel}><Undo2 className="mr-1 h-3.5 w-3.5" />Cancel split</Button>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <TransactionForm
        open={!!editingTransaction}
        onOpenChange={(next) => { if (!next) setEditingTransaction(null) }}
        transaction={editingTransaction}
        accounts={accounts}
        categories={categories}
        onSubmit={handleUpdate}
      />
    </>
  )
}
