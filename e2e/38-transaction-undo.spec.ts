/**
 * Wallet — single-transaction delete undo (feature-consistency §2.7).
 * Deleting one transaction removes it immediately (no confirm dialog) and shows
 * a 5-second undo toast; clicking Undo restores the row.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import { newAppPage, transactionRowFor, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Undo Account', type: 'bank' })

  await page.goto('/wallet')
  await expect(page.locator('main')).toBeVisible()
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { amount: '42', merchant: 'Kopitiam' })
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

test('deleting a transaction removes it immediately with no confirm dialog', async () => {
  const row = transactionRowFor(page, 'Kopitiam')
  await row.hover()
  await row.getByRole('button', { name: 'Delete transaction' }).click()
  // No confirm dialog appears.
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Kopitiam')).not.toBeVisible()
})

test('an undo toast appears after deletion', async () => {
  await expect(page.getByTestId('toast')).toBeVisible()
  await expect(page.getByText('Transaction deleted')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
})

test('clicking Undo restores the deleted transaction', async () => {
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible({ timeout: 5000 })
})

test('restored transaction is counted in the summary again', async () => {
  // Expense of 42 is back, so the expense summary reflects it.
  await expect(page.getByText(/RM\s42\.00/).first()).toBeVisible()
})
