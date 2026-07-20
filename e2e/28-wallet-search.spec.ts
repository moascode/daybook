/**
 * Wallet: free-text transaction search (Phase 5c B1).
 * The debounced search input writes filters.q, which the server matches
 * against merchant and description with LIKE. Typing a substring narrows
 * the list, clearing restores it, and search combines with other filters.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, transactionRowFor } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

/** Type into the search box and wait for the debounced, q-filtered fetch. */
async function search(query: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/transactions') &&
      r.url().includes(`q=${encodeURIComponent(query)}`),
  )
  await page.getByTestId('transaction-search').fill(query)
  await response
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Search Account', type: 'cash' })
  await page.goto('/wallet')
  // Clear date filters so all seeded transactions are visible
  await page.getByTestId('filter-clear-dates').click()

  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '18',
    account: 'Search Account',
    merchant: 'Grab Ride',
  })
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '12.50',
    account: 'Search Account',
    merchant: 'Starbucks Coffee',
  })
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Income',
    amount: '3000',
    account: 'Search Account',
    merchant: 'Starlight Studio',
    date: '2025-01-15',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

test('search input is visible in the filter bar', async () => {
  await expect(page.getByTestId('transaction-search')).toBeVisible()
})

test('typing a substring narrows the list to matching transactions', async () => {
  await search('Grab')
  await expect(transactionRowFor(page, 'Grab Ride')).toBeVisible()
  await expect(transactionRowFor(page, 'Starbucks Coffee')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Starlight Studio')).not.toBeVisible()
})

test('search matches the description field too', async () => {
  // Add a transaction whose match is in the description, not the merchant
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('7')
  await dialog.getByLabel('Merchant').fill('7-Eleven')
  await dialog.getByLabel('Description').fill('midnight snacks run')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(dialog).toBeHidden()

  await search('midnight')
  await expect(transactionRowFor(page, '7-Eleven')).toBeVisible()
  await expect(transactionRowFor(page, 'Grab Ride')).not.toBeVisible()
})

test('clearing the search restores the full list', async () => {
  await page.getByTestId('transaction-search').fill('')
  await expect(transactionRowFor(page, 'Grab Ride')).toBeVisible()
  await expect(transactionRowFor(page, 'Starbucks Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Starlight Studio')).toBeVisible()
})

test('search combines with the type filter', async () => {
  // "Star" matches both Starbucks (expense) and Starlight (income);
  // the income type filter should leave only Starlight visible.
  await search('Star')
  await expect(transactionRowFor(page, 'Starbucks Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Starlight Studio')).toBeVisible()

  // The Type filter lives in the collapsible Filters section
  await page.getByTestId('filter-toggle').click()
  await page.getByLabel('Type').selectOption('income')
  await expect(transactionRowFor(page, 'Starlight Studio')).toBeVisible()
  await expect(transactionRowFor(page, 'Starbucks Coffee')).not.toBeVisible()

  // Reset for later tests
  await page.getByLabel('Type').selectOption('all')
  await page.getByTestId('transaction-search').fill('')
})

test('search with no matches shows the empty-filter message', async () => {
  await search('zzz-no-such-merchant')
  await expect(page.getByText('No transactions match your current filters.')).toBeVisible()
  await page.getByTestId('transaction-search').fill('')
  await expect(transactionRowFor(page, 'Grab Ride')).toBeVisible()
})
