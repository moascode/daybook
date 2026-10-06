import { formatMYR } from '@/lib/utils'
import { goalColor, type GoalStatus } from '@/modules/wallet/goals/projection'
import type { Goal } from '@/types/wallet.types'

export interface GoalComputed {
  goal: Goal
  saved: number
  rate: number
  /** `'unknown'` when /goals/flows failed to load. */
  status: GoalStatus | 'unknown'
}

interface GoalsBandProps {
  computed: GoalComputed[]
  totalTarget: number
  totalSaved: number
  totalRate: number
  flowsReady: boolean
  addedThisMonth: number
  /** Count of GOALS (not accounts) whose linked account received a positive inflow this month — the "across {k} goals" caption under "Added this month". */
  contributingGoalCount: number
}

function isDated(c: GoalComputed): boolean {
  // Excludes `funded` (nothing left to be on/off schedule for) AND `paused`
  // (no current funding to judge a schedule by) — a paused, dated goal must
  // not be able to land the chip on "{0} behind" by being neither on-track
  // nor behind.
  return (
    c.goal.targetDate !== null && c.status !== 'unknown' && c.status.kind !== 'funded' && c.status.kind !== 'paused'
  )
}

function isOnTrackOrAhead(c: GoalComputed): boolean {
  return c.status !== 'unknown' && (c.status.kind === 'onTrack' || c.status.kind === 'ahead')
}

function isBehind(c: GoalComputed): boolean {
  return c.status !== 'unknown' && (c.status.kind === 'behind' || c.status.kind === 'overdue')
}

/** The "Saving toward" summary band (FEAT-067) — c12 head card above the goal cards. */
export function GoalsBand({
  computed, totalTarget, totalSaved, totalRate, flowsReady, addedThisMonth, contributingGoalCount,
}: GoalsBandProps) {
  const pct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0
  const stillToGo = Math.max(0, totalTarget - totalSaved)
  const datedGoals = computed.filter(isDated)
  const behindCount = datedGoals.filter(isBehind).length
  const allOnTrack = datedGoals.length > 0 && datedGoals.every(isOnTrackOrAhead)

  const monthsToGo = totalRate > 0 ? Math.ceil(stillToGo / totalRate) : null

  return (
    <section className="card card-pad c12" data-testid="goals-band">
      <div className="card-head">
        <div>
          <div className="card-title">Saving toward {formatMYR(totalTarget)}</div>
          <div className="card-sub">
            Across {computed.length} goal{computed.length === 1 ? '' : 's'}, at {flowsReady ? `${formatMYR(totalRate)} a month` : '—'}
          </div>
        </div>
        {datedGoals.length > 0 && (
          <span
            className={`chip ${allOnTrack ? 'chip-pos' : 'chip-warn'}`}
            style={{ marginLeft: 'auto' }}
            data-testid="goals-band-chip"
          >
            {allOnTrack
              ? `All ${datedGoals.length} funded on time at the current rate`
              : `${behindCount} behind at the current rate`}
          </span>
        )}
      </div>

      <div className="band">
        <div className="band-main">
          <div className="band-fig">
            <span className="v">{formatMYR(totalSaved)}</span>
            <span className="k">{pct}% of the way</span>
          </div>
        </div>
        <div className="band-stats">
          <div className="band-stat">
            <div className="k">Added this month</div>
            <div className="v" data-testid="goals-added-month">{flowsReady ? formatMYR(addedThisMonth) : '—'}</div>
            <div className="s">across {contributingGoalCount} goal{contributingGoalCount === 1 ? '' : 's'}</div>
          </div>
          <div className="band-stat">
            <div className="k">Still to go</div>
            <div className="v" data-testid="goals-still-to-go">{formatMYR(stillToGo)}</div>
            <div className="s">
              {monthsToGo !== null
                ? `about ${monthsToGo} month${monthsToGo === 1 ? '' : 's'} at ${formatMYR(totalRate)}`
                : 'no current funding'}
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="goals-segments"
        style={{ display: 'flex', height: 10, borderRadius: 'var(--r-full)', overflow: 'hidden', background: 'rgb(var(--track))', marginTop: 'var(--s5)' }}
      >
        {computed.map((c, i) => (
          <div
            key={c.goal.id}
            style={{ width: `${totalTarget > 0 ? (c.saved / totalTarget) * 100 : 0}%`, background: goalColor(i) }}
          />
        ))}
      </div>

      <div className="grid g2 g-tight-mobile" style={{ gap: 'var(--s2) var(--s6)', marginTop: 'var(--s4)' }}>
        {computed.map((c, i) => (
          <div
            key={c.goal.id}
            className="kv"
            style={{ border: 'none', padding: 0, flexWrap: 'nowrap', gap: 'var(--s3)' }}
            data-testid="goals-legend-row"
          >
            <span className="k" style={{ minWidth: 0, overflow: 'hidden' }}>
              <span className="tag" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <i style={{ background: goalColor(i) }} />{c.goal.name}
              </span>
            </span>
            <span className="v" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {formatMYR(c.saved)} ·{' '}
              {c.status === 'unknown' ? '—' : c.status.kind === 'paused' ? 'paused' : `${formatMYR(c.rate)}/mo`}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
