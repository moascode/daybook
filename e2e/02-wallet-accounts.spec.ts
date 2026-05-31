/**
 * Wallet — Accounts module end-to-end tests.
 * Tests account CRUD: create, view, edit, delete with cascade confirmation.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, accountCardFor, fillAccountForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('navigates to /wallet/accounts', async () => {
  await expect(page).toHaveURL(/\/wallet\/accounts$/)
})

test('wallet tab nav shows all four tabs', async () => {
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Accounts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Import CSV' })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no accounts exist', async () => {
  await expect(page.getByText('No accounts yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Account' }).first()).toBeVisible()
})

// ── Create account ────────────────────────────────────────────────────

test('open "New Account" modal via Add Account button', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New Account' })).toBeVisible()
})

test('modal has Account Name, Type, Icon, Color fields', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Account Name')).toBeVisible()
  await expect(dialog.getByLabel('Type')).toBeVisible()
  // Currency selector was removed — the app is single-currency (MYR).
  await expect(dialog.getByLabel('Currency')).toHaveCount(0)
  await expect(dialog.getByLabel('Icon')).toBeVisible()
})

test('cannot submit without account name — shows validation error', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create Account' }).click()
  await expect(dialog.getByText('Account name is required')).toBeVisible()
})

test('create first account: Maybank Savings (Bank, MYR)', async () => {
  await fillAccountForm(page, { name: 'Maybank Savings', type: 'bank' })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(accountCardFor(page, 'Maybank Savings')).toBeVisible()
})

test('empty state disappears after first account', async () => {
  await expect(page.getByText('No accounts yet')).not.toBeVisible()
})

test('account card shows name, type badge, currency and balance', async () => {
  const card = accountCardFor(page, 'Maybank Savings')
  await expect(card.getByText('Maybank Savings')).toBeVisible()
  await expect(card.getByText('Bank', { exact: true })).toBeVisible()
  await expect(card.getByText('MYR', { exact: true })).toBeVisible()
  // Balance starts at 0 — formatMYR uses 'ms-MY' locale which outputs "RM 0.00"
  await expect(card.getByText(/RM\s*0\.00/)).toBeVisible()
})

// ── Edit account ──────────────────────────────────────────────────────

test('open Edit Account modal via pencil icon', async () => {
  const card = accountCardFor(page, 'Maybank Savings')
  await card.hover()
  await card.getByRole('button', { name: 'Edit account' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Edit Account' })).toBeVisible()
})

test('edit modal is pre-filled with existing values', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Account Name')).toHaveValue('Maybank Savings')
})

test('update account name and save', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account Name').fill('Maybank Current')
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(accountCardFor(page, 'Maybank Current')).toBeVisible()
  await expect(accountCardFor(page, 'Maybank Savings')).not.toBeVisible()
})

// ── Second account ────────────────────────────────────────────────────

test('create second account: Cash Wallet (Cash, MYR)', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Cash Wallet', type: 'cash' })
  await expect(accountCardFor(page, 'Cash Wallet')).toBeVisible()
  await expect(page.locator('[data-testid="account-card"]')).toHaveCount(2)
})

test('create third account: Touch n Go eWallet (e-wallet)', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Touch n Go', type: 'e-wallet' })
  await expect(accountCardFor(page, 'Touch n Go')).toBeVisible()
  await expect(page.locator('[data-testid="account-card"]')).toHaveCount(3)
})

// ── Delete account ────────────────────────────────────────────────────

test('open delete confirmation dialog', async () => {
  const card = accountCardFor(page, 'Touch n Go')
  await card.hover()
  await card.getByRole('button', { name: 'Delete account' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Delete Account' })).toBeVisible()
  await expect(page.getByText(/Are you sure you want to delete "Touch n Go"/)).toBeVisible()
})

test('cancel delete keeps the account', async () => {
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(accountCardFor(page, 'Touch n Go')).toBeVisible()
})

test('confirm delete removes the account', async () => {
  const card = accountCardFor(page, 'Touch n Go')
  await card.hover()
  await card.getByRole('button', { name: 'Delete account' }).click()
  await page.getByRole('button', { name: 'Delete Account' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(accountCardFor(page, 'Touch n Go')).not.toBeVisible()
  await expect(page.locator('[data-testid="account-card"]')).toHaveCount(2)
})

// ── Navigate via sidebar Wallet link ──────────────────────────────────

test('sidebar Wallet link navigates to /wallet (transactions)', async () => {
  await page.getByRole('link', { name: 'Wallet' }).click()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.locator('main').getByRole('heading', { name: 'Transactions' })).toBeVisible()
})

test('Accounts tab from transaction page takes you back to accounts', async () => {
  await page.getByRole('link', { name: 'Accounts' }).click()
  await expect(page).toHaveURL(/\/wallet\/accounts$/)
  await expect(accountCardFor(page, 'Maybank Current')).toBeVisible()
})
