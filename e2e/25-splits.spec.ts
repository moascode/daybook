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
    await alicePage.getByRole('button', { name: 'Split transaction' }).click()

    // SplitDialog opens
    const splitDialog = alicePage.getByRole('dialog')
    await expect(splitDialog).toBeVisible()
    await expect(splitDialog.getByText('Split Transaction')).toBeVisible()

    // Bob should appear as a member to split with
    await expect(splitDialog.getByText(bobName)).toBeVisible({ timeout: 5000 })

    // Click Bob to include him in the split
    await splitDialog.getByText(bobName).click()

    // Verify the total section appears (amounts are in inputs, check the Total label)
    await expect(splitDialog.getByText(/Total:/)).toBeVisible()

    // Save the split
    await splitDialog.getByRole('button', { name: 'Save Split' }).click()
    await expect(splitDialog).not.toBeVisible()

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
    await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: { accountId: acct.id, date: '2026-01-01', merchant: 'Lunch', amount: 50, type: 'expense', tag: '[]' },
    })

    // Alice opens wallet and opens split dialog
    await alicePage.goto('/wallet')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    await alicePage.getByTestId('split-transaction-btn').first().click()

    // Wait for dialog; Bob should be listed as an available member
    await expect(alicePage.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    // Bob is shown as a chip — click him to deselect (or verify he is NOT selected by default)
    // The split dialog only includes self by default — lines.length = 1 (only Alice)
    // When only self is participant, Save Split should be disabled
    const saveSplitBtn = alicePage.getByRole('button', { name: 'Save Split' })
    await expect(saveSplitBtn).toBeDisabled({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
