import { Outlet } from 'react-router-dom'
import { WalletTabNav } from './WalletTabNav'

/**
 * Shared layout wrapper for all /wallet/* routes.
 *
 * AppShell's <main> has `p-6`. We cancel it with -mx-6 -mt-6 so the
 * tab bar can be pinned edge-to-edge at the top, then re-apply padding
 * for the page content below. This ensures the tab bar never shifts
 * position when switching between wallet sub-pages.
 */
export function WalletLayout() {
  return (
    <div className="-mx-6 -mt-6 flex flex-col min-h-full">
      {/* Tab bar — stable, full-width, sticky while scrolling */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <WalletTabNav />
      </div>

      {/* Page content — each child manages its own max-width */}
      <div className="flex-1 p-6">
        <Outlet />
      </div>
    </div>
  )
}
