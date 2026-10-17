import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link, Outlet, useLocation, type Location } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { InvitationsBadge } from './InvitationsBadge'
import { settingsSections, SETTINGS_GROUP_ORDER, type SettingsSection } from './sections'

const navItemClass = (active: boolean) =>
  cn(
    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-brand-50 text-brand-700'
      : 'text-fg-subtle hover:bg-surface-sunken hover:text-fg',
  )

/**
 * Plain `<Link>`, not `<NavLink>`: react-router's NavLink only applies
 * `aria-current` when ITS OWN `isActive` match fires, ignoring an
 * `aria-current` prop passed in when it hasn't (confirmed against
 * react-router-dom's source) — so it can't express "Profile is active
 * because /settings is its index route", only an exact path match. Active
 * state is computed here instead, from `location` directly, so the index
 * case can fold in cleanly.
 */
function sectionRow(section: SettingsSection, location: Location) {
  const Icon = section.icon
  if (section.disabled) {
    return (
      <div
        key={section.id}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-fg-faint opacity-60"
        aria-label={`${section.label} — ${section.disabledReason ?? 'coming later'}`}
      >
        <Icon className="h-4 w-4" />
        {section.label}
        <span className="ml-auto text-xs">{section.disabledReason}</span>
      </div>
    )
  }
  // The index route renders ProfileSettings (hidden on mobile, visible on
  // md+), so Profile is genuinely the content on screen at exactly
  // `/settings` too, not only at `/settings/profile`.
  const active =
    location.pathname === section.path || (location.pathname === '/settings' && section.id === 'profile')
  return (
    <Link
      key={section.id}
      to={section.path}
      aria-current={active ? 'page' : undefined}
      className={navItemClass(active)}
    >
      <Icon className="h-4 w-4" />
      {section.label}
      {section.id === 'sharing' && <InvitationsBadge />}
    </Link>
  )
}

/**
 * Layout for /settings/* sub-routes (module-based settings): a left nav
 * grouped You / Household / Modules, reading the ONE settings registry
 * (`sections.ts`), next to the active section's content.
 *
 * md+ shows both columns together, the nav sticky below the app bar so it
 * stays in view while a long section scrolls. Below md, /settings itself
 * shows only the index list (this component), and any section route shows
 * only that section plus a back link — the section page itself (e.g.
 * ProfileSettings) is never wrapped here, so a non-index route renders fully
 * on mobile with no extra markup from this layout.
 */
export function SettingsLayout() {
  const location = useLocation()
  const isIndex = location.pathname === '/settings'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="md:grid md:grid-cols-[220px_1fr] md:gap-8">
        {/* top: 56px matches the app bar's own height (shell.css) — the
            same sticky-under-the-app-bar convention `.tgroup-head` uses. */}
        <nav
          className="hidden md:sticky md:top-[56px] md:block md:self-start"
          aria-label="Settings sections"
        >
          <h2 className="u-label mb-3 px-3 text-fg-faint">Settings</h2>
          {SETTINGS_GROUP_ORDER.map((group) => (
            <div key={group} className="mb-5">
              <span className="u-label mb-1 block px-3">{group}</span>
              <div className="space-y-0.5">
                {settingsSections.filter((s) => s.group === group).map((s) => sectionRow(s, location))}
              </div>
            </div>
          ))}
        </nav>

        {/* max-w-2xl keeps every section's content column at the same width
            the old single-column /settings page used — SharingPage's own
            `mx-auto max-w-2xl` (untouched) then renders unchanged, not
            wider just because the layout around it grew a nav column. */}
        <div className="min-w-0 max-w-2xl">
          {isIndex && (
            <div className="md:hidden" data-testid="settings-index-list">
              <h1 className="page-title mb-4">Settings</h1>
              {SETTINGS_GROUP_ORDER.map((group) => (
                <div key={group} className="mb-4">
                  <span className="u-label mb-1 block px-1">{group}</span>
                  <div className="divide-y divide-line-subtle rounded-xl border border-line bg-surface">
                    {settingsSections
                      .filter((s) => s.group === group)
                      .map((section) => {
                        const Icon = section.icon
                        return section.disabled ? (
                          <div
                            key={section.id}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-sm text-fg-faint opacity-60"
                            aria-label={`${section.label} — ${section.disabledReason ?? 'coming later'}`}
                          >
                            <Icon className="h-4 w-4" />
                            {section.label}
                            <span className="ml-auto text-xs">{section.disabledReason}</span>
                          </div>
                        ) : (
                          <Link
                            key={section.id}
                            to={section.path}
                            className="flex min-h-[44px] items-center gap-2 px-3 text-sm text-fg"
                          >
                            <Icon className="h-4 w-4 text-fg-faint" />
                            <span className="flex-1">{section.label}</span>
                            <span className="flex items-center gap-1 text-fg-faint">
                              {section.id === 'sharing' && <InvitationsBadge />}
                              <ChevronRight className="h-4 w-4" />
                            </span>
                          </Link>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isIndex && (
            <div className="mb-4 md:hidden">
              <Link
                to="/settings"
                aria-label="Back to settings"
                className="inline-flex items-center gap-1 text-sm font-medium text-fg-subtle hover:text-fg"
              >
                <ChevronLeft className="h-4 w-4" />
                Settings
              </Link>
            </div>
          )}

          <Outlet />
        </div>
      </div>
    </div>
  )
}
