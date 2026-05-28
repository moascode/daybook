/**
 * Wallet: goals & savings tracker — Tier 3 feature.
 * Set a target amount, link a dedicated account, track progress over time.
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
  await fillAccountForm(page, { name: 'Savings Account', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('wallet navigation contains a "Goals" link', async () => {
  await expect(page.getByRole('link', { name: 'Goals' })).toBeVisible()
})

test('navigating to /wallet/goals shows the Goals page', async () => {
  await page.goto('/wallet/goals')
  await expect(page).toHaveURL(/\/wallet\/goals$/)
  await expect(page.getByRole('heading', { name: /Goals/i })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no goals have been created', async () => {
  await expect(page.getByText(/No goals|Add your first goal/i)).toBeVisible()
})

// ── Create goal ────────────────────────────────────────────────────────

test('"Add Goal" button opens the goal form dialog', async () => {
  await page.getByRole('button', { name: /Add Goal|New Goal/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('goal form has Name, Target Amount, and linked Account fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Goal name|Name/i)).toBeVisible()
  await expect(dialog.getByLabel(/Target amount|Target/i)).toBeVisible()
  await expect(dialog.getByLabel(/Account/i)).toBeVisible()
})

test('save a goal: Emergency Fund, MYR 10 000, linked to Savings Account', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Goal name|Name/i).fill('Emergency Fund')
  await dialog.getByLabel(/Target amount|Target/i).fill('10000')
  await dialog.locator('#account, [name="account"]').selectOption('Savings Account')
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })).toBeVisible()
})

// ── Goal card display ──────────────────────────────────────────────────

test('goal card shows the goal name', async () => {
  await expect(page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })).toBeVisible()
})

test('goal card shows the target amount', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await expect(card.getByText(/10,000|10000/)).toBeVisible()
})

test('goal card shows a progress bar', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await expect(card.locator('[data-testid="goal-progress"]')).toBeVisible()
})

// ── Progress reflects linked account balance ───────────────────────────

test('goal progress increases after adding income to the linked account', async () => {
  // Add income to Savings Account to simulate saving towards the goal
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Income',
    amount: '2000',
    account: 'Savings Account',
    merchant: 'Salary',
  })
  await page.goto('/wallet/goals')
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  // 2000/10000 = 20% — the card should show some saved amount
  await expect(card.getByText(/2,000|2000|20%/)).toBeVisible()
})

// ── Edit goal ──────────────────────────────────────────────────────────

test('edit button opens the goal form pre-filled', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await card.getByRole('button', { name: /Edit/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Target amount|Target/i)).toHaveValue('10000')
})

test('updating the target amount saves the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Target amount|Target/i).fill('15000')
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await expect(card.getByText(/15,000|15000/)).toBeVisible()
})

// ── Delete goal ────────────────────────────────────────────────────────

test('delete button with confirmation removes the goal card', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await card.getByRole('button', { name: /Delete|Remove/i }).click()
  await page.getByRole('button', { name: /Confirm|Yes/i }).click()
  await expect(page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })).not.toBeVisible()
})
