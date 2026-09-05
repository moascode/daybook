import { ArrowRightLeft, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn, formatMYR } from '@/lib/utils'
import type { GroupBalance, Settlement } from '@/types/household.types'

export interface Pairing {
  groupId: string
  groupName: string
  counterpartyId: string
  counterpartyUsername: string
  balance: GroupBalance | null
}

interface SharedBalancesProps {
  pairings: Pairing[]
  /** counterpartyId -> count of distinct shared transactions, for the row subtitle. */
  countByCounterparty: Record<string, number>
  /** counterpartyId -> their most recent awaiting_confirmation settlement with me, either direction. */
  pendingSettlementByCounterparty: Record<string, Settlement>
  currentUserId: string
  onSettleOne: (pairing: Pairing) => void
  onReviewPayment: (settlement: Settlement) => void
  onMarkAll: () => void
}

const AVATAR_PALETTE = [
  { bg: 'var(--alt-bg)', fg: 'var(--alt-fg)' },
  { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  { bg: 'var(--calm-bg)', fg: 'var(--calm-fg)' },
  { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
]

function initialsOf(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

/**
 * A same-icon-everywhere settle action needs no room for a label — this is
 * the same compact footprint as Shared activity's RowActionIcon, just with
 * two colour weights (a filled "this needs your money" vs a quiet "you're
 * just receiving") standing in for what the text used to say.
 */
function SettleIconButton({
  label,
  emphasis,
  onClick,
}: {
  label: string
  emphasis: 'filled' | 'quiet'
  onClick: () => void
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
          emphasis === 'filled'
            ? 'bg-brand-500 text-fg-on-accent hover:bg-brand-600'
            : 'text-fg-muted hover:bg-line-strong hover:text-fg',
        )}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  )
}

/**
 * Mockup's "Balances" + "Settle up" merged into one card, per owner direction,
 * as a grid of person tiles (owner's choice over the mockup's row list) — one
 * card per counterparty using the design system's existing `.acct` account-
 * card classes (avatar/name/sub, a big balance figure, a footer action row)
 * rather than inventing new markup, plus one "Mark all as settled" action for
 * every outstanding pairing at once. The full claim-by-claim detail lives in
 * the Shared activity card below — this card is pure summary + settle actions.
 *
 * The action per row is settlement-aware, not just balance-aware: a pairing
 * with an existing awaiting_confirmation settlement shows Review (the SAME
 * action as the Payments-to-confirm card) instead of Mark Received/Settle
 * Up — those record a NEW settlement, which on top of an unconfirmed one
 * produces a real duplicate the server correctly rejects. Two differently-
 * labelled buttons doing overlapping things for the same pairing was the bug.
 */
export function SharedBalances({
  pairings,
  countByCounterparty,
  pendingSettlementByCounterparty,
  currentUserId,
  onSettleOne,
  onReviewPayment,
  onMarkAll,
}: SharedBalancesProps) {
  const withBalance = pairings.filter((p) => p.balance && p.balance.amount > 0.005)
  const net = withBalance.reduce((sum, p) => {
    const iAmCreditor = p.balance!.toUserId === currentUserId
    return sum + (iAmCreditor ? p.balance!.amount : -p.balance!.amount)
  }, 0)
  // Only pairings with nothing already pending can go through "Mark all" — one
  // that already has an unconfirmed settlement needs Review, not a second one.
  const markAllEligible = withBalance.filter((p) => !pendingSettlementByCounterparty[p.counterpartyId])

  if (pairings.length === 0) return null

  return (
    <section id="shared-balances" className="card card-pad c12" data-testid="shared-balances">
      <div className="grid g3">
        {pairings.map((p, i) => {
          const balance = p.balance
          const iAmCreditor = !!balance && balance.toUserId === currentUserId
          const amount = balance?.amount ?? 0
          const settled = amount <= 0.005
          const palette = AVATAR_PALETTE[i % AVATAR_PALETTE.length]
          const count = countByCounterparty[p.counterpartyId] ?? 0
          const pending = pendingSettlementByCounterparty[p.counterpartyId]
          const iInitiatedPending = pending && pending.fromUserId === currentUserId

          return (
            <div className="acct" key={`${p.groupId}:${p.counterpartyId}`} data-testid="bal-row">
              <div className="acct-top">
                <span className="avatar" style={{ background: `rgb(${palette.bg})`, color: `rgb(${palette.fg})` }}>
                  {initialsOf(p.counterpartyUsername)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="acct-name">{p.counterpartyUsername}</div>
                  <div className="acct-sub">{count} shared transaction{count === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div className="acct-bal" style={!settled && iAmCreditor ? { color: 'rgb(var(--pos-fg))' } : undefined}>
                {settled ? formatMYR(0) : `${iAmCreditor ? '+' : '−'}${formatMYR(amount)}`}
              </div>
              <div className="acct-foot">
                {settled ? (
                  <span>Settled up</span>
                ) : pending ? (
                  iInitiatedPending ? (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Waiting on {p.counterpartyUsername}
                    </span>
                  ) : (
                    <span>Payment claimed</span>
                  )
                ) : (
                  <span>{iAmCreditor ? 'They owe you' : 'You owe them'}</span>
                )}
                {!settled && (
                  pending ? (
                    !iInitiatedPending && (
                      <SettleIconButton label="Review" emphasis="quiet" onClick={() => onReviewPayment(pending)} />
                    )
                  ) : (
                    <SettleIconButton
                      label={iAmCreditor ? 'Mark Received' : 'Settle Up'}
                      emphasis={iAmCreditor ? 'quiet' : 'filled'}
                      onClick={() => onSettleOne(p)}
                    />
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="divider" style={{ marginTop: 'var(--s4)' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>Net position across your groups</span>
        <span
          className="money"
          style={{
            fontSize: 'var(--t-lg)',
            fontWeight: 660,
            letterSpacing: '-.02em',
            color: Math.abs(net) < 0.005 ? undefined : net > 0 ? 'rgb(var(--pos-fg))' : 'rgb(var(--neg-fg))',
          }}
          data-testid="balances-net"
        >
          {Math.abs(net) < 0.005 ? formatMYR(0) : `${net > 0 ? '+' : '−'}${formatMYR(Math.abs(net))}`}
        </span>
      </div>

      {markAllEligible.length > 1 && (
        <Button variant="secondary" style={{ width: '100%', marginTop: 'var(--s3)' }} onClick={onMarkAll} data-testid="mark-all-settled">
          Mark all as settled
        </Button>
      )}
    </section>
  )
}
