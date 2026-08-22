import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modules } from './modules'

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
  return (
    <>
      <nav className="tabbar" aria-label="Modules">
        {modules.map((m) =>
          m.disabled ? (
            // No href: a bare <a> without one is inert (no navigation, not in
            // the tab order) while still matching the `.tabbar a` CSS rule that
            // gives every tab its icon/label layout — a <span> here would
            // render unstyled.
            <a
              key={m.id}
              aria-disabled="true"
              aria-label={`${m.label} — coming soon`}
              data-testid={tabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              {m.label}
            </a>
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
      {/* Same inert quick-add as AppBar's — shell only in R2. */}
      <button type="button" className="fab" aria-label="Quick add" data-testid="fab-quick-add">
        <Plus className="icon" />
      </button>
    </>
  )
}
