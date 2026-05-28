/**
 * Wallet: data export — Tier 2 feature.
 * Users can download all transactions as CSV or JSON.
 * This is the safety-net backup before cloud sync exists.
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
  // Create an account and add a transaction so there's data to export
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Export Account', type: 'cash' })
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '25',
    account: 'Export Account',
    merchant: 'Test Merchant',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Export button visible ──────────────────────────────────────────────

test('Export button is visible on the wallet transactions page', async () => {
  await page.goto('/wallet')
  await expect(page.getByRole('button', { name: /Export/i })).toBeVisible()
})

// ── Export panel / modal ───────────────────────────────────────────────

test('clicking Export opens an export options panel or dialog', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  const hasDialog = await page.getByRole('dialog').isVisible().catch(() => false)
  const hasPanel = await page.getByTestId('export-panel').isVisible().catch(() => false)
  expect(hasDialog || hasPanel).toBeTruthy()
})

test('export options show both CSV and JSON choices', async () => {
  await expect(
    page.getByRole('button', { name: /Export CSV/i }).or(page.getByText(/Export as CSV/i)),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Export JSON/i }).or(page.getByText(/Export as JSON/i)),
  ).toBeVisible()
})

// ── CSV download ───────────────────────────────────────────────────────

test('clicking "Export CSV" triggers a file download with a .csv extension', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export CSV/i }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.csv$/i)
})

// ── JSON download ──────────────────────────────────────────────────────

test('clicking "Export JSON" triggers a file download with a .json extension', async () => {
  // Re-open the export panel
  await page.getByRole('button', { name: /Export/i }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export JSON/i }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.json$/i)
})

// ── Exported CSV content ───────────────────────────────────────────────

test('exported CSV file contains a header row and the test transaction', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export CSV/i }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
  const content = Buffer.concat(chunks).toString('utf-8')

  // Must have a header row and the merchant we added
  expect(content).toMatch(/date|Date/)
  expect(content).toMatch(/amount|Amount/)
  expect(content).toMatch(/Test Merchant/)
})

// ── Exported JSON content ──────────────────────────────────────────────

test('exported JSON file is valid JSON and contains the test transaction', async () => {
  await page.getByRole('button', { name: /Export/i }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export JSON/i }).click(),
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
