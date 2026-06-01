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

    // Bob's view: Shared with me filter
    await bobPage.goto('/wallet')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 15_000 })
    await bobPage.getByRole('button', { name: 'Shared with me' }).click()
    // Bob should see the Groceries transaction in his shared view
    await expect(bobPage.getByText('Groceries')).toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
