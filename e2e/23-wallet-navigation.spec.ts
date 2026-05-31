import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

/**
 * Phase A — wallet navigation moved from a squeezed horizontal tab strip to a
 * grouped, collapsible "Wallet" section in the left Sidebar.
 */
test.describe('wallet left-panel navigation', () => {
  test('wallet section auto-expands on /wallet and shows grouped sub-links', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')

    // Group headers are present when the section is expanded.
    await expect(page.getByText('Daily', { exact: true })).toBeVisible()
    await expect(page.getByText('Planning', { exact: true })).toBeVisible()

    // All eight destinations are reachable as sidebar links.
    for (const name of [
      'Transactions',
      'Dashboard',
      'Accounts',
      'Budgets',
      'Goals',
      'Recurring',
      'Reports',
      'Import CSV',
    ]) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })

  test('sub-links navigate and the top bar reflects the active page', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')

    await page.getByRole('link', { name: 'Budgets', exact: true }).click()
    await expect(page).toHaveURL(/\/wallet\/budgets$/)
    await expect(page.getByRole('heading', { name: 'Budgets', level: 1 })).toBeVisible()

    await page.getByRole('link', { name: 'Reports', exact: true }).click()
    await expect(page).toHaveURL(/\/wallet\/reports$/)
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
  })

  test('the Wallet section can be collapsed and re-expanded', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    await expect(page.getByRole('link', { name: 'Budgets', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Collapse Wallet' }).click()
    await expect(page.getByRole('link', { name: 'Budgets', exact: true })).toBeHidden()

    await page.getByRole('button', { name: 'Expand Wallet' }).click()
    await expect(page.getByRole('link', { name: 'Budgets', exact: true })).toBeVisible()
  })
})
