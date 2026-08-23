import { NavLink, useLocation } from 'react-router-dom'
import { Bell, Menu, Plus } from 'lucide-react'
import { modules } from './modules'
import { SearchField } from './SearchField'
import { AccountMenu } from './AccountMenu'
import { useHouseholdStore } from '@/stores/household.store'
import { useNotificationBadgeStore } from '@/stores/notifications.store'
import { useToastStore } from '@/stores/toast.store'

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
  const addToast = useToastStore((s) => s.addToast)

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
        {/* Quick-add's form/modal is out of scope for R2 (design shell only)
            — a toast beats a click that silently does nothing (rule 13),
            same treatment AccountMenu's "Report a problem" already gets. */}
        <button
          type="button"
          className="circle-btn"
          aria-label="Quick add"
          data-testid="quick-add"
          onClick={() => addToast({ message: "Quick add isn't wired up yet — use New Task or Add Transaction for now." })}
        >
          <Plus className="icon" />
        </button>
        {/* No dropdown panel in R2 — just the live count (design §2); the
            click still needs to say something rather than nothing. */}
        <button
          type="button"
          className="circle-btn"
          aria-label="Notifications"
          data-testid="notifications-bell"
          onClick={() =>
            addToast({
              message:
                bellCount > 0
                  ? `${bellCount} notification${bellCount === 1 ? '' : 's'} — see Settings → Sharing for invites and claims, Wallet → Recurring for bills due.`
                  : "Nothing pending right now — this'll open a panel here in a future release.",
            })
          }
        >
          <Bell className="icon" />
          {bellCount > 0 && <span className="count">{bellCount > 99 ? '99+' : bellCount}</span>}
        </button>
        <AccountMenu />
      </div>
    </header>
  )
}
