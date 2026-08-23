import { NavLink, useLocation } from 'react-router-dom'
import { FlaskConical, Settings, X } from 'lucide-react'
import { cn, TEST_HOOKS_ENABLED } from '@/lib/utils'
import { modules } from './modules'
import { ModuleSwitcher } from './ModuleSwitcher'
import { InvitationsBadge } from '@/modules/settings/InvitationsBadge'
import { PendingClaimsBadge } from '@/modules/wallet/PendingClaimsBadge'

interface ModuleSidebarProps {
  open: boolean
  onClose: () => void
}

const navItemClass = ({ isActive }: { isActive: boolean }) => cn('nav-item', isActive && 'active')

/**
 * Module-scoped sidebar — answers "where inside this module", not "which
 * module" (that's AppBar's job now). Replaces Sidebar.tsx.
 *
 * Single `<aside class="sidebar">`, not a desktop/mobile pair: the ported CSS
 * already models mobile as this same element becoming `position: fixed` and
 * sliding on/off screen via `.sidebar.open`, so there is only ever one copy of
 * each nav item's testid in the DOM here (unlike the app-bar/tab-bar module
 * tabs, which really are two separate always-mounted components).
 *
 * Renders nothing on routes that aren't one of the four primary modules
 * (/settings, /help, /uat) — SettingsLayout already has its own General/Sharing
 * tab strip, and Settings stays reachable from AccountMenu on every route.
 *
 * `<ModuleSwitcher>` sits above `.module-head`, always mounted like
 * everything else in the shell — CSS shows it only in the 681-820px gap
 * (where `.modtabs` has no room and the mobile tab bar/drawer haven't
 * engaged yet) and hides `.module-head` in that same band, since the
 * switcher already shows the active module's icon and name.
 */
export function ModuleSidebar({ open, onClose }: ModuleSidebarProps) {
  const location = useLocation()
  const activeModule = modules.find((m) => !m.disabled && location.pathname.startsWith(m.path))

  if (!activeModule) return null

  return (
    <>
      <div className={cn('sidebar-backdrop', open && 'show')} onClick={onClose} aria-hidden="true" />
      <aside className={cn('sidebar', open && 'open')}>
        <ModuleSwitcher activeModule={activeModule} onNavigate={onClose} />
        <div className="module-head">
          <span className="module-head-mark">
            <activeModule.icon className="icon" size={16} />
          </span>
          <div>
            <div className="module-head-name">{activeModule.label}</div>
            <div className="module-head-sub">{activeModule.headSub}</div>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Close sidebar"
            data-testid="nav-menu-close"
          >
            <X className="icon" size={16} />
          </button>
        </div>

        {activeModule.navGroups.map((group, i) => (
          <div className="nav-group" key={group.label ?? `group-${i}`}>
            {group.label && <span className="u-label">{group.label}</span>}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                data-testid={item.testid}
                className={navItemClass}
              >
                <item.icon className="icon" size={16} />
                {item.label}
                {item.to === '/wallet/shared' && <PendingClaimsBadge />}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="sidebar-spacer" />

        <div className="nav-group">
          <NavLink to="/settings" end={false} onClick={onClose} data-testid="nav-settings" className={navItemClass}>
            <Settings className="icon" size={16} />
            Settings
            <InvitationsBadge />
          </NavLink>
          {TEST_HOOKS_ENABLED && (
            <NavLink to="/uat" end onClick={onClose} data-testid="nav-uat" className={navItemClass}>
              <FlaskConical className="icon" size={16} />
              UAT Tests
            </NavLink>
          )}
        </div>

        {/* Design spec §4: "Keep the trust-note footer (On your hardware).
            It is true and it is the product's position." */}
        <p className="mt-2 px-2 text-xs text-fg-faint">Daybook · On your hardware</p>
      </aside>
    </>
  )
}
