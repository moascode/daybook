import { format, parseISO } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { formatMYR } from '@/lib/utils'
import type { Account, Transaction } from '@/types/wallet.types'

interface TransactionDetailsPanelProps {
  transaction: Transaction
  ownerUsername: string
  /** From the claim, not the viewer's own categories — a debtor has no row for the owner's category. */
  categoryName: string | null
  categoryColor: string | null
  accounts: Account[]
}

const TYPE_LABEL: Record<Transaction['type'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

/**
 * Read-only view of someone else's transaction, shown inside the split detail
 * modal. A debtor used to be sent to /wallet to see it, which dropped them out
 * of the review they were in the middle of.
 */
export function TransactionDetailsPanel({
  transaction: t,
  ownerUsername,
  categoryName,
  categoryColor,
  accounts,
}: TransactionDetailsPanelProps) {
  // Only resolves when the account is shared with the viewer; otherwise it is
  // the owner's private account and its name is not ours to show.
  const account = accounts.find((a) => a.id === t.accountId)

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-line-subtle px-3 py-2.5 text-sm" data-testid="split-detail-transaction">
      <Row label="Paid by">{ownerUsername}</Row>
      <Row label="Date">{t.date && format(parseISO(t.date), 'dd MMM yyyy')}</Row>
      {t.merchant && <Row label="Merchant">{t.merchant}</Row>}
      {t.description && <Row label="Description">{t.description}</Row>}
      <Row label="Type">{TYPE_LABEL[t.type]}</Row>
      <Row label="Amount"><span className="tabular-nums">{formatMYR(t.amount)}</span></Row>
      {account && <Row label="Account">{account.name}</Row>}
      <Row label="Category">
        {categoryName
          ? <Badge color={categoryColor ?? undefined}>{categoryName}</Badge>
          : <span className="text-fg-faint">Uncategorised</span>}
      </Row>
      <Row label="Tags">
        {t.tags.length > 0
          ? <span className="flex flex-wrap gap-1">{t.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</span>
          : <span className="text-fg-faint">None</span>}
      </Row>
    </dl>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  )
}
