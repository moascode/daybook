import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.describe('36 — Settlement', () => {
  test('Bob settles RM100 with Alice; group balance becomes 0', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()

    const aliceName = `alice_set_${Date.now()}`
    const bobName = `bob_set_${Date.now()}`

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    // Get user IDs
    const aliceMeRes = await alicePage.request.get('/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('/api/auth/me')
    const bobMe = await bobMeRes.json()

    // Alice creates group and invites Bob
    const groupRes = await alicePage.request.post('/api/groups', { data: { name: 'Family' } })
    const group = await groupRes.json()
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })

    // Bob accepts
    const invRes = await bobPage.request.get('/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    // Alice creates an account and a transaction
    const aliceAcctRes = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()

    const txnRes = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()

    // Split 50/50 between Alice and Bob via API
    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 100, note: '' },
            { userId: bobMe.user.id, shareAmount: 100, note: '' },
          ],
        }],
      },
    })

    // Check group balances — Bob owes Alice 100
    const balancesRes = await bobPage.request.get(`/api/groups/${group.id}/balances`)
    const balances = await balancesRes.json()
    expect(balances.length).toBe(1)
    expect(balances[0].fromUserId).toBe(bobMe.user.id)
    expect(balances[0].toUserId).toBe(aliceMe.user.id)
    expect(Math.round(balances[0].amount)).toBe(100)

    // Bob creates an account for settlement
    const bobAcctRes = await bobPage.request.post('/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    // Bob navigates to the Wallet Shared page and settles
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    // Person-first: the Balances tile is headed by the counterparty's name,
    // with the direction in the tile's amount/footer, not in a heading.
    const bobBalRow = bobPage.getByTestId('bal-row').filter({ hasText: aliceName })
    await expect(bobBalRow).toContainText('You owe them', { timeout: 5000 })
    await bobBalRow.getByRole('button', { name: 'Settle Up' }).click()

    // Fill settle up form
    const settleDialog = bobPage.getByRole('dialog')
    await settleDialog.locator('select').selectOption(bobAcct.name)
    await settleDialog.getByRole('button', { name: 'Record Settlement' }).click()

    // W4: recording the payment is a claim, not a clearance. Bob's money has
    // left, but the debt stands until Alice says it arrived — the tile now
    // shows "Waiting on <Alice>" instead of an actionable Settle Up.
    await expect(bobBalRow).toContainText(`Waiting on ${aliceName}`, { timeout: 5000 })

    // Bob's Cash shows the expense immediately — his cash really did go.
    await bobPage.goto('/wallet')
    await expect(bobPage.locator('main')).toBeVisible()
    await expect(bobPage.getByText('Settlement', { exact: true })).toBeVisible()

    // Alice confirms receipt, into an account she chooses herself.
    await alicePage.goto('/wallet/shared')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(alicePage.getByTestId('awaiting-confirmation')).toBeVisible({ timeout: 10_000 })
    await alicePage.getByTestId('bal-row').filter({ hasText: bobName }).getByRole('button', { name: 'Review' }).click()
    const confirmDialog = alicePage.getByRole('dialog')
    await expect(confirmDialog.locator('option', { hasText: aliceAcct.name })).toHaveCount(1, { timeout: 10_000 })
    await confirmDialog.locator('select').selectOption(aliceAcct.name)
    await alicePage.getByTestId('confirm-receipt').click()

    // Now the debt clears, for both of them.
    await expect(
      alicePage.getByText('All settled up').or(alicePage.getByText('No outstanding balances'))
    ).toBeVisible({ timeout: 10_000 })
    await bobPage.goto('/wallet/shared')
    await expect(
      bobPage.getByText('All settled up').or(bobPage.getByText('No outstanding balances'))
    ).toBeVisible({ timeout: 10_000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('undoing a settlement restores the outstanding balance', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_undo_${ts}`
    const bobName = `bob_undo_${ts}`

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('/api/groups', { data: { name: 'UndoGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 100, note: '' },
            { userId: bobMe.user.id, shareAmount: 100, note: '' },
          ],
        }],
      },
    })

    // Bob settles via UI
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    const bobBalRow = bobPage.getByTestId('bal-row').filter({ hasText: aliceName })
    await expect(bobBalRow).toContainText('You owe them', { timeout: 5000 })
    await bobBalRow.getByRole('button', { name: 'Settle Up' }).click()

    const settleDialog = bobPage.getByRole('dialog')
    await settleDialog.locator('select').first().selectOption(bobAcct.name)
    await settleDialog.getByRole('button', { name: 'Record Settlement' }).click()

    // W4: the claim leaves the balance standing until Alice confirms — so Bob's
    // undo here withdraws an unconfirmed payment, which is the common case.
    await expect(bobBalRow).toContainText(`Waiting on ${aliceName}`, { timeout: 5000 })

    // Bob clicks Undo on the settlement row — now requires confirmation modal
    await expect(bobPage.getByText('Recent settlements')).toBeVisible({ timeout: 5000 })
    await bobPage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(bobPage.getByRole('dialog', { name: /Undo Settlement/ })).toBeVisible({ timeout: 3000 })
    await bobPage.getByRole('button', { name: 'Confirm Undo' }).click()

    // Balance should be restored to actionable (no longer "waiting")
    await expect(bobBalRow).toContainText('You owe them', { timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('settling more than owed is capped at the actual debt', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_over_${ts}`
    const bobName = `bob_over_${ts}`

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('/api/groups', { data: { name: 'OverGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 100, note: '' },
            { userId: bobMe.user.id, shareAmount: 100, note: '' },
          ],
        }],
      },
    })

    // Bob tries to settle RM200 but only owes RM100 — server caps at actual owed
    const settleRes = await bobPage.request.post('/api/settlements', {
      data: {
        groupId: group.id,
        toUserId: aliceMe.user.id,
        amount: 200,
        note: '',
        fromAccountId: bobAcct.id,
      },
    })
    // Server caps at RM100 (U-13) — either 200 or 201 status
    expect([200, 201, 400]).toContain(settleRes.status())

    // W4: the cap is applied when the claim is recorded; the balance clears once
    // Alice confirms it, into an account she picks herself.
    const settleBody = await settleRes.json()
    await alicePage.request.post(`/api/settlements/${settleBody.id}/confirm`, {
      data: { accountId: aliceAcct.id },
    })

    const balancesRes = await bobPage.request.get(`/api/groups/${group.id}/balances`)
    const balances = await balancesRes.json()
    expect(balances.length).toBe(0)

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('settlement appears in history after page reload', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_hist_${ts}`
    const bobName = `bob_hist_${ts}`

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('/api/groups', { data: { name: 'HistGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 100, note: '' },
            { userId: bobMe.user.id, shareAmount: 100, note: '' },
          ],
        }],
      },
    })

    // Bob settles via API
    await bobPage.request.post('/api/settlements', {
      data: { groupId: group.id, toUserId: aliceMe.user.id, amount: 100, note: 'cash', fromAccountId: bobAcct.id },
    })

    // Bob reloads the Shared page and checks history
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    // Person-first: the counterparty's name is on their Balances tile.
    await expect(bobPage.getByTestId('bal-row').filter({ hasText: aliceName })).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByText('Recent settlements')).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByText('cash')).toBeVisible({ timeout: 3000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
