import { Fragment, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { FlaskConical, Settings, X, Inbox, StickyNote } from 'lucide-react'
import { cn, TEST_HOOKS_ENABLED, errorMessage } from '@/lib/utils'
import { modules } from './modules'
import { ModuleSwitcher } from './ModuleSwitcher'
import { InvitationsBadge } from '@/modules/settings/InvitationsBadge'
import { PendingClaimsBadge } from '@/modules/wallet/PendingClaimsBadge'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useToastStore } from '@/stores/toast.store'
import { useDayStore } from '@/stores/day.store'

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
  const addToast = useToastStore((s) => s.addToast)
  const { taskLists, loadTaskLists } = useTaskLists()
  const { showTasks, showMoney, toggle } = useDayStore()

  const isTasksModule = activeModule?.id === 'tasks'
  const isDayModule = activeModule?.id === 'day'

  // The dynamic Lists group is scoped to the Tasks module only — no need to
  // fetch task_lists at all when it isn't showing.
  useEffect(() => {
    if (!isTasksModule) return
    loadTaskLists().catch((err) => {
      addToast({ message: errorMessage(err, 'Could not load your task lists.') })
    })
  }, [isTasksModule, loadTaskLists, addToast])

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
          <Fragment key={group.label ?? `group-${i}`}>
            <div className="nav-group">
              {group.label && <span className="u-label">{group.label}</span>}
              {group.items.map((item) =>
                item.disabled ? (
                  // Real <button aria-disabled>, not the native `disabled`
                  // attribute (which would also suppress :hover and the
                  // tooltip it reveals) — mirrors AppBar's disabled module tab.
                  <button
                    key={item.to}
                    type="button"
                    aria-disabled="true"
                    onClick={(e) => e.preventDefault()}
                    className={cn('nav-item', 'opacity-40 cursor-not-allowed')}
                    aria-label={`${item.label} — ${item.disabledReason ?? 'Coming soon'}`}
                    data-testid={item.testid}
                  >
                    <item.icon className="icon" size={16} />
                    {item.label}
                    <span className="tip-label" aria-hidden="true">
                      {item.disabledReason ?? 'Coming soon'}
                    </span>
                  </button>
                ) : (
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
                ),
              )}
            </div>

            {/* Dynamic "Show on the timeline" toggle group (R6,
                docs/v2/day/02-design-adoption.md §Sidebar) — checkboxes, not
                links, so they can't be plain ModuleNavItems; state lives in
                day.store.ts since ModuleSidebar and DayPage are siblings.
                Sits between the primary destinations group and Review, per
                docs/v2/foundation/03-app-shell.md's IA — hence injected
                right after group 0 rather than appended at the end. */}
            {isDayModule && i === 0 && (
              <div className="nav-group">
                <span className="u-label">Show on the timeline</span>
                <label className="nav-item cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showTasks}
                    onChange={() => toggle('showTasks')}
                    className="h-4 w-4 rounded border-line-strong text-brand-600 cursor-pointer"
                    data-testid="day-toggle-tasks"
                  />
                  Tasks &amp; habits
                </label>
                <label className="nav-item cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMoney}
                    onChange={() => toggle('showMoney')}
                    className="h-4 w-4 rounded border-line-strong text-brand-600 cursor-pointer"
                    data-testid="day-toggle-money"
                  />
                  Money
                </label>
                {/* Disabled, not a live no-op checkbox: R6 ships no
                    "scheduled" row kind in the merge at all, so a working
                    checkbox here would be a click that changes nothing and
                    explains nothing (CLAUDE.md rule 13). */}
                <button
                  type="button"
                  aria-disabled="true"
                  onClick={(e) => e.preventDefault()}
                  className="nav-item opacity-40 cursor-not-allowed"
                  aria-label="Scheduled & bills — no scheduled rows yet"
                  data-testid="day-toggle-scheduled"
                >
                  Scheduled &amp; bills
                  <span className="tip-label" aria-hidden="true">
                    No scheduled rows yet
                  </span>
                </button>
                <button
                  type="button"
                  aria-disabled="true"
                  onClick={(e) => e.preventDefault()}
                  className="nav-item opacity-40 cursor-not-allowed"
                  aria-label="Notes on the timeline — Coming in R15"
                  data-testid="day-toggle-notes"
                >
                  <StickyNote className="icon" size={16} />
                  Notes
                  <span className="tip-label" aria-hidden="true">
                    Coming in R15
                  </span>
                </button>
              </div>
            )}
          </Fragment>
        ))}

        {/* Dynamic per-user "Lists" group (docs/v2/tasks/02-design-adoption.md
            §Sidebar) — one item per task_lists row plus a fixed trailing
            "Unsorted" bucket so orphaned (list_id NULL) tasks always have a
            home. Injected here, not in modules.ts, which stays static/pure. */}
        {isTasksModule && (
          <div className="nav-group">
            <span className="u-label">Lists</span>
            {taskLists.map((list) => (
              <NavLink
                key={list.id}
                to={`/tasks/lists/${list.id}`}
                end
                onClick={onClose}
                data-testid={`nav-tasks-list-${list.id}`}
                className={navItemClass}
              >
                {/* Per-list colour is user data (D-10), not a semantic token —
                    an inline style is the correct, documented exception. */}
                <span
                  className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: list.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{list.name}</span>
                {list.openCount > 0 && <span className="nav-badge">{list.openCount}</span>}
              </NavLink>
            ))}
            <NavLink
              to="/tasks/lists/unsorted"
              end
              onClick={onClose}
              data-testid="nav-tasks-list-unsorted"
              className={navItemClass}
            >
              <Inbox className="icon" size={16} />
              Unsorted
            </NavLink>
          </div>
        )}

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

        {/* Version bump: update on each release tag (see CLAUDE.md §13). */}
        <p className="mt-2 px-2 text-xs text-fg-faint">Daybook · v3.0.0</p>
      </aside>
    </>
  )
}
