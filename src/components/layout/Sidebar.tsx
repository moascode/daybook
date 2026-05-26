import { NavLink } from 'react-router-dom'
import { CheckSquare, Wallet, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, end: true },
  { to: '/wallet', label: 'Wallet', icon: Wallet, end: false },
  { to: '/uat', label: 'UAT Tests', icon: FlaskConical, end: true },
]

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          D
        </div>
        <span className="text-lg font-bold tracking-tight text-gray-900">
          Daybook
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 pt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
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
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 px-5 py-4">
        <p className="text-xs text-gray-400">Daybook Alpha</p>
      </div>
    </aside>
  )
}
