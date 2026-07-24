/**
 * Wave F2 / U-10 — active-filter chips.
 * An applied "occasional" filter (account/category/type/tag/view) lives in the
 * collapsed Filters panel; a removable chip surfaces it so a narrowed list is
 * never silently unexplained, and can be cleared one filter at a time.
 */
import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Chip Account', type: 'cash' })
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '10',
    account: 'Chip Account',
    merchant: 'Chip Coffee',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

test('applying an account filter shows a removable chip', async () => {
  await page.getByTestId('filter-toggle').click()
  await expect(page.getByTestId('filter-panel')).toBeVisible()
  await page.getByTestId('filter-panel').getByLabel('Account').selectOption('Chip Account')

  const chips = page.getByTestId('active-filter-chips')
  await expect(chips).toBeVisible()
  await expect(chips.getByText('Account: Chip Account')).toBeVisible()
})

test('clicking the chip × clears just that filter', async () => {
  // The × button has a generic accessible name ("Remove filter") to avoid
  // colliding with the filter-panel field labels, so scope to the chip by text.
  await page
    .getByTestId('active-filter-chips')
    .locator('span', { hasText: 'Account: Chip Account' })
    .getByRole('button', { name: 'Remove filter' })
    .click()

  // Chip row gone (no other filters active) and the Account select back to "all".
  await expect(page.getByTestId('active-filter-chips')).toHaveCount(0)
  await expect(page.getByTestId('filter-panel').getByLabel('Account')).toHaveValue('')
})

test('a ?account= deep-link auto-opens Filters and shows the chip', async () => {
  // Grab the account id from the API, then deep-link into the transactions list.
  const accounts = await page.request.get('http://localhost:5173/api/accounts')
  const chipAccount = (await accounts.json()).find(
    (a: { id: string; name: string }) => a.name === 'Chip Account',
  )
  await page.goto(`/wallet?account=${chipAccount.id}`)
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })

  // Panel is auto-expanded and the chip is visible.
  await expect(page.getByTestId('filter-panel')).toBeVisible()
  await expect(
    page.getByTestId('active-filter-chips').getByText('Account: Chip Account'),
  ).toBeVisible()
})
