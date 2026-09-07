import { NavLink, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { modules } from './modules'
import { SearchField } from './SearchField'
import { NotificationsPanel } from './NotificationsPanel'
import { QuickAddMenu } from './QuickAddMenu'
import { AccountMenu } from './AccountMenu'
import { useNotificationBadgeStore } from '@/stores/notifications.store'

interface AppBarProps {
  onOpenMobileMenu: () => void
}

// Reuse the exact pre-R2 testids on the two live module tabs so every
// navTo(page,'tasks'|'wallet') e2e caller needs zero changes (context map).
function modTabTestId(id: string): string {
  if (id === 'tasks') return 'nav-tasks'
  if (id === 'wallet') return 'nav-wallet'
  return `modtab-${id}`
}

/**
 * Desktop + mobile app bar: logo, global search, the four module tabs, and the
 * right-hand quick-add / notifications / account cluster. Replaces TopBar.tsx.
 *
 * The mobile hamburger only renders when the current route actually has a
 * module-scoped drawer to open (Tasks/Wallet) — ModuleSidebar renders nothing
 * on /settings, /help, /uat, so a hamburger there would be a click that changes
 * nothing (CLAUDE.md §2 rule 13). MobileTabBar remains reachable regardless.
 */
export function AppBar({ onOpenMobileMenu }: AppBarProps) {
  const location = useLocation()
  // Still used by the Tasks module tab's own badge, which is a per-destination
  // count and a different question from the bell's "what needs attention".
  const tasksDueCount = useNotificationBadgeStore((s) => s.tasksDueCount)

  // The bell's own count now comes from GET /notifications/pending, inside
  // NotificationsPanel — one computation shared with the push digest, so the
  // badge and your phone can never disagree. The client-side sum that used to
  // live here counted a different set (invites + claims + bills) and would have
  // drifted the moment either side gained a source.
  const hasModuleSidebar = modules.some((m) => !m.disabled && location.pathname.startsWith(m.path))

  return (
    <header className="appbar">
      <div className="appbar-left">
        {hasModuleSidebar && (
          <button
            type="button"
            className="menu-btn icon-btn"
            onClick={onOpenMobileMenu}
            aria-label="Open menu"
            data-testid="nav-menu-open"
          >
            <Menu className="icon" size={20} aria-hidden="true" />
          </button>
        )}
        <div className="appbar-logo" aria-hidden="true">D</div>
        <SearchField />
      </div>

      <nav className="modtabs" aria-label="Modules">
        {modules.map((m) =>
          m.disabled ? (
            // A real <button> (not a <span>) so aria-label actually reaches
            // assistive tech — ARIA prohibits naming a generic-role element
            // (what a bare <span> maps to), which made this tab invisible to
            // screen readers despite the visible "coming soon" tooltip
            // (design spec §2's whole point is that a disabled control WITH
            // A STATED REASON is honest). aria-disabled, not the native
            // `disabled` attribute — the latter can suppress :hover in some
            // engines, which would kill the tooltip this exists to show.
            <button
              key={m.id}
              type="button"
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
              className="modtab"
              aria-label={`${m.label} — coming soon`}
              data-testid={modTabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              <span className="tip-label" aria-hidden="true">
                Coming soon
              </span>
            </button>
          ) : (
            <NavLink
              key={m.id}
              to={m.path}
              end={m.id === 'tasks'}
              className="modtab"
              aria-label={m.label}
              data-testid={modTabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              {/* Tasks-only badge: tasks due today + overdue (design §2). */}
              {m.id === 'tasks' && tasksDueCount > 0 && (
                <span className="count">{tasksDueCount > 99 ? '99+' : tasksDueCount}</span>
              )}
              <span className="tip-label" aria-hidden="true">
                {m.label}
              </span>
            </NavLink>
          ),
        )}
      </nav>

      <div className="appbar-right">
        <QuickAddMenu />
        <NotificationsPanel />
        <AccountMenu />
      </div>
    </header>
  )
}
