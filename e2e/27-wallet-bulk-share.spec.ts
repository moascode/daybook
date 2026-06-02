import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

test.describe('27 — Wallet bulk share dialog', () => {
  async function setupAccountAndTransaction(page: ReturnType<typeof newAppPage> extends Promise<infer P> ? P : never) {
    const acctRes = await page.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Test Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json() as { id: string }
    const today = new Date().toISOString().slice(0, 10)
    await page.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Bulk Share Test', amount: 50, type: 'expense', tag: '[]' },
    })
    return acct
  }

  test('Share button appears when a transaction is selected', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setupAccountAndTransaction(page)
    await page.reload()

    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Bulk Share Test')).toBeVisible({ timeout: 5_000 })

    // Enter select mode
    await page.getByRole('button', { name: /Select/ }).click()
    await expect(page.getByTestId('select-mode-bar')).toBeVisible()

    // Share button must NOT be visible with 0 selected
    await expect(page.getByTestId('bulk-share-btn')).not.toBeVisible()

    // Select one transaction
    await page.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()

    // Now Share button must appear
    await expect(page.getByTestId('bulk-share-btn')).toBeVisible()
    // Delete button also visible
    await expect(page.getByTestId('bulk-delete-btn')).toBeVisible()
  })

  test('Share button is a sibling of Delete button — not nested inside it', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setupAccountAndTransaction(page)
    await page.reload()

    await expect(page.getByText('Bulk Share Test')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Select/ }).click()
    await page.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()

    const shareBtn = page.getByTestId('bulk-share-btn')
    const deleteBtn = page.getByTestId('bulk-delete-btn')
    await expect(shareBtn).toBeVisible()
    await expect(deleteBtn).toBeVisible()

    // Share button must NOT be a DOM descendant of Delete button (Issue 7 regression)
    const shareIsInsideDelete = await deleteBtn.evaluate((del) => {
      const share = document.querySelector('[data-testid="bulk-share-btn"]')
      return share ? del.contains(share) : false
    })
    expect(shareIsInsideDelete).toBe(false)
  })

  test('Clicking Share opens BulkShareDialog', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setupAccountAndTransaction(page)
    await page.reload()

    await expect(page.getByText('Bulk Share Test')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Select/ }).click()
    await page.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()
    await page.getByTestId('bulk-share-btn').click()

    // Dialog opens and shows a title
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: 'Share 1 Transaction' })).toBeVisible()
  })

  test('Dialog shows correct transaction count in heading', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const acctRes = await page.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Test Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json() as { id: string }
    const today = new Date().toISOString().slice(0, 10)
    await page.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Share Txn A', amount: 30, type: 'expense', tag: '[]' },
    })
    await page.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Share Txn B', amount: 20, type: 'expense', tag: '[]' },
    })
    await page.reload()

    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Select/ }).click()

    // Select all via the header checkbox
    await page.locator('[data-testid="select-mode-bar"] input[type="checkbox"]').click()
    await page.getByTestId('bulk-share-btn').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // Heading says "Share 2 Transactions"
    await expect(dialog.getByRole('heading', { name: 'Share 2 Transactions' })).toBeVisible({ timeout: 5_000 })
  })

  test('Cancel closes dialog without resetting select mode', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await setupAccountAndTransaction(page)
    await page.reload()

    await expect(page.getByText('Bulk Share Test')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Select/ }).click()
    await page.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()
    await page.getByTestId('bulk-share-btn').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Click Cancel — dialog closes
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible({ timeout: 3_000 })

    // Select mode bar is still visible (onSave was NOT triggered — no selectedIds reset)
    await expect(page.getByTestId('select-mode-bar')).toBeVisible()
    // The "1 selected" text remains
    await expect(page.getByText('1 selected')).toBeVisible()
  })
})
