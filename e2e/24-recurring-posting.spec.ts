/**
 * Phase B — recurring rules now actually post transactions.
 *
 * Before this, a recurring rule was inert: it never created a transaction and
 * its due date never moved. These tests prove the two new behaviours:
 *   1. "Post now" posts one transaction immediately and advances the schedule.
 *   2. The process pass catches up every occurrence that is due on/before today.
 * Plus the form now captures Type and Category (previously missing).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, transactionRowFor } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Recurring Bank', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

async function openForm() {
  await page.goto('/wallet/recurring')
  await page.getByRole('button', { name: /Add Recurring|New Rule/i }).click()
  return page.getByRole('dialog')
}

test('recurring form now captures Type and Category', async () => {
  const dialog = await openForm()
  await expect(dialog.getByLabel(/^Type$/i)).toBeVisible()
  await expect(dialog.getByLabel(/^Category$/i)).toBeVisible()
  await dialog.getByRole('button', { name: /Cancel/i }).click()
})

test('"Post now" posts a transaction and advances the schedule one period', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/^Type$/i).selectOption('expense')
  await dialog.getByLabel(/Amount/i).fill('30')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('Spotify')
  await dialog.locator('#frequency').selectOption('monthly')
  await dialog.getByLabel(/Next due/i).fill('2026-12-01')
  await dialog.getByRole('button', { name: /Create/i }).click()

  const row = page.getByTestId('recurring-row').filter({ hasText: 'Spotify' })
  await expect(row).toBeVisible()
  await expect(row.getByText(/Dec 2026/)).toBeVisible()

  // Post it now → schedule moves forward one month, a transaction is created.
  await row.getByRole('button', { name: 'Post now' }).click()
  await expect(row.getByText(/Jan 2027/)).toBeVisible()

  // The posted transaction (dated today) shows in the current-month list.
  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Spotify')).toBeVisible()
})

test('processing catches up every occurrence due on/before today', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('99')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('OldBill')
  await dialog.locator('#frequency').selectOption('monthly')
  // Well in the past so several occurrences are overdue.
  await dialog.getByLabel(/Next due/i).fill('2026-01-01')
  await dialog.getByRole('button', { name: /Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'OldBill' })).toBeVisible()

  // Run the same catch-up pass the app fires on boot.
  const res = await page.request.post(
    'http://localhost:5173/api/recurring-transactions/process',
  )
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.posted).toBeGreaterThan(0)

  // The back-dated occurrences now exist as real transactions.
  await page.goto('/wallet')
  await page.getByLabel('From').fill('')
  await page.getByLabel('To').fill('')
  await expect(transactionRowFor(page, 'OldBill').first()).toBeVisible()
})
