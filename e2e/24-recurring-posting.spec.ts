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

test('"Post now" on a not-yet-due rule posts a transaction but does NOT advance the schedule', async () => {
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

  // Posting early must not consume the upcoming scheduled occurrence: the
  // schedule stays at Dec 2026, but a transaction is created today.
  await row.getByRole('button', { name: 'Post now' }).click()
  await expect(row.getByText(/Dec 2026/)).toBeVisible()

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Spotify')).toBeVisible()
})

test('"Post now" on a due rule advances the schedule one period', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('12')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('DueBill')
  await dialog.locator('#frequency').selectOption('monthly')
  // Already due (in the past), so posting advances one month: Jan → Feb 2026.
  await dialog.getByLabel(/Next due/i).fill('2026-01-01')
  await dialog.getByRole('button', { name: /Create/i }).click()

  const row = page.getByTestId('recurring-row').filter({ hasText: 'DueBill' })
  await expect(row.getByText(/Jan 2026/)).toBeVisible()
  await row.getByRole('button', { name: 'Post now' }).click()
  await expect(row.getByText(/Feb 2026/)).toBeVisible()
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

test('boot processing posts due rules and surfaces a toast', async () => {
  const dialog = await openForm()
  await dialog.getByLabel(/Amount/i).fill('7')
  await dialog.locator('#account').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant/i).fill('BootBill')
  await dialog.locator('#frequency').selectOption('monthly')
  await dialog.getByLabel(/Next due/i).fill('2026-02-01')
  await dialog.getByRole('button', { name: /Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'BootBill' })).toBeVisible()

  // Reload → App fires the catch-up pass on boot, which posts the due rule and
  // tells the user (rather than silently changing balances).
  await page.reload()
  await expect(page.getByText(/Posted \d+ due recurring transaction/i)).toBeVisible({
    timeout: 12_000,
  })
})

test('the API rejects a transfer-type or invalid-frequency recurring rule', async () => {
  const accounts = await (
    await page.request.get('http://localhost:5173/api/accounts')
  ).json()
  const accountId = accounts[0].id

  const transferRule = await page.request.post(
    'http://localhost:5173/api/recurring-transactions',
    { data: { accountId, amount: 10, merchant: 'Bad', type: 'transfer', frequency: 'monthly', nextDueDate: '2026-06-01' } },
  )
  expect(transferRule.status()).toBe(400)

  const badFreq = await page.request.post(
    'http://localhost:5173/api/recurring-transactions',
    { data: { accountId, amount: 10, merchant: 'Bad', type: 'expense', frequency: 'yearly', nextDueDate: '2026-06-01' } },
  )
  expect(badFreq.status()).toBe(400)
})
