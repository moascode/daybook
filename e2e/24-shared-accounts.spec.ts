import { test, expect } from '@playwright/test'
import { fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

async function setupTwoUsers(browser: import('@playwright/test').Browser) {
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()
  const alicePage = await aliceCtx.newPage()
  const bobPage = await bobCtx.newPage()

  const aliceName = `alice_sa_${Date.now()}`
  const bobName = `bob_sa_${Date.now()}`

  await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
  await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

  return { alicePage, bobPage, aliceName, bobName, aliceCtx, bobCtx }
}

async function createGroupAndInvite(alicePage: import('@playwright/test').Page, bobPage: import('@playwright/test').Page, bobName: string) {
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

  await bobPage.goto('/household')
  await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
  await expect(bobPage.getByRole('button', { name: 'Accept' })).toBeVisible({ timeout: 10_000 })
  await bobPage.getByRole('button', { name: 'Accept' }).click()
}

test.describe('24 — Shared accounts', () => {
  test('Alice shares account (read-only) → Bob sees it and its transactions', async ({ browser }) => {
    const { alicePage, bobPage, bobName, aliceCtx, bobCtx } = await setupTwoUsers(browser)

    await createGroupAndInvite(alicePage, bobPage, bobName)

    // Alice creates an account
    await alicePage.goto('/wallet/accounts')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 15_000 })
    await alicePage.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(alicePage, { name: 'Family Visa' })

    // Alice adds a transaction
    await alicePage.goto('/wallet')
    await expect(alicePage.locator('main')).toBeVisible()
    await alicePage.getByRole('button', { name: 'Add Transaction' }).click()
    await fillTransactionForm(alicePage, { amount: '100', merchant: 'Supermarket' })

    // Alice edits the account and shares it with the group
    await alicePage.goto('/wallet/accounts')
    await alicePage.locator('[data-testid="account-card"]').filter({ hasText: 'Family Visa' }).hover()
    await alicePage.getByRole('button', { name: 'Edit account' }).click()
    const shareSelect = alicePage.getByRole('dialog').locator('select').last()
    await shareSelect.selectOption({ label: 'Family' })
    await alicePage.getByRole('dialog').getByRole('button', { name: 'Share' }).click()
    await alicePage.getByRole('dialog').getByRole('button', { name: /Save Changes/ }).click()

    // Bob navigates to accounts and should see the shared account
    await bobPage.goto('/wallet/accounts')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 15_000 })
    await expect(bobPage.getByText('Family Visa')).toBeVisible({ timeout: 5000 })

    // Bob sees the transactions on the shared account
    await bobPage.goto('/wallet')
    await expect(bobPage.getByText('Supermarket')).toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('Alice unshares account → Bob no longer sees it', async ({ browser }) => {
    const { alicePage, bobPage, bobName, aliceCtx, bobCtx } = await setupTwoUsers(browser)

    await createGroupAndInvite(alicePage, bobPage, bobName)

    // Alice creates and shares an account
    await alicePage.goto('/wallet/accounts')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 15_000 })
    await alicePage.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(alicePage, { name: 'Shared Card' })

    await alicePage.locator('[data-testid="account-card"]').filter({ hasText: 'Shared Card' }).hover()
    await alicePage.getByRole('button', { name: 'Edit account' }).click()
    const shareSelect = alicePage.getByRole('dialog').locator('select').last()
    await shareSelect.selectOption({ label: 'Family' })
    await alicePage.getByRole('dialog').getByRole('button', { name: 'Share' }).click()
    await alicePage.getByRole('dialog').getByRole('button', { name: /Save Changes/ }).click()

    // Verify Bob sees it
    await bobPage.goto('/wallet/accounts')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 15_000 })
    await expect(bobPage.getByText('Shared Card')).toBeVisible({ timeout: 5000 })

    // Alice unshares it — via API directly for test simplicity
    // (Find groupId and accountId via API)
    const groups = await alicePage.request.get('http://localhost:5173/api/groups')
    const groupsData = await groups.json()
    const groupId = groupsData[0]?.id
    const accounts = await alicePage.request.get('http://localhost:5173/api/accounts')
    const accountsData = await accounts.json()
    const acct = accountsData.find((a: { name: string }) => a.name === 'Shared Card')
    if (groupId && acct) {
      await alicePage.request.delete(`http://localhost:5173/api/accounts/${acct.id}/shares/${groupId}`)
    }

    // Bob refreshes — should no longer see it
    await bobPage.reload()
    await expect(bobPage.locator('main')).toBeVisible()
    await expect(bobPage.getByText('Shared Card')).not.toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('non-group-member cannot see a shared account', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const carolCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const carolPage = await carolCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_iso_${ts}`
    const carolName = `carol_iso_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await carolPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: carolName, password: 'test-password' } })

    // Alice creates a group (Carol is NOT invited)
    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'PrivateGroup' } })
    const group = await groupRes.json()

    // Alice creates and shares an account
    const acctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Private', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json()
    await alicePage.request.post(`http://localhost:5173/api/accounts/${acct.id}/shares`, {
      data: { groupId: group.id, canWrite: false },
    })

    // Carol checks her accounts via API — Alice's account must NOT be there
    const carolAcctsRes = await carolPage.request.get('http://localhost:5173/api/accounts')
    const carolAccts = await carolAcctsRes.json()
    expect(carolAccts.find((a: { id: string }) => a.id === acct.id)).toBeUndefined()

    await aliceCtx.close()
    await carolCtx.close()
  })

  test('unsharing an account removes it from group member view', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_unshare_${ts}`
    const bobName = `bob_unshare_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'UnshareGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    const acctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Shared', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json()
    await alicePage.request.post(`http://localhost:5173/api/accounts/${acct.id}/shares`, {
      data: { groupId: group.id, canWrite: false },
    })

    // Bob verifies he can see the shared account
    const beforeRes = await bobPage.request.get('http://localhost:5173/api/accounts')
    const before = await beforeRes.json()
    expect(before.find((a: { id: string }) => a.id === acct.id)).toBeDefined()

    // Alice unshares via API (DELETE /accounts/:id/shares/:groupId)
    await alicePage.request.delete(`http://localhost:5173/api/accounts/${acct.id}/shares/${group.id}`)

    // Bob checks again — Alice's account is gone
    const afterRes = await bobPage.request.get('http://localhost:5173/api/accounts')
    const after = await afterRes.json()
    expect(after.find((a: { id: string }) => a.id === acct.id)).toBeUndefined()

    await aliceCtx.close()
    await bobCtx.close()
  })
})
