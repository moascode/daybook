import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { WalletPage } from '@/modules/wallet/WalletPage'
import { AccountsPage } from '@/modules/wallet/AccountsPage'
import { Dashboard } from '@/modules/wallet/Dashboard'
import { CsvImport } from '@/modules/wallet/CsvImport'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'wallet', element: <WalletPage /> },
      { path: 'wallet/accounts', element: <AccountsPage /> },
      { path: 'wallet/dashboard', element: <Dashboard /> },
      { path: 'wallet/import', element: <CsvImport /> },
    ],
  },
])
