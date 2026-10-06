/**
 * Wallet: goals & savings tracker — Tier 3 feature.
 * Set a target amount, link a dedicated account, track progress over time.
 *
 * Updated for FEAT-067 (docs/backlog/EP-06-wallet-depth/FEAT-067-goals-design-adoption.md):
 * exact mock parity — ring cards, a ⋯ actions menu replacing the old inline
 * Edit/Delete icons, "New goal" replacing "Add Goal", and the Target
 * date/Note fields on the goal form. The funding-rate/ETA/status/trajectory/
 * milestone math this revision absorbed from FEAT-019 gets its own coverage
 * in e2e/102-goals-trajectory.spec.ts — this file stays focused on basic
 * CRUD and the ⋯ menu contract.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, navItem, openBlankTransactionForm } from './helpers'

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
  await expect(navItem(page, 'goals')).toBeVisible()
})

test('navigating to /wallet/goals shows the Goals page', async () => {
  await page.goto('/wallet/goals')
  await expect(page).toHaveURL(/\/wallet\/goals$/)
  await expect(page.locator('main').getByRole('heading', { name: 'Goals', exact: true })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no goals have been created', async () => {
  await expect(page.getByRole('heading', { name: 'No goals yet' })).toBeVisible()
})

// ── Create goal ────────────────────────────────────────────────────────

test('"New goal" button opens the goal form dialog', async () => {
  await page.getByRole('button', { name: 'New goal' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('goal form has Goal name, Target amount, and linked Account fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Goal name')).toBeVisible()
  await expect(dialog.getByLabel('Target amount')).toBeVisible()
  await expect(dialog.getByLabel('Account')).toBeVisible()
})

test('save a goal: Emergency Fund, MYR 10 000, linked to Savings Account', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Goal name').fill('Emergency Fund')
  await dialog.getByLabel('Target amount').fill('10000')
  await dialog.getByLabel('Account').selectOption('Savings Account')
  await dialog.getByRole('button', { name: 'Create Goal' }).click()
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

test('goal card shows a progress ring', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await expect(card.locator('[data-testid="goal-progress"]')).toBeVisible()
  await expect(card.locator('[data-testid="goal-progress"]')).toContainText('%')
})

// ── Progress reflects linked account balance ───────────────────────────

test('goal progress increases after adding income to the linked account', async () => {
  // Add income to Savings Account to simulate saving towards the goal
  await page.goto('/wallet')
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Income',
    amount: '2000',
    account: 'Savings Account',
    merchant: 'Salary',
  })
  await page.goto('/wallet/goals')
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  // 2000/10000 = 20% — the card should show some saved amount
  await expect(card.getByText(/2,000|2000|20%/).first()).toBeVisible()
})

// ── Edit goal via the ⋯ menu ────────────────────────────────────────────

test('the ⋯ menu opens with Edit and Delete items', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await card.getByRole('button', { name: 'More actions for Emergency Fund' }).click()
  await expect(page.getByRole('menuitem', { name: 'Edit Emergency Fund' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete Emergency Fund' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('"Edit" opens the goal form pre-filled', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await card.getByRole('button', { name: 'More actions for Emergency Fund' }).click()
  await page.getByRole('menuitem', { name: 'Edit Emergency Fund' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Target amount')).toHaveValue('10000')
})

test('updating the target amount saves the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Target amount').fill('15000')
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await expect(card.getByText(/15,000|15000/)).toBeVisible()
})

// ── Delete goal via the ⋯ menu, through ConfirmDeleteModal ──────────────

test('"Delete" opens a confirmation modal, and confirming removes the goal card', async () => {
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })
  await card.getByRole('button', { name: 'More actions for Emergency Fund' }).click()
  await page.getByRole('menuitem', { name: 'Delete Emergency Fund' }).click()

  const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Emergency Fund' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: /Delete/i }).click()

  await expect(page.getByTestId('goal-card').filter({ hasText: 'Emergency Fund' })).not.toBeVisible()
})
