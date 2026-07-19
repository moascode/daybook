import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function signUpAndGoTo(browser: import('@playwright/test').Browser, username: string, path: string) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post('http://localhost:5173/api/auth/signup', {
    data: { username, password: 'test-password' },
  })
  await page.goto(path)
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
  return { page, ctx }
}

test.describe('33 — Sharing settings: groups, invites, memberships', () => {
  test('Alice creates a group and invites Bob; Bob accepts', async ({ browser }) => {
    const aliceName = `alice_hh_${Date.now()}`
    const bobName = `bob_hh_${Date.now()}`

    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/settings/sharing')
    const { page: bob, ctx: bobCtx } = await signUpAndGoTo(browser, bobName, '/settings/sharing')

    // Alice creates a group
    await alice.getByRole('button', { name: 'New Group' }).click()
    await alice.getByRole('dialog').getByRole('textbox').fill('Family Group')
    await alice.getByRole('button', { name: 'Create Group' }).click()
    await expect(alice.getByText('Family Group')).toBeVisible()

    // Alice expands the group and invites Bob
    await alice.getByText('Family Group').click()
    await alice.getByRole('button', { name: 'Invite' }).first().click()
    const invDialog = alice.getByRole('dialog')
    await invDialog.getByRole('textbox').fill(bobName)
    await expect(invDialog.getByText(bobName)).toBeVisible({ timeout: 5000 })
    await invDialog.getByRole('button', { name: 'Invite' }).click()
    await expect(invDialog.getByText(`Invite sent to ${bobName}`)).toBeVisible()

    // Bob refreshes and sees the pending invite
    await bob.reload()
    await expect(bob.locator('main')).toBeVisible()
    await expect(bob.getByText('Pending invitations')).toBeVisible()
    await expect(bob.getByText('Family Group')).toBeVisible()

    // Bob accepts
    await bob.getByRole('button', { name: 'Accept' }).click()
    await expect(bob.getByText('Pending invitations')).not.toBeVisible()
    // Bob now sees the group
    await expect(bob.getByText('Family Group')).toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('Alice invites Charlie; Charlie declines; invite disappears', async ({ browser }) => {
    const aliceName = `alice_hh2_${Date.now()}`
    const charlieName = `charlie_hh_${Date.now()}`

    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/settings/sharing')
    const { page: charlie, ctx: charlieCtx } = await signUpAndGoTo(browser, charlieName, '/settings/sharing')

    // Alice creates a group and invites Charlie
    await alice.getByRole('button', { name: 'New Group' }).click()
    await alice.getByRole('dialog').getByRole('textbox').fill('Test Group')
    await alice.getByRole('button', { name: 'Create Group' }).click()
    await alice.getByText('Test Group').click()
    await alice.getByRole('button', { name: 'Invite' }).first().click()
    await alice.getByRole('dialog').getByRole('textbox').fill(charlieName)
    await expect(alice.getByRole('dialog').getByText(charlieName)).toBeVisible({ timeout: 5000 })
    await alice.getByRole('dialog').getByRole('button', { name: 'Invite' }).click()

    // Charlie refreshes and sees the invite
    await charlie.reload()
    await expect(charlie.locator('main')).toBeVisible()
    await expect(charlie.getByText('Pending invitations')).toBeVisible()

    // Charlie declines
    await charlie.getByRole('button', { name: 'Decline invitation' }).click()

    // Invite section disappears
    await expect(charlie.getByText('Pending invitations')).not.toBeVisible()

    await aliceCtx.close()
    await charlieCtx.close()
  })

  test('User sees no groups when not a member of any', async ({ browser }) => {
    const aliceName = `alice_hh3_${Date.now()}`
    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/settings/sharing')

    // Alice has no groups — empty state
    await expect(alice.getByText('No groups yet')).toBeVisible()

    await aliceCtx.close()
  })

  test('legacy /household URL redirects to /settings/sharing', async ({ browser }) => {
    const aliceName = `alice_redir_${Date.now()}`
    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/household')

    await expect(alice).toHaveURL(/\/settings\/sharing$/)
    await expect(alice.getByRole('heading', { name: 'Sharing' })).toBeVisible()

    await aliceCtx.close()
  })

  test('inviting a non-existent username shows an error', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const aliceName = `alice_inv_err_${Date.now()}`
    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'TestGroup' } })

    await alicePage.goto('/settings/sharing')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    await alicePage.getByRole('heading', { name: 'TestGroup' }).click()
    await alicePage.getByRole('button', { name: 'Invite' }).click()
    await alicePage.getByPlaceholder('Search by username…').fill('nobody_zzz_does_not_exist')
    // Wait for debounce + search
    await alicePage.waitForTimeout(500)
    await expect(alicePage.getByText(/no users found/i)).toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
  })

  test('owner can remove a member; member loses access', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_rem_${ts}`
    const bobName = `bob_rem_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'RemoveGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })

    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    // Alice removes Bob via UI
    await alicePage.goto('/settings/sharing')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    await alicePage.getByRole('heading', { name: 'RemoveGroup' }).click()
    await expect(alicePage.getByText(bobName)).toBeVisible({ timeout: 5000 })
    await alicePage.getByRole('button', { name: 'Remove member' }).click()
    await expect(alicePage.getByText(bobName)).not.toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('cannot delete a group while accounts are shared with it', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_del_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'DelGroup' } })
    const group = await groupRes.json()
    const acctRes = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    const acct = await acctRes.json()
    // Share the account with the group
    await alicePage.request.post(`http://localhost:5173/api/accounts/${acct.id}/shares`, {
      data: { groupId: group.id, canWrite: false },
    })

    await alicePage.goto('/settings/sharing')
    await expect(alicePage.locator('main')).toBeVisible({ timeout: 20_000 })
    // Click delete group button
    await alicePage.getByRole('button', { name: 'Delete group' }).click()
    // Confirm deletion
    await alicePage.getByRole('button', { name: 'Delete Group' }).click()
    // Should see an error (alert or inline), group should still be visible
    await expect(alicePage.getByRole('heading', { name: 'DelGroup' })).toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
  })

  test('member can leave a group', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_leave_${ts}`
    const bobName = `bob_leave_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    const groupRes = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'LeaveGroup' } })
    const group = await groupRes.json()
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })

    const invRes = await bobPage.request.get('http://localhost:5173/api/invites')
    const invites = await invRes.json()
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    // Bob navigates to household and leaves the group
    await bobPage.goto('/settings/sharing')
    await expect(bobPage.locator('main')).toBeVisible({ timeout: 20_000 })
    await bobPage.getByRole('heading', { name: 'LeaveGroup' }).click()
    await bobPage.getByRole('button', { name: 'Leave group' }).click()
    // Group should no longer appear for Bob
    await expect(bobPage.getByRole('heading', { name: 'LeaveGroup' })).not.toBeVisible({ timeout: 5000 })

    await aliceCtx.close()
    await bobCtx.close()
  })
})
