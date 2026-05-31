/**
 * Wallet: budget tracking — Tier 2 feature.
 * Set monthly spend limits per category; view progress bars; get over-budget alerts.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Budget Bank', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('wallet navigation contains a "Budgets" link', async () => {
  await expect(page.getByRole('link', { name: 'Budgets' })).toBeVisible()
})

test('navigating to /wallet/budgets shows the Budgets page', async () => {
  await page.goto('/wallet/budgets')
  await expect(page).toHaveURL(/\/wallet\/budgets$/)
  await expect(page.locator('main').getByRole('heading', { name: /Budgets/i })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no budgets have been set', async () => {
  await expect(page.getByText(/No budgets|Set your first budget/i)).toBeVisible()
})

// ── Create budget ──────────────────────────────────────────────────────

test('"Add Budget" button opens the budget form dialog', async () => {
  await page.getByRole('button', { name: /Add Budget|New Budget/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('budget form has Category, Amount/Limit, and Period fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Category/i)).toBeVisible()
  await expect(dialog.getByLabel(/Amount|Limit/i)).toBeVisible()
  await expect(dialog.getByLabel(/Period|Month/i)).toBeVisible()
})

test('save a budget: Food & Drink at MYR 500/month', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.locator('#budget-category, [name="category"]').selectOption('Food & Drink')
  await dialog.getByLabel(/Amount|Limit/i).fill('500')
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })).toBeVisible()
})

// ── Budget row display ─────────────────────────────────────────────────

test('budget row shows category name and monthly limit amount', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.getByText(/500|MYR 500/)).toBeVisible()
})

test('budget row contains a progress bar element', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.locator('[data-testid="budget-progress"]')).toBeVisible()
})

// ── Progress reflects actual spending ─────────────────────────────────

test('budget progress updates after adding a Food & Drink expense', async () => {
  // Add a transaction in the current month
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '120',
    account: 'Budget Bank',
    merchant: 'Mamak',
    category: 'Food & Drink',
  })
  await page.goto('/wallet/budgets')
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  // Spent amount should appear (120 out of 500)
  await expect(row.getByText(/120|RM 120/)).toBeVisible()
})

// ── Over-budget alert ──────────────────────────────────────────────────

test('over-budget alert appears when spending exceeds the limit', async () => {
  // Spend an additional 450 to exceed the 500 limit
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '450',
    account: 'Budget Bank',
    merchant: 'Supermarket',
    category: 'Food & Drink',
  })
  await page.goto('/wallet/budgets')
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.locator('[data-testid="over-budget-alert"]')).toBeVisible()
})

// ── Edit budget ────────────────────────────────────────────────────────

test('edit button opens the budget form pre-filled', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await row.getByRole('button', { name: /Edit/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount|Limit/i)).toHaveValue('500')
})

test('updating the limit saves the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount|Limit/i).fill('800')
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.getByText(/800|MYR 800/)).toBeVisible()
  // Over-budget alert should be gone now (spent 570 < 800)
  await expect(row.locator('[data-testid="over-budget-alert"]')).not.toBeVisible()
})

// ── Delete budget ──────────────────────────────────────────────────────

test('delete button with confirmation removes the budget row', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await row.getByRole('button', { name: /Delete|Remove/i }).click()
  await page.getByRole('button', { name: /Confirm|Yes/i }).click()
  await expect(page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })).not.toBeVisible()
})
