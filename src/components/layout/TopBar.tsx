import { useLocation } from 'react-router-dom'

const routeTitles: Record<string, string> = {
  '/tasks':             'Tasks',
  '/wallet':            'Transactions',
  '/wallet/accounts':   'Accounts',
  '/wallet/shared':     'Shared',
  '/wallet/dashboard':  'Dashboard',
  '/wallet/budgets':    'Budgets',
  '/wallet/recurring':  'Recurring',
  '/wallet/goals':      'Goals',
  '/wallet/reports':    'Reports',
  '/wallet/import':     'Import CSV',
  '/settings':          'Settings',
  '/settings/sharing':  'Sharing',
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
