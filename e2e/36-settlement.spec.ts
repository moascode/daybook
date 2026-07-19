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

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    // Get user IDs
    const aliceMeRes = await alicePage.request.get('http://localhost:5173/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('http://localhost:5173/api/auth/me')
    const bobMe = await bobMeRes.json()

    // Alice creates group and invites Bob
    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'Family' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })

    // Bob accepts
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    // Alice creates an account and a transaction
    const aliceAcctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()

    const txnRes = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()

    // Split 50/50 between Alice and Bob via API
    await alicePage.request.post('http://localhost:5173/api/transactions/shares', {
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
    const balancesRes = await bobPage.request.get(`http://localhost:5173/api/groups/${group.id}/balances`)
    const balances = await balancesRes.json()
    expect(balances.length).toBe(1)
    expect(balances[0].fromUserId).toBe(bobMe.user.id)
    expect(balances[0].toUserId).toBe(aliceMe.user.id)
    expect(Math.round(balances[0].amount)).toBe(100)

    // Bob creates an account for settlement
    const bobAcctRes = await bobPage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    // Bob navigates to the Wallet Shared page and settles
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(bobPage.getByRole('heading', { name: 'Family' })).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByRole('heading', { name: 'You owe' })).toBeVisible({ timeout: 5000 })
    await bobPage.getByRole('button', { name: 'Settle Up' }).click()

    // Fill settle up form
    const settleDialog = bobPage.getByRole('dialog')
    await settleDialog.locator('select').selectOption(bobAcct.name)
    await settleDialog.getByRole('button', { name: 'Record Settlement' }).click()

    // Balance should now show 0 (no outstanding balances)
    await expect(
      bobPage.getByText('All settled up').or(bobPage.getByText('No outstanding balances'))
    ).toBeVisible({ timeout: 5000 })

    // Bob's Cash should show an expense
    await bobPage.goto('/wallet')
    await expect(bobPage.locator('main')).toBeVisible()
    await expect(bobPage.getByText('Settlement', { exact: true })).toBeVisible()

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

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('http://localhost:5173/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('http://localhost:5173/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'UndoGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('http://localhost:5173/api/transactions/shares', {
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
    await expect(bobPage.getByRole('heading', { name: 'UndoGroup' })).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByRole('heading', { name: 'You owe' })).toBeVisible({ timeout: 5000 })
    await bobPage.getByRole('button', { name: 'Settle Up' }).click()

    const settleDialog = bobPage.getByRole('dialog')
    await settleDialog.locator('select').first().selectOption(bobAcct.name)
    await settleDialog.getByRole('button', { name: 'Record Settlement' }).click()

    await expect(bobPage.getByText('No outstanding balances').or(bobPage.getByText('All settled up'))).toBeVisible({ timeout: 5000 })

    // Bob clicks Undo on the settlement row — now requires confirmation modal
    await expect(bobPage.getByText('Recent settlements')).toBeVisible({ timeout: 5000 })
    await bobPage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(bobPage.getByRole('dialog', { name: /Undo Settlement/ })).toBeVisible({ timeout: 3000 })
    await bobPage.getByRole('button', { name: 'Confirm Undo' }).click()

    // Balance should be restored
    await expect(bobPage.getByRole('heading', { name: 'You owe' })).toBeVisible({ timeout: 5000 })

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

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('http://localhost:5173/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('http://localhost:5173/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'OverGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('http://localhost:5173/api/transactions/shares', {
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
    const settleRes = await bobPage.request.post('http://localhost:5173/api/settlements', {
      data: {
        groupId: group.id,
        toUserId: aliceMe.user.id,
        amount: 200,
        note: '',
        fromAccountId: bobAcct.id,
      },
    })
    // Server caps at RM100 (U-13) — either 200 or 201 status, balance must be 0
    expect([200, 201, 400]).toContain(settleRes.status())

    const balancesRes = await bobPage.request.get(`http://localhost:5173/api/groups/${group.id}/balances`)
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

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const aliceMeRes = await alicePage.request.get('http://localhost:5173/api/auth/me')
    const aliceMe = await aliceMeRes.json()
    const bobMeRes = await bobPage.request.get('http://localhost:5173/api/auth/me')
    const bobMe = await bobMeRes.json()

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'HistGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const aliceAcctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const aliceAcct = await aliceAcctRes.json()
    const bobAcctRes = await bobPage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })
    const bobAcct = await bobAcctRes.json()

    const txnRes = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })
    const txn = await txnRes.json()
    await alicePage.request.post('http://localhost:5173/api/transactions/shares', {
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
    await bobPage.request.post('http://localhost:5173/api/settlements', {
      data: { groupId: group.id, toUserId: aliceMe.user.id, amount: 100, note: 'cash', fromAccountId: bobAcct.id },
    })

    // Bob reloads the Shared page and checks history
    await bobPage.goto('/wallet/shared')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(bobPage.getByRole('heading', { name: 'HistGroup' })).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByText('Recent settlements')).toBeVisible({ timeout: 5000 })
    await expect(bobPage.getByText('cash')).toBeVisible({ timeout: 3000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
