import { NavLink } from 'react-router-dom'
import { CheckSquare, Wallet, Settings, FlaskConical, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const mainNavItems = [
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, end: true },
  { to: '/wallet', label: 'Wallet', icon: Wallet, end: false },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const navContent = (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between gap-2.5 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            D
          </div>
          <span className="text-lg font-bold tracking-tight text-gray-900">
            Daybook
          </span>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 md:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 space-y-0.5 px-3 pt-2">
        {mainNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )
            }
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {item.label}
          </NavLink>
        ))}

        {/* Dev-only UAT link */}
        {import.meta.env.DEV && (
          <NavLink
            to="/uat"
            end
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )
            }
          >
            <FlaskConical className="h-4 w-4 flex-shrink-0" />
            UAT Tests
          </NavLink>
        )}
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-gray-200 px-3 py-3">
        <NavLink
          to="/settings"
          end
          onClick={onClose}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            )
          }
        >
          <Settings className="h-4 w-4 flex-shrink-0" />
          Settings
        </NavLink>
        <p className="mt-2 px-3 text-xs text-gray-400">Daybook Alpha</p>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex h-full w-56 flex-col border-r border-gray-200 bg-white">
        {navContent}
      </aside>

      {/* Mobile sidebar — slide-in drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            aria-hidden
          />
          {/* Drawer */}
          <aside className="relative flex h-full w-56 flex-col border-r border-gray-200 bg-white shadow-xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  )
}
