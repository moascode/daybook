/**
 * Wallet: "Save & Add Another" on the transaction form (Phase 5c B2).
 * The button submits the transaction, keeps the modal open with date,
 * account, and type retained, clears amount/merchant/description, and
 * refocuses the Amount field for rapid consecutive entry.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, transactionRowFor } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Daily Account', type: 'cash' })
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Side Account', type: 'bank' })
  await page.goto('/wallet')
  await page.getByLabel('From').fill('')
  await page.getByLabel('To').fill('')
})

test.afterAll(async () => {
  await page.context().close()
})

test('Save & Add Another keeps the modal open and retains date, account, and type', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Non-default values so retention is observable
  await dialog.getByRole('button', { name: 'Income' }).click()
  await dialog.getByLabel('Date').fill('2025-03-15')
  await dialog.getByLabel('Amount').fill('50')
  await dialog.locator('#account').selectOption('Side Account')
  await dialog.getByLabel('Merchant').fill('First Entry')
  await dialog.getByLabel('Description').fill('first of a batch')

  await dialog.getByTestId('save-add-another').click()

  // Modal stays open; per-item fields cleared, sticky fields retained
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Amount')).toHaveValue('')
  await expect(dialog.getByLabel('Merchant')).toHaveValue('')
  await expect(dialog.getByLabel('Description')).toHaveValue('')
  await expect(dialog.getByLabel('Date')).toHaveValue('2025-03-15')
  await expect(dialog.locator('#account')).toHaveValue(
    await dialog.locator('#account option', { hasText: 'Side Account' }).getAttribute('value') ?? '',
  )
})

test('Amount field is focused for the next entry', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Amount')).toBeFocused()
})

test('second entry submits with the retained date, account, and type', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('75')
  await dialog.getByLabel('Merchant').fill('Second Entry')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(dialog).toBeHidden()

  // Both entries exist
  await expect(transactionRowFor(page, 'First Entry')).toBeVisible()
  await expect(transactionRowFor(page, 'Second Entry')).toBeVisible()

  // Retained type (income → "+" prefixed amount) and account on the second entry
  const secondRow = transactionRowFor(page, 'Second Entry')
  await expect(secondRow.getByText('Side Account')).toBeVisible()
  await expect(secondRow.getByText(/\+\s*RM\s*75/)).toBeVisible()
})

test('Save & Add Another is not shown when editing an existing transaction', async () => {
  await transactionRowFor(page, 'First Entry').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible()
  await expect(dialog.getByTestId('save-add-another')).not.toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('Save & Add Another validates before submitting (no silent empty save)', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Amount left at 0 → validation error, nothing saved, modal stays open
  await dialog.getByTestId('save-add-another').click()
  await expect(dialog.getByText('Amount must be greater than 0')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
