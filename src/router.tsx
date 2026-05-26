import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { WalletLayout } from '@/modules/wallet/WalletLayout'
import { WalletPage } from '@/modules/wallet/WalletPage'
import { AccountsPage } from '@/modules/wallet/AccountsPage'
import { Dashboard } from '@/modules/wallet/Dashboard'
import { CsvImport } from '@/modules/wallet/CsvImport'
import { UATPage } from '@/modules/uat/UATPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', element: <TasksPage /> },
      {
        path: 'wallet',
        element: <WalletLayout />,
        children: [
          { index: true, element: <WalletPage /> },
          { path: 'accounts', element: <AccountsPage /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'import', element: <CsvImport /> },
        ],
      },
      { path: 'uat', element: <UATPage /> },
    ],
  },
])
