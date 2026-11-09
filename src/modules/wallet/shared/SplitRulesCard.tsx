import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useRules } from '@/hooks/useRules'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { mapMember } from '@/lib/household.mappers'
import { settingsPathForModule } from '@/modules/settings/sections'

/**
 * Wallet → Shared "Split rules": a read-only view of the caller's enabled
 * rules that auto-split (worker/routes/rules.ts). Editing stays in
 * Settings → Wallet → Rules — this card only links there.
 */
export function SplitRulesCard() {
  const { rules, loadRules } = useRules()
  const [names, setNames] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [membersError, setMembersError] = useState(false)

  useEffect(() => {
    loadRules().catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your split rules.")))
    // A members failure only costs the partner's name — rows fall back to "partner" and say why.
    api.get<Record<string, unknown>[]>('/groups/members')
      .then((rows) => setNames(Object.fromEntries(rows.map(mapMember).map((m) => [m.userId, m.username]))))
      .catch(() => setMembersError(true))
  }, [loadRules])

  const splitRules = rules
    .filter((r) => r.enabled && r.splitUserId && r.splitPercent != null)
    .sort((a, b) => a.position - b.position)

  return (
    <section className="card card-pad c6" data-testid="split-rules">
      <div className="card-head">
        <div>
          <div className="card-title">Split rules</div>
          <div className="card-sub">Applied automatically when a matching transaction is added</div>
        </div>
        <Link to={settingsPathForModule('wallet')} style={{ marginLeft: 'auto' }} data-testid="split-rules-manage">
          <Button variant="secondary" size="sm" tabIndex={-1}>Manage</Button>
        </Link>
      </div>
      {loadError ? (
        <p className="text-sm text-red-600" role="alert">{loadError}</p>
      ) : splitRules.length === 0 ? (
        <div style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }} data-testid="split-rules-empty">
          No split rules yet — every split is set per transaction. Add one in Settings → Wallet → Rules.
        </div>
      ) : (
        splitRules.map((r) => (
          <div className="kv" key={r.id} data-testid="split-rule-row">
            <span className="k">{r.name}</span>
            <span className="v">{names[r.splitUserId ?? ''] ?? 'partner'} pays {r.splitPercent}%</span>
          </div>
        ))
      )}
      {membersError && splitRules.length > 0 && (
        <p className="text-xs text-red-600">Couldn't load who you split with — names are hidden. Reload to retry.</p>
      )}
    </section>
  )
}
