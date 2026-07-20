/**
 * Wallet: §6.4 filter-bar reorganisation.
 * The Transactions bar is a single search-first row: search input, a segmented
 * date-range control that always shows its active value, a Filters toggle with
 * an active-count badge, and a Clear button that only appears when something
 * is active. The occasional filters (Type/Account/Category/Tags + the Sharing
 * view for group members) live in a collapsible section; category management
 * is reachable from the Category dropdown's footer option.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, transactionRowFor } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bar Account', type: 'cash' })
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '20',
    account: 'Bar Account',
    merchant: 'Bar Cafe',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Date-range control active state ─────────────────────────────────────

test('the default "This month" range is shown as active', async () => {
  await expect(page.getByTestId('filter-this-month')).toHaveClass(/bg-brand/)
  await expect(page.getByTestId('filter-last-month')).not.toHaveClass(/bg-brand/)
})

test('selecting another range moves the active state', async () => {
  await page.getByTestId('filter-clear-dates').click()
  await expect(page.getByTestId('filter-clear-dates')).toHaveClass(/bg-brand/)
  await expect(page.getByTestId('filter-this-month')).not.toHaveClass(/bg-brand/)
})

test('"Custom…" reveals From/To pre-filled with the current range', async () => {
  await page.getByTestId('filter-this-month').click()
  await page.getByTestId('filter-custom-range').click()
  await expect(page.getByTestId('filter-custom-range')).toHaveClass(/bg-brand/)
  // Custom does not change the range — the editors show this month's bounds
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  await expect(page.getByLabel('From')).toHaveValue(firstDay)
  // Picking a preset closes the editors again
  await page.getByTestId('filter-this-month').click()
  await expect(page.getByLabel('From')).toHaveCount(0)
})

// ── Filters toggle + active-count badge ────────────────────────────────

test('the Filters section is collapsed by default and opens on toggle', async () => {
  await expect(page.getByTestId('filter-panel')).toHaveCount(0)
  await page.getByTestId('filter-toggle').click()
  await expect(page.getByTestId('filter-panel')).toBeVisible()
  await expect(page.getByLabel('Type')).toBeVisible()
})

test('active filters are counted on the Filters badge', async () => {
  await expect(page.getByTestId('filter-count')).toHaveCount(0)
  await page.getByLabel('Type').selectOption('expense')
  await expect(page.getByTestId('filter-count')).toHaveText('1')
  await page.getByLabel('Account').selectOption('Bar Account')
  await expect(page.getByTestId('filter-count')).toHaveText('2')
})

test('the badge persists when the section is collapsed', async () => {
  await page.getByTestId('filter-toggle').click()
  await expect(page.getByTestId('filter-panel')).toHaveCount(0)
  await expect(page.getByTestId('filter-count')).toHaveText('2')
})

// ── Clear-all ──────────────────────────────────────────────────────────

test('Clear resets every filter and disappears when nothing is active', async () => {
  await page.getByTestId('transaction-search').fill('Cafe')
  await expect(page.getByTestId('filter-clear-all')).toBeVisible()
  await page.getByTestId('filter-clear-all').click()

  // Defaults restored: no badge, search empty, This month active again
  await expect(page.getByTestId('filter-count')).toHaveCount(0)
  await expect(page.getByTestId('transaction-search')).toHaveValue('')
  await expect(page.getByTestId('filter-this-month')).toHaveClass(/bg-brand/)
  await expect(page.getByTestId('filter-clear-all')).toHaveCount(0)
  await expect(transactionRowFor(page, 'Bar Cafe')).toBeVisible()
})

// ── Manage categories from the Category dropdown ───────────────────────

test('the Category dropdown footer option opens the category manager', async () => {
  await page.getByTestId('filter-toggle').click()
  await page.getByLabel('Category').selectOption('__manage__')
  await expect(page.getByRole('heading', { name: 'Manage Categories' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  // The active category filter is unchanged (still All Categories)
  await expect(page.getByLabel('Category')).toHaveValue('')
  await expect(page.getByTestId('filter-count')).toHaveCount(0)
})

// ── Sharing view visibility ────────────────────────────────────────────

test('the Sharing view filter is hidden for users with no groups', async () => {
  await expect(page.getByTestId('filter-panel')).toBeVisible()
  await expect(page.getByText('Sharing', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Shared with me' })).toHaveCount(0)
})

test('group members get the Sharing view filter and ?view= deep links still land', async () => {
  await page.goto('/settings/sharing')
  await page.getByRole('button', { name: 'New Group' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Bar Group')
  await page.getByRole('button', { name: 'Create Group' }).click()
  await expect(page.getByRole('heading', { name: 'Bar Group' })).toBeVisible()

  // Deep link from the Shared page keeps working even though the pills moved
  await page.goto('/wallet?view=shared-with-me')
  await page.getByTestId('filter-toggle').click()
  await expect(page.getByText('Sharing', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Shared with me' })).toHaveClass(/border-brand/)
  // The deep-linked view counts as an active filter on the badge
  await expect(page.getByTestId('filter-count')).toHaveText('1')

  // Back to All clears it
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByTestId('filter-count')).toHaveCount(0)
})
