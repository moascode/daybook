import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modules } from './modules'
import { useToastStore } from '@/stores/toast.store'

// Same reuse rule as AppBar's modtabs (context map): keep nav-tasks/nav-wallet
// so navTo(page,'tasks'|'wallet') e2e callers work at any viewport, since only
// one of {AppBar's modtabs, this tabbar} is visible at a given width.
function tabTestId(id: string): string {
  if (id === 'tasks') return 'nav-tasks'
  if (id === 'wallet') return 'nav-wallet'
  return `modtab-${id}`
}

/**
 * Bottom tab bar + FAB — mobile-only via the already-ported CSS
 * (`.tabbar`/`.fab` are `display: none` above 680px), so this always renders
 * and lets the stylesheet decide visibility. Replaces no prior component; the
 * old shell had no mobile-specific primary nav.
 */
export function MobileTabBar() {
  const addToast = useToastStore((s) => s.addToast)

  return (
    <>
      <nav className="tabbar" aria-label="Modules, mobile">
        {modules.map((m) =>
          m.disabled ? (
            // A real <button> (not a bare <a> without href, which — like a
            // <span> — has no implicit ARIA role and so can't be named for
            // assistive tech) with aria-disabled rather than the native
            // `disabled` attribute, matching AppBar's modtab treatment.
            <button
              key={m.id}
              type="button"
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
              aria-label={`${m.label} — coming soon`}
              data-testid={tabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              {m.label}
            </button>
          ) : (
            <NavLink
              key={m.id}
              to={m.path}
              end={m.id === 'tasks'}
              className={({ isActive }) => cn(isActive && 'active')}
              aria-label={m.label}
              data-testid={tabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              {m.label}
            </NavLink>
          ),
        )}
      </nav>
      {/* Same not-wired-up quick-add as AppBar's — shell only in R2, but the
          click still needs to say something rather than nothing (rule 13). */}
      <button
        type="button"
        className="fab"
        aria-label="Quick add"
        data-testid="fab-quick-add"
        onClick={() => addToast({ message: "Quick add isn't wired up yet — use New Task or Add Transaction for now." })}
      >
        <Plus className="icon" />
      </button>
    </>
  )
}
