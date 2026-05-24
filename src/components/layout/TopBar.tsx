import { useLocation } from 'react-router-dom'

const routeTitles: Record<string, string> = {
  '/tasks': 'Tasks',
  '/wallet': 'Transactions',
  '/wallet/accounts': 'Accounts',
  '/wallet/dashboard': 'Dashboard',
  '/wallet/import': 'Import CSV',
}

export function TopBar() {
  const location = useLocation()
  const title = routeTitles[location.pathname] || 'Daybook'

  return (
    <header className="flex h-14 items-center border-b border-gray-200 bg-white px-6">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
    </header>
  )
}
