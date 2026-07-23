// Human-readable page titles keyed by route path. Shared by the desktop TopBar
// and the mobile top bar (AppShell). Kept in its own module so both component
// files stay Fast-Refresh-clean (component-only exports).
export const routeTitles: Record<string, string> = {
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
