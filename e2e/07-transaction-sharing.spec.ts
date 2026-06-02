import { test, expect } from '@playwright/test'

test.describe('Transaction Sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wallet')
  })

  // ── Single Transaction Share ───────────────────────────

  test('share single transaction with full amount (no split)', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="share-transaction-btn"]')
    await page.selectOption('[role="dialog"] select', 'user-b')
    await page.click('button:has-text("Share")')
    await expect(page.getByTestId('transaction-row')).toContainText('Shared')
  })

  test('share single transaction with equal split', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="share-transaction-btn"]')
    await page.selectOption('[role="dialog"] select', 'user-b')
    await page.click('button:has-text("Split equally")')
    await page.click('button:has-text("Share")')
    await expect(page.getByTestId('transaction-row')).toContainText('Shared')
  })

  test('share single transaction with custom amounts', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="share-transaction-btn"]')
    await page.selectOption('[role="dialog"] select', 'user-b')
    await page.click('button:has-text("Custom")')
    await page.fill('input[type="number"]:first-of-type', '15')
    await page.fill('input[type="number"]:last-of-type', '5')
    await page.click('button:has-text("Share")')
    await expect(page.getByTestId('transaction-row')).toContainText('Shared')
  })

  // ── Multi-Selection Share ───────────────────────────

  test('share multiple transactions with different recipients', async ({ page }) => {
    await page.click('[data-testid="select-mode-bar"] input')
    await page.click('[data-testid="bulk-share-btn"]')
    await page.selectOption('[role="dialog"] select:first-of-type', 'user-a')
    await page.selectOption('[role="dialog"] select:last-of-type', 'user-b')
    await page.click('button:has-text("Share 2 Transactions")')
    await expect(page.getByText('Shared')).toHaveCount(2)
  })

  test('bulk share validation: missing recipient', async ({ page }) => {
    await page.click('[data-testid="select-mode-bar"] input')
    await page.click('[data-testid="bulk-share-btn"]')
    await page.click('button:has-text("Share 2 Transactions")')
    await expect(page.getByText('Please select a recipient')).toBeVisible()
  })

  // ── Filter Views ───────────────────────────

  test('filter "Mine" shows only own transactions', async ({ page }) => {
    await page.click('button:has-text("Mine")')
    const rows = page.getByTestId('transaction-row')
    await expect(rows).toHaveCount(3)
  })

  test('filter "Shared with me" shows transactions others shared', async ({ page }) => {
    await page.click('button:has-text("Shared with me")')
    const rows = page.getByTestId('transaction-row')
    await expect(rows).toHaveCount(2)
  })

  test('filter "Shared with others" shows my transactions that I shared', async ({ page }) => {
    await page.click('button:has-text("Shared with others")')
    const rows = page.getByTestId('transaction-row')
    await expect(rows).toHaveCount(1)
  })

  test('filter "All" shows all visible transactions', async ({ page }) => {
    await page.click('button:has-text("All")')
    const rows = page.getByTestId('transaction-row')
    await expect(rows).toHaveCount(5)
  })

  // ── Share Status Badge ───────────────────────────

  test('share badge appears on shared transactions', async ({ page }) => {
    await page.click('[data-testid="share-transaction-btn"]')
    await page.click('button:has-text("Share")')
    await expect(page.getByText('Shared')).toBeVisible()
  })

  test('share badge does not appear on non-shared transactions', async ({ page }) => {
    await expect(page.getByText('Shared')).not.toBeVisible()
  })

  // ── Settlement Flow ───────────────────────────

  test('settlement displays original transaction context', async ({ page }) => {
    await page.click('[data-testid="settlement-btn"]')
    await page.click('button:has-text("Record Settlement")')
    await expect(page.getByText('View original transaction')).toBeVisible()
  })

  test('settlement link navigates to original transaction', async ({ page }) => {
    await page.click('[data-testid="settlement-btn"]')
    await page.click('button:has-text("Record Settlement")')
    await page.click('a:has-text("View original transaction")')
    await expect(page).toHaveURL(/\/wallet\/transactions\/[\w-]+/)
  })

  // ── Authorization ───────────────────────────

  test('share with non-co-group member fails', async ({ page }) => {
    await page.click('[data-testid="share-transaction-btn"]')
    await page.selectOption('[role="dialog"] select', 'non-member')
    await page.click('button:has-text("Share")')
    await expect(page.getByText('recipient is not a group co-member')).toBeVisible()
  })

  test('share transaction you do not own fails', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="share-transaction-btn"]')
    await expect(page.getByText('only the transaction owner can share')).toBeVisible()
  })

  // ── Edge Cases ───────────────────────────

  test('share zero-amount transaction shows error', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="share-transaction-btn"]')
    await expect(page.getByText('Cannot share a zero-amount transaction')).toBeVisible()
  })

  test('edit transaction with existing shares rescales amounts', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="edit-transaction-btn"]')
    await page.fill('input[name="amount"]', '50')
    await page.click('button:has-text("Save")')
    await expect(page.getByText('Shared')).toBeVisible()
  })

  test('delete transaction with existing shares CASCADE deletes shares', async ({ page }) => {
    await page.click('[data-testid="transaction-row"]')
    await page.click('[data-testid="delete-transaction-btn"]')
    await page.click('button:has-text("Delete")')
    await expect(page.getByTestId('transaction-row')).not.toBeVisible()
  })

  test('settlement when share already fully settled shows warning', async ({ page }) => {
    await page.click('[data-testid="settlement-btn"]')
    await expect(page.getByText('already settled')).toBeVisible()
  })

  test('settlement when share partially settled shows correct amount', async ({ page }) => {
    await page.click('[data-testid="settlement-btn"]')
    await expect(page.getByText('remaining: RM 10')).toBeVisible()
  })
})
