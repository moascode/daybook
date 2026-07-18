/**
 * Wallet: recurring transactions — Tier 2 feature.
 * Define weekly/monthly schedules; view upcoming entries; edit and delete rules.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm } from './helpers'

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

// ── Navigation ─────────────────────────────────────────────────────────

test('wallet navigation contains a "Recurring" link', async () => {
  await expect(page.getByRole('link', { name: /Recurring/i })).toBeVisible()
})

test('navigating to /wallet/recurring shows the Recurring page', async () => {
  await page.goto('/wallet/recurring')
  await expect(page).toHaveURL(/\/wallet\/recurring$/)
  await expect(page.locator('main').getByRole('heading', { name: /Recurring/i })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no recurring rules exist', async () => {
  await expect(page.getByText(/No recurring transactions|Add your first recurring/i)).toBeVisible()
})

// ── Create monthly rule ────────────────────────────────────────────────

test('"Add Recurring" button opens the form dialog', async () => {
  await page.getByRole('button', { name: /Add Recurring|New Rule/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('recurring form has Amount, Account, Merchant, Frequency, and Next-due fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount/i)).toBeVisible()
  await expect(dialog.getByLabel(/Account/i)).toBeVisible()
  await expect(dialog.getByLabel(/Merchant|Description/i).first()).toBeVisible()
  await expect(dialog.getByLabel(/Frequency|Repeats/i)).toBeVisible()
  await expect(dialog.getByLabel(/Next due|Start date/i)).toBeVisible()
})

test('save a monthly recurring expense (Netflix, MYR 55)', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('55')
  await dialog.locator('#account, [name="account"]').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant|Description/i).first().fill('Netflix')
  await dialog.locator('#frequency, [name="frequency"]').selectOption('monthly')
  await dialog.getByLabel(/Next due|Start date/i).fill('2026-06-01')
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })).toBeVisible()
})

// ── Row display ────────────────────────────────────────────────────────

test('recurring row shows the frequency and next-due date', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/Monthly/i)).toBeVisible()
  await expect(row.getByText(/Jun 2026|2026-06-01|01 Jun 2026/)).toBeVisible()
})

test('recurring row shows the amount', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/55/)).toBeVisible()
})

// ── Create weekly rule ─────────────────────────────────────────────────

test('save a weekly recurring expense (Coffee Weekly, MYR 20)', async () => {
  await page.getByRole('button', { name: /Add Recurring|New Rule/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('20')
  await dialog.locator('#account, [name="account"]').selectOption('Recurring Bank')
  await dialog.getByLabel(/Merchant|Description/i).first().fill('Coffee Weekly')
  await dialog.locator('#frequency, [name="frequency"]').selectOption('weekly')
  await dialog.getByLabel(/Next due|Start date/i).fill('2026-06-07')
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })).toBeVisible()
})

test('weekly rule row shows "Weekly" frequency', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })
  await expect(row.getByText('Weekly', { exact: true })).toBeVisible()
})

// ── Type badge & category chip at rest (Phase 5c B10) ──────────────────

test('rule card shows its type badge without opening the editor', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText('Expense', { exact: true })).toBeVisible()
})

test('rule card shows its category as a chip once one is set', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await row.getByRole('button', { name: /Edit/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#category').selectOption({ label: 'Entertainment' })
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  await expect(row.getByText('Entertainment', { exact: true })).toBeVisible()
})

// ── Edit rule ──────────────────────────────────────────────────────────

test('edit button pre-fills the form with existing values', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await row.getByRole('button', { name: /Edit/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount/i)).toHaveValue('55')
})

test('updating amount and saving reflects the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/i).fill('60')
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
  await expect(row.getByText(/60/)).toBeVisible()
})

// ── Delete rule ────────────────────────────────────────────────────────

test('delete button with confirmation removes the recurring rule', async () => {
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })
  await row.getByRole('button', { name: /Delete|Remove/i }).click()
  await page.getByRole('button', { name: /Confirm|Yes/i }).click()
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Coffee Weekly' })).not.toBeVisible()
})

test('Netflix rule is still present after deleting Coffee Weekly', async () => {
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Netflix' })).toBeVisible()
})
