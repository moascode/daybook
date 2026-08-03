import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { HelpButton } from './HelpButton'
import { ThemeToggle } from './ThemeToggle'
import { routeTitles } from './routeTitles'
import { ToastContainer } from '@/components/ui/Toast'

export function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const location = useLocation()
  const mobileTitle = routeTitles[location.pathname] ?? 'Daybook'

  return (
    <div className="flex h-screen overflow-hidden bg-surface-sunken">
      <Sidebar open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar with hamburger + current page title (U-05) */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 md:hidden">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">{mobileTitle}</h1>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <HelpButton />
          </div>
        </div>
        {/* Desktop top bar */}
        <div className="hidden md:block">
          <TopBar />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
    </div>
  )
}
