import { useEffect, useState } from 'react'
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns'
import { ArrowRightLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import type { Account, Transaction } from '@/types/wallet.types'

// Candidate window (plan §Open decisions: start at ±5 days, tune after use).
const CANDIDATE_WINDOW_DAYS = 5

// Raw row from GET /transactions — only the fields the picker needs.
interface CandidateRow {
  id: string
  account_id: string
  date: string
  merchant: string | null
  description: string | null
  amount: number
  type: string
  has_splits: number
}

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
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null)
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
    const base = parseISO(transaction.date)
    const dateFrom = format(addDays(base, -CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
    const dateTo = format(addDays(base, CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
    api
      .get<CandidateRow[]>(`/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}&type=${wantType}`)
      .then((rows) => {
        if (cancelled) return
        const matches = rows
          .filter(
            (r) =>
              r.id !== transaction.id &&
              r.account_id !== transaction.accountId &&
              Math.abs(r.amount - transaction.amount) <= 0.01 &&
              !r.has_splits,
          )
          // Best match first: closest date wins.
          .sort(
            (a, b) =>
              Math.abs(differenceInCalendarDays(parseISO(a.date), base)) -
              Math.abs(differenceInCalendarDays(parseISO(b.date), base)),
          )
        setCandidates(matches)
      })
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
        <p className="text-sm text-gray-500">
          Pick the matching {wantType} leg on another account — the two rows will
          merge into a single transfer of {formatMYR(transaction.amount)}.
        </p>

        {candidates === null ? (
          <p className="py-6 text-center text-sm text-gray-400">Looking for matches…</p>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400" data-testid="link-transfer-empty">
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
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {c.merchant || c.description || 'Untitled'}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {accountName(c.account_id)} · {format(parseISO(c.date), 'dd MMM yyyy')}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-gray-700">
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
