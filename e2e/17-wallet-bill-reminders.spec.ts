/**
 * Wallet: bill reminders — Tier 3 feature.
 * Recurring bills due within N days surface as reminders on the dashboard.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

/** ISO date string N days from today */
function daysFromToday(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bill Account', type: 'bank' })

  // Create a recurring rule due in 3 days — should trigger a reminder
  await page.goto('/wallet/recurring')
  await page.getByRole('button', { name: /Add Recurring|New Rule/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('100')
  await dialog.locator('#account, [name="account"]').selectOption('Bill Account')
  await dialog.getByLabel(/Merchant|Description/i).first().fill('Electricity Bill')
  await dialog.locator('#frequency, [name="frequency"]').selectOption('monthly')
  await dialog.getByLabel(/Next due|Start date/i).fill(daysFromToday(3))
  await dialog.getByRole('button', { name: /Save|Create/i }).click()

  // Create a second rule due in 30 days — should NOT trigger a reminder (too far away)
  await page.getByRole('button', { name: /Add Recurring|New Rule/i }).click()
  const dialog2 = page.getByRole('dialog')
  await dialog2.getByLabel(/Amount/i).fill('200')
  await dialog2.locator('#account, [name="account"]').selectOption('Bill Account')
  await dialog2.getByLabel(/Merchant|Description/i).first().fill('Far Future Bill')
  await dialog2.locator('#frequency, [name="frequency"]').selectOption('monthly')
  await dialog2.getByLabel(/Next due|Start date/i).fill(daysFromToday(30))
  await dialog2.getByRole('button', { name: /Save|Create/i }).click()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Reminder appears on dashboard ─────────────────────────────────────

test('dashboard shows a bill reminder for a bill due within 7 days', async () => {
  await page.goto('/wallet/dashboard')
  await expect(
    page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' }),
  ).toBeVisible()
})

test('bill reminder shows a "due soon" message with the number of days', async () => {
  const reminder = page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' })
  await expect(reminder.getByText(/due in \d+ day|due soon/i)).toBeVisible()
})

test('bill reminder shows the amount owed', async () => {
  const reminder = page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' })
  await expect(reminder.getByText(/100/)).toBeVisible()
})

// ── Far-future bill is not shown ───────────────────────────────────────

test('bill due in 30 days does NOT appear as a reminder', async () => {
  await expect(
    page.getByTestId('bill-reminder').filter({ hasText: 'Far Future Bill' }),
  ).not.toBeVisible()
})

// ── Dismiss reminder ───────────────────────────────────────────────────

test('dismissing a bill reminder hides it from the dashboard', async () => {
  const reminder = page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' })
  await reminder.getByRole('button', { name: /Dismiss/i }).click()
  await expect(
    page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' }),
  ).not.toBeVisible()
})

test('dismissed reminder does not reappear on page reload', async () => {
  await page.reload()
  await page.waitForTimeout(500)
  await expect(
    page.getByTestId('bill-reminder').filter({ hasText: 'Electricity Bill' }),
  ).not.toBeVisible()
})
