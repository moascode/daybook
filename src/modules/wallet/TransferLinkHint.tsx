import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ArrowRightLeft } from 'lucide-react'
import { formatMYR } from '@/lib/utils'
import {
  fetchTransferCandidates,
  type TransferCandidateRow,
} from '@/modules/wallet/transferCandidates'
import type { Account } from '@/types/wallet.types'

const DEBOUNCE_MS = 400

interface TransferLinkHintProps {
  transactionId: string
  accountId: string
  type: 'expense' | 'income'
  amount: number
  date: string
  accounts: Account[]
  /** Link `transactionId` directly to this candidate — skips the manual picker. */
  onLink: (candidateId: string) => Promise<void>
  /** Manual fallback when no match is found automatically. */
  onOpenPicker: () => void
}

/**
 * Edit mode's proactive twin: as soon as an expense/income transaction is
 * open for editing, silently checks whether an unlinked opposite-type row on
 * another account already matches it (same search LinkTransferDialog runs on
 * click, just run eagerly). A match renders as a prominent inline banner the
 * user can act on with one click; no match falls back to the quieter manual
 * "Link as transfer" button (onOpenPicker) so a wider manual search is still
 * reachable.
 */
export function TransferLinkHint({
  transactionId,
  accountId,
  type,
  amount,
  date,
  accounts,
  onLink,
  onOpenPicker,
}: TransferLinkHintProps) {
  const [candidates, setCandidates] = useState<TransferCandidateRow[]>([])
  const [linkingId, setLinkingId] = useState<string | null>(null)

  const wantType = type === 'expense' ? 'income' : 'expense'
  const searchKey = amount > 0 && date ? `${transactionId}|${accountId}|${type}|${amount}|${date}` : null
  const [prevSearchKey, setPrevSearchKey] = useState<string | null>(searchKey)
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey)
    setCandidates([])
  }

  useEffect(() => {
    if (!searchKey) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetchTransferCandidates({ id: transactionId, accountId, amount, date, wantType })
        .then((matches) => { if (!cancelled) setCandidates(matches) })
        .catch(() => { if (!cancelled) setCandidates([]) })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchKey, transactionId, accountId, amount, date, wantType])

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account'

  async function handlePick(candidate: TransferCandidateRow) {
    if (linkingId) return
    setLinkingId(candidate.id)
    try {
      await onLink(candidate.id)
    } finally {
      setLinkingId(null)
    }
  }

  if (candidates.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpenPicker}
        data-testid="link-transfer-open"
        className="flex items-center gap-1.5 self-start rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-brand-300 hover:text-brand-600"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Link as transfer…
      </button>
    )
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
      data-testid="transfer-link-hint"
    >
      <p className="text-xs font-medium text-fg-muted">
        Found a matching {wantType} on another account — link them as one transfer?
      </p>
      <ul className="space-y-1.5" data-testid="transfer-link-hint-candidates">
        {candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => handlePick(c)}
              disabled={!!linkingId}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
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
      <button
        type="button"
        onClick={onOpenPicker}
        className="text-xs font-medium text-fg-faint hover:text-fg-muted hover:underline"
      >
        Not it? Search manually…
      </button>
    </div>
  )
}
