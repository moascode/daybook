import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppBar } from './AppBar'
import { ModuleSidebar } from './ModuleSidebar'
import { MobileTabBar } from './MobileTabBar'
import { useNotificationBadges } from '@/hooks/useNotificationBadges'
import { ToastContainer } from '@/components/ui/Toast'

/**
 * v2 shell: a full-width AppBar on top, a module-scoped ModuleSidebar +
 * page content below it, and the mobile bottom tab bar. Replaces the old
 * Sidebar + TopBar pairing (design spec §7).
 *
 * `.appbar` is a sticky sibling above `.shell` (not a flex item inside it) —
 * `.shell` lays out the sidebar and the content column side by side;
 * `.sidebar`'s own `top: 56px` sticky offset assumes the app bar sits above it
 * in normal flow, not squeezed into the same flex row.
 */
export function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Single 60s poll for every shell badge (invites, claims, bills due, tasks
  // due) — mounted once here, not per-component. See the hook for why.
  useNotificationBadges()

  return (
    <>
      <AppBar onOpenMobileMenu={() => setMobileSidebarOpen(true)} />
      <div className="shell">
        <ModuleSidebar open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
        <div className="main-col">
          <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileTabBar />
      <ToastContainer />
    </>
  )
}
