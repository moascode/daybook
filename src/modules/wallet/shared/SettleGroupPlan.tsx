import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { SettlePlan, SettleTransfer } from '@/types/household.types'

interface SettleGroupPlanProps {
  groupId: string
  /** Shown in the card title only when the viewer has more than one group. */
  groupName?: string
  plan: SettlePlan | null
  /** True when this group's settle-plan fetch failed — shown inline, never swallowed (CLAUDE.md rule 10). */
  error: boolean
  currentUserId: string
  onSettleDirect: (groupId: string, transfer: SettleTransfer) => void
}

/**
 * FEAT-024 PR B — "Settle the group" card. Shows the minimum-transfer plan
 * for a group only when it is SHORTER than the current pairwise balance
 * list, which is exactly the condition under which it tells the household
 * anything the per-pair Balances card above doesn't already say — for two
 * people the plan IS the bilateral net (design.md "value today"), so this
 * never renders for a two-person group.
 *
 * A `direct` transfer (the debtor already owes the creditor enough to cover
 * it on today's bilateral graph) settles through the existing, unchanged
 * SettleUpDialog. A non-direct transfer — the off-graph case design.md §3
 * describes (PR C, not yet built) — gets a disabled button with its reason
 * stated inline rather than a button that does nothing (CLAUDE.md rule 10).
 */
export function SettleGroupPlan({ groupId, groupName, plan, error, currentUserId, onSettleDirect }: SettleGroupPlanProps) {
  if (!error && (!plan || !(plan.transfers.length > 0 && plan.transfers.length < plan.pairwiseCount))) {
    return null
  }

  return (
    <section className="card card-pad c6" data-testid="settle-plan">
      <div className="card-head">
        <div>
          <div className="card-title">Settle the group{groupName ? ` · ${groupName}` : ''}</div>
          {plan && !error && (
            <div className="card-sub">
              {plan.transfers.length} payment{plan.transfers.length === 1 ? '' : 's'} clears what would otherwise take {plan.pairwiseCount}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600" data-testid="settle-plan-error">
          Couldn&rsquo;t load the settle-up plan for this group — please try again.
        </p>
      ) : (
        plan!.transfers.map((t) => {
          const isPayer = t.fromUserId === currentUserId
          const isPayee = t.toUserId === currentUserId
          return (
            <div className="prow" key={`${t.fromUserId}:${t.toUserId}`} data-testid="settle-plan-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="pname">{t.fromUsername} pays {t.toUsername}</div>
              </div>
              <div className="pamt">{formatMYR(t.amount)}</div>
              {t.direct ? (
                (isPayer || isPayee) && (
                  <Button size="sm" onClick={() => onSettleDirect(groupId, t)}>Settle</Button>
                )
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-subtle">Needs a three-way settlement — not available yet</span>
                  <Button size="sm" variant="secondary" disabled>Settle</Button>
                </div>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
