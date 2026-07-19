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

    await expect(page.getByText('Total Net Worth')).toBeVisible({ timeout: 10_000 })
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
    // Without any group co-members, the dialog explains instead of listing recipients
    await expect(page.getByRole('dialog').getByText('No group members yet', { exact: false })).toBeVisible()
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

    await expect(page.getByText('Total Net Worth')).toBeVisible({ timeout: 10_000 })
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

// §2.1 rebuild: per-transaction modes, owner-absorbs rounding, badge refresh.
// These need a real co-group member, so users/groups are set up via the API.
test.describe('27 — Bulk share with group members', () => {
  async function setupPair(browser: import('@playwright/test').Browser) {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const bobName = `bob_bulk_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: `alice_bulk_${ts}`, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'BulkGroup' } })
    const group = await groupRes.json() as { id: string }
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('http://localhost:5173/api/invites').then((r) => r.json()) as Array<{ id: string }>
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const acctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json() as { id: string }
    return { aliceCtx, bobCtx, alicePage, bobPage, bobName, acct }
  }

  test('Per-transaction mode control with owner-absorbs rounding', async ({ browser }) => {
    const { aliceCtx, bobCtx, alicePage, bobName, acct } = await setupPair(browser)
    const today = new Date().toISOString().slice(0, 10)
    await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Odd Cents', amount: 10.01, type: 'expense', tag: '[]' },
    })
    await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Full Pass', amount: 30, type: 'expense', tag: '[]' },
    })

    await alicePage.goto('/wallet')
    await expect(alicePage.getByText('Total Net Worth')).toBeVisible({ timeout: 10_000 })
    await alicePage.getByRole('button', { name: /Select/ }).click()
    await alicePage.locator('[data-testid="select-mode-bar"] input[type="checkbox"]').click()
    await alicePage.getByTestId('bulk-share-btn').click()

    const dialog = alicePage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    const cards = dialog.getByTestId('bulk-share-card')
    await expect(cards).toHaveCount(2)

    const oddCard = cards.filter({ hasText: 'Odd Cents' })
    const fullCard = cards.filter({ hasText: 'Full Pass' })

    // Pick Bob on both cards, then switch only the Odd Cents card to equal split
    await oddCard.getByLabel(bobName).check()
    await fullCard.getByLabel(bobName).check()
    await oddCard.getByRole('button', { name: /Split equally/ }).click()

    // Odd Cents card: owner absorbs the rounding cent — You 5.01, Bob 5.00
    const shareRows = oddCard.getByTestId('equal-share-row')
    await expect(shareRows).toHaveCount(2)
    await expect(shareRows.filter({ hasText: 'You' })).toContainText(/RM\s?5\.01/)
    await expect(shareRows.filter({ hasText: bobName })).toContainText(/RM\s?5\.00/)

    // Full Pass card is untouched by the other card's mode: still Keep as-is,
    // no equal-split breakdown rendered
    await expect(fullCard.getByTestId('equal-share-row')).toHaveCount(0)

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('Keep as-is save refreshes Shared badges and exits select mode', async ({ browser }) => {
    const { aliceCtx, bobCtx, alicePage, bobPage, bobName, acct } = await setupPair(browser)
    const today = new Date().toISOString().slice(0, 10)
    await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Badge Refresh', amount: 50, type: 'expense', tag: '[]' },
    })

    await alicePage.goto('/wallet')
    await expect(alicePage.getByText('Badge Refresh')).toBeVisible({ timeout: 10_000 })
    await alicePage.getByRole('button', { name: /Select/ }).click()
    await alicePage.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()
    await alicePage.getByTestId('bulk-share-btn').click()

    const dialog = alicePage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Validation copy aligned with ShareDialog: save disabled until a recipient is picked
    const saveBtn = dialog.getByRole('button', { name: 'Share 1 Transaction' })
    await expect(saveBtn).toBeDisabled()

    await dialog.getByLabel(bobName).check()
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    // §2.1: save exits select mode and refetches so the Shared badge appears
    await expect(alicePage.getByTestId('select-mode-bar')).not.toBeVisible()
    await expect(alicePage.getByText('Shared', { exact: true })).toBeVisible({ timeout: 5_000 })

    // Keep as-is wrote a single recipient-owes-100% row
    const bobShared = await bobPage.request.get('http://localhost:5173/api/transactions?view=shared-with-me').then((r) => r.json()) as Array<{ merchant: string }>
    expect(bobShared.some((t) => t.merchant === 'Badge Refresh')).toBe(true)

    await aliceCtx.close()
    await bobCtx.close()
  })
})
