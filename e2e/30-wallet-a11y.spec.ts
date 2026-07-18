/**
 * Wallet: keyboard & screen-reader accessibility — Phase 5c Wave 2 (B3/B4/B6).
 *
 * - Transaction rows and account cards are real keyboard targets:
 *   role="button", tabIndex=0, Enter/Space activate them (B4).
 * - Account card actions are visible without hover (B6).
 * - The account edit modal (with the 5b sharing section open) fits within the
 *   default 1280×720 viewport — regression for the spec-24 clipping bug (B3).
 */

import { test, expect } from '@playwright/test'
import {
  newAppPage,
  waitForApp,
  fillAccountForm,
  fillTransactionForm,
  accountCardFor,
  transactionRowFor,
} from './helpers'

test('transaction row is keyboard-accessible: focus, Enter and Space open the editor', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Cash' })

  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { amount: '12.50', merchant: 'Kopitiam' })

  const row = transactionRowFor(page, 'Kopitiam')
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('role', 'button')
  await expect(row).toHaveAttribute('tabindex', '0')

  // Enter opens the edit form
  await row.focus()
  await expect(row).toBeFocused()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save Changes' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // Space opens it too
  await row.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('account card is keyboard-accessible: Enter navigates to its transactions', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bank' })

  const card = accountCardFor(page, 'Bank')
  await expect(card).toHaveAttribute('role', 'button')
  await expect(card).toHaveAttribute('tabindex', '0')
  await card.focus()
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/wallet\?account=/)
})

test('account card actions are visible without hover', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Touch Cash' })

  const editBtn = accountCardFor(page, 'Touch Cash').getByRole('button', { name: 'Edit account' })
  await expect(editBtn).toBeVisible()
  // Playwright treats opacity-0 elements as "visible", so assert the effective
  // (inherited) opacity — 1 means the old opacity-0 group-hover pattern is gone.
  const effectiveOpacity = await editBtn.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement
    let opacity = 1
    while (node) {
      opacity *= parseFloat(getComputedStyle(node).opacity)
      node = node.parentElement
    }
    return opacity
  })
  expect(effectiveOpacity).toBe(1)
})

test('account edit modal with sharing section fits within the 1280×720 viewport', async ({ browser }) => {
  // Regression for the spec-24 clipping failure: with a household group, the
  // edit-account modal grows a Sharing section and used to overflow 720 px.
  const page = await newAppPage(browser, '/household')
  await page.getByRole('button', { name: 'New Group' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Family')
  await page.getByRole('button', { name: 'Create Group' }).click()
  await expect(page.getByRole('heading', { name: 'Family' })).toBeVisible()

  await page.goto('/wallet/accounts')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Shared Cash' })

  await accountCardFor(page, 'Shared Cash').getByRole('button', { name: 'Edit account' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Sharing', { exact: true })).toBeVisible()

  const viewport = page.viewportSize()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)

  // Bottom of the form stays reachable by scrolling inside the dialog
  const save = dialog.getByRole('button', { name: 'Save Changes' })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
