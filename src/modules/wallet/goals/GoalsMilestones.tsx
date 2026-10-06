import { Flag } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { Milestone, KnockOn } from '@/modules/wallet/goals/projection'

interface GoalsMilestonesProps {
  milestones: Milestone[]
  knockOn: KnockOn | null
  room: number | null
  kept: number
  /** Name of the goal the "Add to {name}" button targets — most-behind, else soonest-finishing. */
  roomTargetGoalName: string | null
  onAddToRoomTarget: () => void
}

function milestoneLabel(name: string, label: Milestone['label']): string {
  return `${name} ${label}`
}

function knockOnSentence(k: KnockOn): string {
  const month = format(parseISO(`${k.etaMonth}-01`), 'MMMM')
  if (k.kind === 'enoughToFix') {
    return `Finishing ${k.finishing} in ${month} frees ${formatMYR(k.freedRate)}/mo — enough to put ${k.target} back on schedule.`
  }
  if (k.kind === 'partialHelp') {
    return `Finishing ${k.finishing} in ${month} frees ${formatMYR(k.freedRate)}/mo — about ${k.pct}% of what ${k.target} is short.`
  }
  return `Finishing ${k.finishing} in ${month} frees ${formatMYR(k.freedRate)}/mo.`
}

/** "Next milestones" card: the next milestone per active goal, the knock-on sentence, and the "Room for another $X" row (FEAT-067 / absorbed FEAT-019). */
export function GoalsMilestones({ milestones, knockOn, room, kept, roomTargetGoalName, onAddToRoomTarget }: GoalsMilestonesProps) {
  const showRoom = room !== null && room >= 50 && roomTargetGoalName !== null

  // The card holds three independent, optional things — milestone rows, the
  // knock-on sentence, and the Room-for-more row — any one of which can be
  // present without the others (e.g. a lone goal finishing soon with no
  // fractional milestone left to show). Only omit the whole card when NONE
  // of the three has anything to say.
  if (milestones.length === 0 && !knockOn && !showRoom) return null

  return (
    <section className="card card-pad c4" data-testid="goals-milestones">
      <div className="card-head">
        <div className="card-title">Next milestones</div>
      </div>
      {milestones.map((m) => (
        <div key={m.goalId} className="prow" data-testid="goal-milestone">
          <div className="tavatar" style={{ background: 'rgb(var(--alt-bg))', color: 'rgb(var(--alt-fg))' }}>
            <Flag className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="pname">{milestoneLabel(m.name, m.label)}</div>
            <div className="psub">{formatMYR(m.amountToGo)} to go</div>
          </div>
          <div className="pamt" style={{ fontSize: 'var(--t-sm)' }}>{format(parseISO(`${m.eta}-01`), 'MMM yyyy')}</div>
        </div>
      ))}

      {knockOn && (
        <>
          <div className="divider" />
          <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="goals-knock-on">
            {knockOnSentence(knockOn)}
          </div>
        </>
      )}

      {showRoom && (
        <>
          <div className="divider" style={{ marginTop: 'auto' }} />
          <div className="sug" style={{ paddingBottom: 0 }} data-testid="goals-room">
            <div className="sug-main">
              <div className="sug-title">Room for another {formatMYR(room!)}</div>
              <div className="sug-sub">You kept {formatMYR(kept)} this month</div>
            </div>
            <Button variant="secondary" size="sm" onClick={onAddToRoomTarget}>
              Add to {roomTargetGoalName}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
