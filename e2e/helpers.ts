import type { Page, Browser } from '@playwright/test'
import { expect } from '@playwright/test'

/** Wait for the app shell to confirm the app has mounted */
export async function waitForApp(page: Page) {
  // On desktop the sidebar aside is visible; on mobile the main element is visible.
  // We check for the main content area which is always present in both viewports.
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
}

/**
 * Create an isolated browser context and navigate to the app.
 *
 * Phase 4: data now lives in the shared server SQLite file rather than per-browser
 * IndexedDB, so we reset the server DB before loading the app. This gives each
 * page the clean slate it had under the old fresh-IndexedDB-per-context model.
 */
export async function newAppPage(browser: Browser, path = '/') {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.request.post('http://localhost:5173/api/test/reset')
  await page.goto(path)
  await waitForApp(page)
  return page
}

/** Hover a bullet node to reveal its hidden actions, then click the note (sticky) icon */
export async function toggleNoteOnTask(page: Page, taskContent: string) {
  const node = bulletNodeFor(page, taskContent)
  await node.hover()
  // Title switches between "Add note", "Show note", and "Hide note"
  await node.locator('button[title="Add note"], button[title="Show note"], button[title="Hide note"]').first().click()
}

/** Hover a bullet node and open its ⋯ dropdown */
export async function openTaskMenu(page: Page, taskContent: string) {
  const node = bulletNodeFor(page, taskContent)
  await node.hover()
  await node.getByRole('button', { name: 'Task options' }).click()
}

/** Return a locator scoped to the bullet node that contains taskContent */
export function bulletNodeFor(page: Page, taskContent: string) {
  return page.locator('[data-testid="bullet-node"]').filter({
    has: page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: taskContent }),
  })
}

/** Return a locator scoped to the account card with the given account name */
export function accountCardFor(page: Page, accountName: string) {
  return page.locator('[data-testid="account-card"]').filter({ hasText: accountName })
}

/** Return a locator scoped to the transaction row that contains the given merchant text */
export function transactionRowFor(page: Page, merchant: string) {
  return page.locator('[data-testid="transaction-row"]').filter({ hasText: merchant })
}

/** Fill the AccountForm modal and submit it */
export async function fillAccountForm(
  page: Page,
  fields: { name: string; type?: string; currency?: string },
) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account Name').fill(fields.name)
  if (fields.type) await dialog.getByLabel('Type').selectOption(fields.type)
  if (fields.currency) {
    await dialog.getByLabel('Currency').fill('')
    await dialog.getByLabel('Currency').fill(fields.currency)
  }
  await dialog.getByRole('button', { name: /Create Account|Save Changes/ }).click()
  await expect(dialog).toBeHidden()
}

/** Fill the TransactionForm modal and submit it */
export async function fillTransactionForm(
  page: Page,
  fields: {
    type?: 'Expense' | 'Income' | 'Transfer'
    amount: string
    account?: string
    toAccount?: string
    merchant?: string
    date?: string
    category?: string
    tag?: string
  },
) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (fields.type) await dialog.getByRole('button', { name: fields.type }).click()
  if (fields.date) await dialog.getByLabel('Date').fill(fields.date)
  await dialog.getByLabel('Amount').fill(fields.amount)
  if (fields.account) {
    // WalletPage filter bar and TransactionForm share select id="account"/"from-account".
    // Use ID selector scoped to dialog to avoid getByLabel resolving to the filter bar.
    const accountId = fields.type === 'Transfer' ? 'from-account' : 'account'
    await dialog.locator(`#${accountId}`).selectOption(fields.account)
  }
  if (fields.toAccount) await dialog.locator('#to-account').selectOption(fields.toAccount)
  if (fields.merchant) await dialog.getByLabel('Merchant').fill(fields.merchant)
  if (fields.category) await dialog.locator('#category').selectOption(fields.category)
  if (fields.tag) await dialog.locator('#tag').fill(fields.tag)
  await dialog.getByRole('button', { name: /Add Transaction|Save Changes/ }).click()
  await expect(dialog).toBeHidden()
}
