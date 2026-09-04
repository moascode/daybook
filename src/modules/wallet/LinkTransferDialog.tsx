import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ArrowRightLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { formatMYR } from '@/lib/utils'
import {
  fetchTransferCandidates,
  CANDIDATE_WINDOW_DAYS,
  type TransferCandidateRow,
} from '@/modules/wallet/transferCandidates'
import type { Account, Transaction } from '@/types/wallet.types'

interface LinkTransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The row being linked — one leg of the movement. */
  transaction: Transaction | null
  accounts: Account[]
  /** Called with the chosen twin's id; the parent performs the merge. */
  onLink: (twinId: string) => Promise<void>
}

export function LinkTransferDialog({
  open,
  onOpenChange,
  transaction,
  accounts,
  onLink,
}: LinkTransferDialogProps) {
  // null = still loading; the list is reset during render when the dialog
  // (re)opens for a transaction — same adjust-during-render pattern as
  // TransactionForm, which also keeps the linter's no-setState-in-effect rule.
  const [candidates, setCandidates] = useState<TransferCandidateRow[] | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  const wantType = transaction?.type === 'expense' ? 'income' : 'expense'

  const fetchKey = open && transaction ? transaction.id : null
  const [prevFetchKey, setPrevFetchKey] = useState<string | null>(null)
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey)
    setCandidates(null)
  }

  useEffect(() => {
    if (!open || !transaction) return
    let cancelled = false
    fetchTransferCandidates({
      id: transaction.id,
      accountId: transaction.accountId,
      amount: transaction.amount,
      date: transaction.date,
      wantType,
    })
      .then((matches) => { if (!cancelled) setCandidates(matches) })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [open, transaction, wantType])

  async function handlePick(twinId: string) {
    if (linkingId) return
    setLinkingId(twinId)
    try {
      await onLink(twinId)
    } finally {
      setLinkingId(null)
    }
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account'

  if (!transaction) return null

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Link as transfer" className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-fg-subtle">
          Pick the matching {wantType} leg on another account — the two rows will
          merge into a single transfer of {formatMYR(transaction.amount)}.
        </p>

        {candidates === null ? (
          <p className="py-6 text-center text-sm text-fg-faint">Looking for matches…</p>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-faint" data-testid="link-transfer-empty">
            No matching {wantType} with this amount found on another account
            within ±{CANDIDATE_WINDOW_DAYS} days.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto" data-testid="link-transfer-candidates">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => handlePick(c.id)}
                  disabled={!!linkingId}
                  className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {c.merchant || c.description || 'Untitled'}
                    </span>
                    <span className="block text-xs text-fg-faint">
                      {accountName(c.account_id)} · {format(parseISO(c.date), 'dd MMM yyyy')}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-fg-muted">
                    {formatMYR(c.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
