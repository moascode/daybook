import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { InvitationsBadge } from './InvitationsBadge'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700'
      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
  )

/**
 * Layout for /settings/* sub-routes: a small tab strip (General | Sharing)
 * above the active sub-page. Sub-routes keep bookmarks and deep links stable
 * as the Settings section grows (§3.3.3).
 */
export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-6 flex items-center gap-1" aria-label="Settings sections">
        <NavLink to="/settings" end className={tabClass}>
          General
        </NavLink>
        <NavLink to="/settings/sharing" end className={tabClass}>
          Sharing
          <InvitationsBadge />
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
