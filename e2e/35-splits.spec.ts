import { test, expect } from '@playwright/test'
import { fillAccountForm, fillTransactionForm, businessToday, openBlankTransactionForm, openTransactionRowMenu, selectFilterOption } from './helpers'

test.describe.configure({ mode: 'serial' })

test.describe('35 — Transaction splits', () => {
  test('Alice splits RM200 with Bob; Bob sees shared-with-me view', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()

    const aliceName = `alice_sp_${Date.now()}`
    const bobName = `bob_sp_${Date.now()}`

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    // Alice creates a group and invites Bob
    await alicePage.goto('/settings/sharing')
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
    await bobPage.goto('/settings/sharing')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    await bobPage.getByRole('button', { name: 'Accept' }).click()

    // Alice creates an account and transaction
    await alicePage.goto('/wallet/accounts')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 15_000 })
    await alicePage.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(alicePage, { name: 'Alice Cash' })

    await alicePage.goto('/wallet')
    await expect(alicePage.locator('main')).toBeVisible()
    await openBlankTransactionForm(alicePage)
    await fillTransactionForm(alicePage, { amount: '200', merchant: 'Groceries' })

    // Alice clicks the split button on the Groceries transaction
    await expect(alicePage.locator('[data-testid="transaction-row"]').filter({ hasText: 'Groceries' })).toBeVisible()
    await openTransactionRowMenu(alicePage, 'Groceries')
    await alicePage.getByRole('menuitem', { name: 'Split transaction' }).click()

    // ShareDialog opens
    const shareDialog = alicePage.getByRole('dialog')
    await expect(shareDialog).toBeVisible()
    await expect(shareDialog.getByText('Split Transaction')).toBeVisible()

    // Bob should appear as a recipient in the dropdown
    await expect(shareDialog.locator('select')).toBeVisible({ timeout: 5000 })
    await shareDialog.locator('select').selectOption({ label: bobName })

    // Save the split (default mode: keep as-is)
    await shareDialog.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(shareDialog).not.toBeVisible()

    // E-2: Verify balance is reflected on the Wallet Shared page
    await alicePage.goto('/wallet/shared')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 10_000 })
    // Alice created and split the transaction, so she's the creditor — her
    // Balances tile for Bob shows "They owe you".
    const aliceBalRow = alicePage.getByTestId('bal-row').filter({ hasText: bobName })
    await expect(aliceBalRow).toContainText('They owe you', { timeout: 5000 })

    // Bob's view: Shared with me filter (a Sharing MultiSelect inside the Filters section)
    await bobPage.goto('/wallet')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 15_000 })
    await bobPage.getByTestId('filter-toggle').click()
    await selectFilterOption(bobPage, 'filter-view', 'shared-with-me')
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

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('/api/groups', { data: { name: 'SplitGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const acctRes = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json()
    // Use today's date so the transaction appears in the default date filter
    const today = businessToday()
    await alicePage.request.post('/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Lunch', amount: 50, type: 'expense', tag: '[]' },
    })

    // Alice opens wallet and opens split dialog
    await alicePage.goto('/wallet')
    // Wait for accounts to load (filter bar appears) — the page no longer
    // shows a net-worth banner; summary-income is the equivalent "loaded" signal.
    await expect(alicePage.getByTestId('summary-income')).toBeVisible({ timeout: 10_000 })
    // Wait for the transaction to appear in the list
    await expect(alicePage.getByText('Lunch')).toBeVisible({ timeout: 10_000 })
    // Click the split button on the Lunch transaction row's ⋯ menu
    await openTransactionRowMenu(alicePage, 'Lunch')
    await alicePage.getByRole('menuitem', { name: 'Split transaction' }).click()

    // Wait for dialog
    await expect(alicePage.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    // Split button is disabled when no recipient is selected (default state)
    const shareBtn = alicePage.getByRole('dialog').getByRole('button', { name: 'Split', exact: true })
    await expect(shareBtn).toBeDisabled({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('Split by percentage auto-complements and computes cent-exact shares', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_pct_${ts}`
    const bobName = `bob_pct_${ts}`
    const API = '/api'

    await alicePage.request.post(`${API}/auth/signup`, { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })

    const group = await alicePage.request.post(`${API}/groups`, { data: { name: 'PctGroup' } }).then((r) => r.json()) as { id: string }
    await alicePage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await bobPage.request.post(`${API}/invites/${invites[0].id}/accept`)

    const acct = await alicePage.request.post(`${API}/accounts`, {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const today = businessToday()
    // RM10.05 at 64.1% is 6.44205 — an amount and a percentage chosen so the
    // cent rounding actually engages. A round 30/70 of RM100 divides exactly and
    // would pass even if splitByPercents got the remainder rule wrong.
    const txn = await alicePage.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: today, merchant: 'Utilities', amount: 10.05, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    await alicePage.goto('/wallet')
    await expect(alicePage.getByText('Utilities')).toBeVisible({ timeout: 10_000 })
    await openTransactionRowMenu(alicePage, 'Utilities')
    await alicePage.getByRole('menuitem', { name: 'Split transaction' }).click()

    const dialog = alicePage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.locator('select')).toBeVisible({ timeout: 5000 })
    await dialog.locator('select').selectOption({ label: bobName })

    await dialog.getByRole('button', { name: 'By %' }).click()
    await dialog.getByTestId('percent-recipient').fill('64.1')

    // Auto-complement: the owner's box updates to the remainder automatically,
    // and prints it rounded — 100 - 64.1 is 35.900000000000006 in binary float.
    await expect(dialog.getByTestId('percent-you')).toHaveValue('35.9')

    await dialog.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    const splits = await alicePage.request.get(`${API}/transactions/${txn.id}/splits`)
      .then((r) => r.json()) as Array<{ share_amount: number }>
    const amounts = splits.map((s) => s.share_amount).sort((a, b) => a - b)
    // Owner absorbs the rounding remainder, and the pair still totals RM10.05.
    expect(amounts).toEqual([3.61, 6.44])

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

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const group = await alicePage.request.post('/api/groups', { data: { name: 'ExistingGroup' } }).then((r) => r.json()) as { id: string }
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('/api/invites').then((r) => r.json()) as Array<{ id: string }>
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const acct = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const today = businessToday()
    const txn = await alicePage.request.post('/api/transactions', {
      data: { accountId: acct.id, date: today, merchant: 'Dinner', amount: 80, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    // Share equally with Bob via the quick-share API
    const members = await alicePage.request.get('/api/groups/members').then((r) => r.json()) as Array<{ user_id: string; username: string }>
    const bobId = members.find((m) => m.username === bobName)!.user_id
    await alicePage.request.post(`/api/transactions/${txn.id}/split`, {
      data: { recipientId: bobId, splitMode: 'equal' },
    })

    // Re-open the share dialog on the same transaction
    await alicePage.goto('/wallet')
    await expect(alicePage.getByText('Dinner')).toBeVisible({ timeout: 10_000 })
    await openTransactionRowMenu(alicePage, 'Dinner')
    await alicePage.getByRole('menuitem', { name: 'Split transaction' }).click()

    const dialog = alicePage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    const existing = dialog.getByTestId('existing-splits')
    await expect(existing).toBeVisible({ timeout: 5000 })
    // Who-owes-what: both the payer and Bob are listed with their amounts
    await expect(existing.getByText('You')).toBeVisible()
    await expect(existing.getByText(bobName)).toBeVisible()
    await expect(existing.getByText('Saving will replace this split.')).toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })

  // §2.3/§4.5: the legacy multi-line split endpoint (and its divergent
  // co-writer permission rule) is removed — splitting goes through the
  // owner-only /split and bulk /splits routes. (CD-05⁺: the read route is
  // now /transactions/:id/splits.)
  test('Legacy POST/DELETE /transactions/:id/shares routes are gone (404)', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.request.post('/api/auth/signup', { data: { username: `legacy_${Date.now()}`, password: 'test-password' } })
    const acct = await page.request.post('/api/accounts', {
      data: { name: 'Legacy Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const txn = await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Legacy', amount: 10, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    const post = await page.request.post(`/api/transactions/${txn.id}/shares`, {
      data: { shares: [{ userId: 'someone', shareAmount: 10 }] },
    })
    expect(post.status()).toBe(404)
    const del = await page.request.delete(`/api/transactions/${txn.id}/shares`)
    expect(del.status()).toBe(404)
    // The read route survives under its new name (both dialogs use it to show existing splits)
    const get = await page.request.get(`/api/transactions/${txn.id}/splits`)
    expect(get.status()).toBe(200)

    await ctx.close()
  })

  // Regression: a split older than the current month was invisible to the
  // recipient. Balances are all-time, but Transactions defaults to this month,
  // and the Shared page's drill-in link did not widen the range — so the
  // recipient saw "you owe RM x" and then an empty list. Every other test in
  // this file dates its transaction today, which is why none of them caught it.
  test('A split from a prior month is visible to the recipient', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_oldsplit_${ts}`
    const bobName = `bob_oldsplit_${ts}`
    const API = '/api'

    await alicePage.request.post(`${API}/auth/signup`, { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })
    const bob = await bobPage.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }

    const group = await alicePage.request.post(`${API}/groups`, { data: { name: 'OldSplitGroup' } })
      .then((r) => r.json()) as { id: string }
    await alicePage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await bobPage.request.post(`${API}/invites/${invites[0].id}/accept`)

    const acct = await alicePage.request.post(`${API}/accounts`, {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    // Two months back, built from local date parts (never toISOString on a
    // Date carrying a time — that shifts the day on UTC+ machines, the bug
    // already fixed in specs 03 and 37).
    const now = new Date()
    const prior = new Date(now.getFullYear(), now.getMonth() - 2, 15)
    const priorDate = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-15`

    const txn = await alicePage.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: priorDate, merchant: 'OldGroceries', amount: 120, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }
    const split = await alicePage.request.post(`${API}/transactions/${txn.id}/split`, {
      data: { recipientId: bob.user.id, splitMode: 'none' },
    })
    expect(split.status()).toBe(201)

    // Bob follows the Shared page's drill-in link — the exact reported path.
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    // The balance is all-time, so it shows regardless of the transaction's date
    // — it showing while the list below was empty is what made the bug confusing.
    await expect(bobPage.getByTestId('shared-headline')).toContainText('120.00', { timeout: 10_000 })
    await bobPage.getByRole('link', { name: /View split transactions/ }).click()
    await expect(bobPage.getByText('OldGroceries')).toBeVisible({ timeout: 10_000 })

    // And the escape hatch when the range is still narrowed: the empty state
    // names the range and offers to widen it, rather than implying no data.
    await bobPage.goto('/wallet?view=shared-with-me')
    await expect(bobPage.getByTestId('transactions-empty')).toBeVisible({ timeout: 10_000 })
    await expect(bobPage.getByTestId('transactions-empty')).toContainText('this month')
    await bobPage.getByTestId('empty-show-all-time').click()
    await expect(bobPage.getByText('OldGroceries')).toBeVisible({ timeout: 10_000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
