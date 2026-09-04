import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ArrowRightLeft } from 'lucide-react'
import { formatMYR } from '@/lib/utils'
import type { TransferCandidateRow } from '@/modules/wallet/transferCandidates'
import type { Account } from '@/types/wallet.types'

interface TransferLinkHintProps {
  candidates: TransferCandidateRow[]
  /** The opposite type being searched for — only used for the banner's copy. */
  wantType: 'income' | 'expense'
  accounts: Account[]
  /** Link the edited transaction directly to this candidate — skips the manual picker. */
  onLink: (candidateId: string) => Promise<void>
}

/**
 * Edit mode's proactive banner: TransactionForm already ran the same search
 * LinkTransferDialog runs on click (via useTransferLinkCandidates) and found
 * at least one unlinked opposite-type row on another account matching this
 * transaction. Render it as a one-click suggestion. When nothing matches,
 * TransactionForm shows the manual "Link as transfer" button in the modal
 * header instead of this component (PR #161: banner when a match exists,
 * header button when it doesn't).
 */
export function TransferLinkHint({ candidates, wantType, accounts, onLink }: TransferLinkHintProps) {
  const [linkingId, setLinkingId] = useState<string | null>(null)

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
    </div>
  )
}
