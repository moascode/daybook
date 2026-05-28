import { useLocation } from 'react-router-dom'

const routeTitles: Record<string, string> = {
  '/tasks':             'Tasks',
  '/wallet':            'Wallet',
  '/wallet/accounts':   'Wallet',
  '/wallet/dashboard':  'Wallet',
  '/wallet/import':     'Wallet',
  '/settings':          'Settings',
  '/uat':               'UAT Tests',
}

export function TopBar() {
  const location = useLocation()
  const title = routeTitles[location.pathname] ?? 'Daybook'

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-gray-200 bg-white px-6">
      <h1 className="text-sm font-semibold text-gray-700 tracking-wide uppercase">{title}</h1>
    </header>
  )
}
