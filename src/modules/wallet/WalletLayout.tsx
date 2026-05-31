import { Outlet } from 'react-router-dom'

/**
 * Shared layout wrapper for all /wallet/* routes.
 *
 * Wallet navigation now lives in the left Sidebar (a grouped, expandable
 * "Wallet" section), so this layout simply renders the active sub-page.
 * AppShell's <main> already supplies page padding.
 */
export function WalletLayout() {
  return <Outlet />
}
