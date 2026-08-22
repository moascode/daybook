import { NavLink, useLocation } from 'react-router-dom'
import { Bell, Menu, Plus } from 'lucide-react'
import { modules } from './modules'
import { SearchField } from './SearchField'
import { AccountMenu } from './AccountMenu'
import { useHouseholdStore } from '@/stores/household.store'
import { useNotificationBadgeStore } from '@/hooks/useNotificationBadges'

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
  const pendingInvites = useHouseholdStore((s) => s.pendingInvites.length)
  const pendingClaimCount = useHouseholdStore((s) => s.pendingClaimCount)
  const billsDueCount = useNotificationBadgeStore((s) => s.billsDueCount)
  const tasksDueCount = useNotificationBadgeStore((s) => s.tasksDueCount)

  // Bell = pending invites + unresolved split claims + bills due (design §2 / D-8).
  const bellCount = pendingInvites + pendingClaimCount + billsDueCount
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
            <span
              key={m.id}
              className="modtab"
              aria-disabled="true"
              aria-label={`${m.label} — coming soon`}
              data-testid={modTabTestId(m.id)}
            >
              <m.icon className="icon" aria-hidden="true" />
              <span className="tip-label" aria-hidden="true">
                Coming soon
              </span>
            </span>
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
        {/* Not wired to any action yet — quick-add's form/modal is out of scope
            for R2 (design shell only). */}
        <button type="button" className="circle-btn" aria-label="Quick add" data-testid="quick-add">
          <Plus className="icon" />
        </button>
        {/* No dropdown panel in R2 — just the live count (design §2). */}
        <button type="button" className="circle-btn" aria-label="Notifications" data-testid="notifications-bell">
          <Bell className="icon" />
          {bellCount > 0 && <span className="count">{bellCount > 99 ? '99+' : bellCount}</span>}
        </button>
        <AccountMenu />
      </div>
    </header>
  )
}
