import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Check, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn, formatMYR } from '@/lib/utils'
import type { ClaimState, SplitClaim } from '@/types/household.types'

interface SplitListProps {
  claims: SplitClaim[]
  /** Which side the current user is on for these rows. */
  role: 'debtor' | 'creditor'
  emptyMessage: string
  onApprove?: (claim: SplitClaim) => void
  onReject?: (claim: SplitClaim) => void
  /** The payer withdrawing their own claim. Creditor-side rows only. */
  onCancel?: (claim: SplitClaim) => void
  /** Present only on tabs where a bulk action is possible. */
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

/**
 * The one renderer for a list of split claims.
 *
 * It replaces three that drew the same rows from the same endpoint in three
 * shapes: the review queue (merchant/date/owner, reject only), the balance
 * breakdown (merchant/date/paid, no actions) and the payments-to-confirm strip.
 * A claim looked like a different object depending on where you found it.
 *
 * Every row links to the transaction it came from. `range=all` and `view=all`
 * are not decoration: the transaction list defaults to the current month and to
 * the caller's own rows, so a claim from an earlier month — or one on someone
 * else's transaction — would land on an empty list, which reads as a broken link
 * rather than an active filter. That is the bug this whole workstream started
 * from.
 */
export function SplitList({
  claims,
  role,
  emptyMessage,
  onApprove,
  onReject,
  onCancel,
  selectedIds,
  onToggleSelect,
}: SplitListProps) {
  if (claims.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-gray-400" data-testid="split-list-empty">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-gray-100" data-testid="split-list">
      {claims.map((claim) => (
        <SplitRow
          key={claim.id}
          claim={claim}
          role={role}
          onApprove={onApprove}
          onReject={onReject}
          onCancel={onCancel}
          selected={selectedIds?.has(claim.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </ul>
  )
}

function SplitRow({
  claim,
  role,
  onApprove,
  onReject,
  onCancel,
  selected,
  onToggleSelect,
}: {
  claim: SplitClaim
  role: 'debtor' | 'creditor'
  onApprove?: (claim: SplitClaim) => void
  onReject?: (claim: SplitClaim) => void
  onCancel?: (claim: SplitClaim) => void
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const isPartial = claim.settledAmount > 0.005 && claim.state !== 'settled'
  // Rejecting is the debtor's lever alone, and only while nothing has been paid.
  // The server enforces both (worker/routes/wallet.ts:1252); showing a button
  // that always 409s would just be a worse way of saying no.
  const canReject =
    role === 'debtor' &&
    !!onReject &&
    (claim.state === 'pending' || claim.state === 'approved')
  // Agreeing is the debtor's move and only from unreviewed. It moves no money —
  // the debt was already owed — which is why it can be a single click.
  const canApprove = role === 'debtor' && !!onApprove && claim.state === 'pending'
  // Cancelling is the payer's mirror of reject and lives under the same rule —
  // open until money moves. A rejected claim is left alone: it is already inert,
  // and the recipient's reason is a record worth keeping.
  const canCancel =
    role === 'creditor' &&
    !!onCancel &&
    (claim.state === 'pending' || claim.state === 'approved')
  // A transaction with no merchant is not nameless — it usually has a
  // description, and falling through to it beats labelling the row "(no
  // merchant)" while the text that would identify it sits one line below.
  const title = claim.merchant || claim.description || '(no merchant)'

  return (
    <li
      className={cn('flex items-start gap-3 px-4 py-3', selected && 'bg-brand-50')}
      data-testid="split-row"
      data-state={claim.state}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect(claim.id)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-brand-600"
          data-testid="split-row-select"
          aria-label={`Select ${title}`}
        />
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        {/* `block` is load-bearing, not tidiness: `truncate` sets overflow and
            white-space, neither of which an inline element clips against. A long
            merchant name therefore ran straight out of this column and printed
            over the amount and the action buttons to its right. */}
        <Link
          to={`/wallet?txn=${claim.transactionId}&view=all&range=all`}
          className="block truncate text-sm font-medium text-gray-900 hover:text-brand-600 hover:underline"
          data-testid="split-row-link"
        >
          {title}
        </Link>
        {/* The description, whenever it is not already the title above. A
            merchant and an amount are not enough to judge a claim by — "GRAB"
            for RM60 is a question; "GRAB · airport run, split the fare" is an
            answer. Clamped rather than truncated: two lines of it are worth more
            than one, and it is the field being reviewed. */}
        {claim.description && claim.description !== title && (
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-gray-700" data-testid="split-row-description">
            {claim.description}
          </p>
        )}
        {/* break-words, because the text that lands here is a username and a
            username has no spaces to wrap at. Without it a long one overflows
            the column and is chopped mid-word by the clip above. */}
        <p className="mt-0.5 break-words text-xs text-gray-500">
          {claim.date && format(parseISO(claim.date), 'dd MMM yyyy')}
          {' · '}
          {role === 'debtor' ? `from ${claim.ownerUsername}` : `${claim.debtorUsername} owes`}
          {/* Both figures when they differ: a claim is a slice of a larger
              transaction, and hiding the total invites "why do I owe that?" */}
          {Math.abs(claim.shareAmount - claim.transactionAmount) > 0.005 && (
            <> · {formatMYR(claim.transactionAmount)} total</>
          )}
        </p>
        {claim.note && (
          <p className="mt-1 line-clamp-2 break-words text-xs italic text-gray-600" data-testid="split-row-note">
            “{claim.note}”
          </p>
        )}
        {claim.state === 'rejected' && (
          <p className="mt-1 text-xs text-red-600" data-testid="split-row-rejected">
            {role === 'creditor'
              ? `${claim.debtorUsername} rejected this`
              : 'You rejected this'}
            {claim.rejectedReason ? ` — “${claim.rejectedReason}”` : ''}
            {/* The payer's way back in. Before this the reason was collected,
                stored, and rendered nowhere: their balance simply dropped, with
                no notice, no explanation, and nothing to act on. */}
            {role === 'creditor' && (
              <Link
                to={`/wallet?txn=${claim.transactionId}&split=1&view=all&range=all`}
                className="ml-2 font-medium text-brand-600 hover:underline"
                data-testid="split-row-resplit"
              >
                Re-split
              </Link>
            )}
          </p>
        )}
        <StateHint claim={claim} role={role} />
        {isPartial && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${Math.min(100, (claim.settledAmount / claim.shareAmount) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-500" data-testid="split-row-paid">
              {formatMYR(claim.settledAmount)} paid
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            'text-sm font-semibold',
            claim.state === 'settled' || claim.state === 'rejected'
              ? 'text-gray-400'
              : role === 'debtor'
                ? 'text-red-700'
                : 'text-positive-700',
          )}
          data-testid="split-row-amount"
        >
          {/* Outstanding, not the original share: what a partly-paid claim is
              still worth is the only figure that can be acted on. */}
          {formatMYR(claim.state === 'settled' ? claim.shareAmount : claim.outstanding)}
        </span>
        {canApprove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onApprove(claim)}
            data-testid="claim-approve"
            aria-label={`Agree to ${title}`}
          >
            <Check className="h-3.5 w-3.5 text-positive-600" />
          </Button>
        )}
        {canReject && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReject(claim)}
            data-testid="claim-reject"
            aria-label={`Reject ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCancel(claim)}
            data-testid="claim-cancel"
            aria-label={`Cancel the split for ${title}`}
            title="Cancel this split"
          >
            <Undo2 className="h-3.5 w-3.5 text-gray-500" />
          </Button>
        )}
        {claim.state === 'settled' && (
          <Check className="h-4 w-4 text-positive-600" aria-label="Settled" />
        )}
      </div>
    </li>
  )
}

/**
 * What is happening to this claim and who it is waiting on.
 *
 * The awaiting-confirmation row is deliberately read-only on both sides: one
 * settlement can clear several claims, so the Confirm action belongs to the
 * payment as a whole and lives on the payments-to-confirm block. Offering it per
 * row would show the same action several times, each labelled with one slice of
 * what it does.
 */
function StateHint({ claim, role }: { claim: SplitClaim; role: 'debtor' | 'creditor' }) {
  const hint: Partial<Record<ClaimState, string>> = {
    pending:
      role === 'creditor' ? `Awaiting ${claim.debtorUsername}’s review` : '',
    approved:
      role === 'debtor' ? 'Agreed — not paid yet' : 'Agreed, not paid yet',
    awaiting_confirmation:
      role === 'debtor'
        ? `Paid — waiting on ${claim.ownerUsername} to confirm`
        : 'Payment recorded — confirm it above to clear this',
    settled: claim.settledAt
      ? `Settled ${format(parseISO(claim.settledAt.slice(0, 10)), 'dd MMM yyyy')}`
      : 'Settled',
  }
  const text = hint[claim.state]
  if (!text) return null
  return (
    <p className="mt-1 text-[11px] text-gray-400" data-testid="split-row-hint">
      {text}
    </p>
  )
}
