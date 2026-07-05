/**
 * Wallet: data export — Tier 2 feature.
 * Export respects active filters and provides multiselect to include/exclude
 * individual transactions before downloading.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Export Account', type: 'cash' })
  await page.goto('/wallet')
  // Clear date filters so our dated transactions are always visible
  await page.getByLabel('From').fill('')
  await page.getByLabel('To').fill('')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '25',
    account: 'Export Account',
    merchant: 'Test Merchant',
    tags: ['groceries'],
  })
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Income',
    amount: '100',
    account: 'Export Account',
    merchant: 'Income Source',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Export button visible ──────────────────────────────────────────────

test('Export button is visible on the wallet transactions page', async () => {
  await page.goto('/wallet')
  await page.getByLabel('From').fill('')
  await page.getByLabel('To').fill('')
  await expect(page.getByRole('button', { name: /Export/i })).toBeVisible()
})

// ── Export modal opens ─────────────────────────────────────────────────

test('clicking Export opens the export modal dialog', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Export Transactions' })).toBeVisible()
})

test('export modal lists the current filtered transactions with checkboxes', async () => {
  const list = page.getByTestId('export-transaction-list')
  await expect(list).toBeVisible()
  // Both transactions should appear
  await expect(list.getByText('Test Merchant')).toBeVisible()
  await expect(list.getByText('Income Source')).toBeVisible()
})

test('all transactions are checked by default', async () => {
  // The select-all checkbox should be checked
  await expect(page.getByTestId('export-select-all')).toBeChecked()
  // Each row's checkbox should also be checked
  const checkboxes = page.getByTestId('export-transaction-row').locator('input[type="checkbox"]')
  const count = await checkboxes.count()
  for (let i = 0; i < count; i++) {
    await expect(checkboxes.nth(i)).toBeChecked()
  }
})

test('unchecking a transaction excludes it from the selection count', async () => {
  // Uncheck "Income Source"
  const incomeRow = page.getByTestId('export-transaction-row').filter({ hasText: 'Income Source' })
  await incomeRow.locator('input[type="checkbox"]').uncheck()
  // Count label should update — "1 of 2 selected"
  await expect(page.getByText(/1 of 2 selected/)).toBeVisible()
  // Select-all should no longer be checked
  await expect(page.getByTestId('export-select-all')).not.toBeChecked()
})

test('re-checking a transaction restores full selection', async () => {
  const incomeRow = page.getByTestId('export-transaction-row').filter({ hasText: 'Income Source' })
  await incomeRow.locator('input[type="checkbox"]').check()
  await expect(page.getByTestId('export-select-all')).toBeChecked()
})

// ── CSV download ───────────────────────────────────────────────────────

test('clicking CSV button triggers a .csv download', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv-btn').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.csv$/i)
})

// ── JSON download ──────────────────────────────────────────────────────

test('clicking JSON button triggers a .json download', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json-btn').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.json$/i)
})

// ── Exported CSV content ───────────────────────────────────────────────

test('exported CSV contains header row and test transaction', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv-btn').click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
  const content = Buffer.concat(chunks).toString('utf-8')

  expect(content).toMatch(/date|Date/)
  expect(content).toMatch(/amount|Amount/)
  expect(content).toMatch(/Test Merchant/)
})

// ── Exported JSON content ──────────────────────────────────────────────

test('exported JSON is valid and contains the test transaction', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json-btn').click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
  const content = Buffer.concat(chunks).toString('utf-8')

  const data = JSON.parse(content) as unknown[]
  expect(Array.isArray(data)).toBe(true)
  const merchants = (data as Array<{ merchant?: string }>).map((t) => t.merchant)
  expect(merchants).toContain('Test Merchant')
})

// ── Partial export (deselect some) ────────────────────────────────────

test('exporting with only one transaction selected produces a file with that transaction only', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // Uncheck Income Source — export only Test Merchant
  const incomeRow = page.getByTestId('export-transaction-row').filter({ hasText: 'Income Source' })
  await incomeRow.locator('input[type="checkbox"]').uncheck()
  await expect(page.getByText(/1 of 2 selected/)).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json-btn').click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
  const data = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Array<{ merchant?: string }>
  expect(data.length).toBe(1)
  expect(data[0].merchant).toBe('Test Merchant')
})

// ── Export respects active filters ─────────────────────────────────────

test('export modal only shows transactions matching the active type filter', async () => {
  // Apply "Expense" type filter
  await page.getByLabel('Type').selectOption('expense')
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const list = page.getByTestId('export-transaction-list')
  // Only the expense should appear
  await expect(list.getByText('Test Merchant')).toBeVisible()
  await expect(list.getByText('Income Source')).not.toBeVisible()
  // Close and reset filter
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByLabel('Type').selectOption('all')
})

// ── Server-side export honours active filters (Phase 5c C4) ───────────

async function downloadContent(testid: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testid).click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
  return Buffer.concat(chunks).toString('utf-8')
}

test('exported file with an active type filter contains only matching rows', async () => {
  await page.getByLabel('Type').selectOption('expense')
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const content = await downloadContent('export-csv-btn')
  expect(content).toMatch(/Test Merchant/)
  expect(content).not.toMatch(/Income Source/)
  await page.getByLabel('Type').selectOption('all')
})

test('exported file with an active search filter contains only matching rows', async () => {
  // The B1 search input drives the server `q` filter through to the export route
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/transactions') && r.url().includes('q=Income'),
  )
  await page.getByTestId('transaction-search').fill('Income')
  await response
  await page.getByRole('button', { name: /Export/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const content = await downloadContent('export-json-btn')
  const data = JSON.parse(content) as Array<{ merchant?: string }>
  expect(data.length).toBe(1)
  expect(data[0].merchant).toBe('Income Source')
  await page.getByTestId('transaction-search').fill('')
})
