import { test, expect } from '@playwright/test'
import { fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

test.describe('25 — Transaction splits', () => {
  test('Alice splits RM200 with Bob; Bob sees shared-with-me view', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()

    const aliceName = `alice_sp_${Date.now()}`
    const bobName = `bob_sp_${Date.now()}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    // Alice creates a group and invites Bob
    await alicePage.goto('/household')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    await alicePage.getByRole('button', { name: 'New Group' }).click()
    await alicePage.getByRole('dialog').getByRole('textbox').fill('Family')
    await alicePage.getByRole('button', { name: 'Create Group' }).click()
    await alicePage.getByRole('heading', { name: 'Family' }).click()
    await alicePage.getByRole('button', { name: 'Invite' }).first().click()
    await alicePage.getByRole('dialog').getByRole('textbox').fill(bobName)
    await expect(alicePage.getByRole('dialog').getByText(bobName)).toBeVisible({ timeout: 5000 })
    await alicePage.getByRole('dialog').getByRole('button', { name: 'Invite' }).click()
    await alicePage.getByRole('dialog').getByRole('button', { name: 'Close' }).click()

    // Bob accepts
    await bobPage.goto('/household')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    await bobPage.getByRole('button', { name: 'Accept' }).click()

    // Alice creates an account and transaction
    await alicePage.goto('/wallet/accounts')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 15_000 })
    await alicePage.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(alicePage, { name: 'Alice Cash' })

    await alicePage.goto('/wallet')
    await expect(alicePage.locator('main')).toBeVisible()
    await alicePage.getByRole('button', { name: 'Add Transaction' }).click()
    await fillTransactionForm(alicePage, { amount: '200', merchant: 'Groceries' })

    // Alice clicks the split button on the Groceries transaction
    await expect(alicePage.locator('[data-testid="transaction-row"]').filter({ hasText: 'Groceries' })).toBeVisible()
    await alicePage.locator('[data-testid="transaction-row"]').filter({ hasText: 'Groceries' }).hover()
    await alicePage.getByRole('button', { name: 'Share transaction' }).click()

    // ShareDialog opens
    const shareDialog = alicePage.getByRole('dialog')
    await expect(shareDialog).toBeVisible()
    await expect(shareDialog.getByText('Share Transaction')).toBeVisible()

    // Bob should appear as a recipient in the dropdown
    await expect(shareDialog.locator('select')).toBeVisible({ timeout: 5000 })
    await shareDialog.locator('select').selectOption({ label: bobName })

    // Save the share (default mode: keep as-is)
    await shareDialog.getByRole('button', { name: 'Share' }).click()
    await expect(shareDialog).not.toBeVisible()

    // E-2: Verify balance is reflected in Household page
    await alicePage.goto('/household')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 10_000 })
    // Find the group card and expand it
    await alicePage.getByRole('heading', { name: 'Family' }).first().click()
    await alicePage.getByRole('button', { name: 'balances' }).click()
    await expect(alicePage.getByText('owes you')).toBeVisible({ timeout: 5000 })

    // Bob's view: Shared with me filter
    await bobPage.goto('/wallet')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 15_000 })
    await bobPage.getByRole('button', { name: 'Shared with me' }).click()
    // Bob should see the Groceries transaction in his shared view
    await expect(bobPage.getByText('Groceries')).toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('Save Split is disabled when no other members are selected', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_split_dis_${ts}`
    const bobName = `bob_split_dis_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'SplitGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const acctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json()
    // Use today's date so the transaction appears in the default date filter
    const today = new Date().toISOString().slice(0, 10)
    await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Lunch', amount: 50, type: 'expense', tag: '[]' },
    })

    // Alice opens wallet and opens split dialog
    await alicePage.goto('/wallet')
    // Wait for accounts to load (filter bar appears)
    await expect(alicePage.getByText('Total Net Worth')).toBeVisible({ timeout: 10_000 })
    // Wait for the transaction to appear in the list
    await expect(alicePage.getByText('Lunch')).toBeVisible({ timeout: 10_000 })
    // Click the split button on the Lunch transaction row using the test ID
    await alicePage.locator('[data-testid="transaction-row"]').filter({ hasText: 'Lunch' }).getByRole('button', { name: 'Share transaction' }).click()

    // Wait for dialog
    await expect(alicePage.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    // Share button is disabled when no recipient is selected (default state)
    const shareBtn = alicePage.getByRole('dialog').getByRole('button', { name: 'Share' })
    await expect(shareBtn).toBeDisabled({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  // §2.2: re-opening an already-shared transaction must show the existing
  // shares and warn that saving replaces them (previously a blank form that
  // silently overwrote).
  test('Re-opening a shared transaction shows existing shares and overwrite warning', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_existing_${ts}`
    const bobName = `bob_existing_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const group = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'ExistingGroup' } }).then((r) => r.json()) as { id: string }
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('http://localhost:5173/api/invites').then((r) => r.json()) as Array<{ id: string }>
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const acct = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const today = new Date().toISOString().slice(0, 10)
    const txn = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Dinner', amount: 80, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    // Share equally with Bob via the quick-share API
    const members = await alicePage.request.get('http://localhost:5173/api/groups/members').then((r) => r.json()) as Array<{ user_id: string; username: string }>
    const bobId = members.find((m) => m.username === bobName)!.user_id
    await alicePage.request.post(`http://localhost:5173/api/transactions/${txn.id}/share`, {
      data: { recipientId: bobId, splitMode: 'equal' },
    })

    // Re-open the share dialog on the same transaction
    await alicePage.goto('/wallet')
    await expect(alicePage.getByText('Dinner')).toBeVisible({ timeout: 10_000 })
    await alicePage.locator('[data-testid="transaction-row"]').filter({ hasText: 'Dinner' }).getByRole('button', { name: 'Share transaction' }).click()

    const dialog = alicePage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    const existing = dialog.getByTestId('existing-shares')
    await expect(existing).toBeVisible({ timeout: 5000 })
    // Who-owes-what: both the payer and Bob are listed with their amounts
    await expect(existing.getByText('You')).toBeVisible()
    await expect(existing.getByText(bobName)).toBeVisible()
    await expect(existing.getByText('Saving will replace these shares.')).toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })

  // §2.3/§4.5: the legacy multi-line split endpoint (and its divergent
  // co-writer permission rule) is removed — sharing goes through the
  // owner-only /share and bulk /shares routes.
  test('Legacy POST/DELETE /transactions/:id/shares routes are gone (404)', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.request.post('http://localhost:5173/api/auth/signup', { data: { username: `legacy_${Date.now()}`, password: 'test-password' } })
    const acct = await page.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Legacy Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const txn = await page.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: new Date().toISOString().slice(0, 10), merchant: 'Legacy', amount: 10, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    const post = await page.request.post(`http://localhost:5173/api/transactions/${txn.id}/shares`, {
      data: { shares: [{ userId: 'someone', shareAmount: 10 }] },
    })
    expect(post.status()).toBe(404)
    const del = await page.request.delete(`http://localhost:5173/api/transactions/${txn.id}/shares`)
    expect(del.status()).toBe(404)
    // The read route survives (both dialogs use it to show existing shares)
    const get = await page.request.get(`http://localhost:5173/api/transactions/${txn.id}/shares`)
    expect(get.status()).toBe(200)

    await ctx.close()
  })
})
