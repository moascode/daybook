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

test.describe('23 — Household groups, invites, memberships', () => {
  test('Alice creates a group and invites Bob; Bob accepts', async ({ browser }) => {
    const aliceName = `alice_hh_${Date.now()}`
    const bobName = `bob_hh_${Date.now()}`

    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/household')
    const { page: bob, ctx: bobCtx } = await signUpAndGoTo(browser, bobName, '/household')

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

    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/household')
    const { page: charlie, ctx: charlieCtx } = await signUpAndGoTo(browser, charlieName, '/household')

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

    // Charlie declines (second button in the invite row is the X/decline)
    await charlie.locator('.rounded-lg.border.border-blue-100 button').nth(1).click()

    // Invite section disappears
    await expect(charlie.getByText('Pending invitations')).not.toBeVisible()

    await aliceCtx.close()
    await charlieCtx.close()
  })

  test('User sees no groups when not a member of any', async ({ browser }) => {
    const aliceName = `alice_hh3_${Date.now()}`
    const { page: alice, ctx: aliceCtx } = await signUpAndGoTo(browser, aliceName, '/household')

    // Alice has no groups — empty state
    await expect(alice.getByText('No groups yet')).toBeVisible()

    await aliceCtx.close()
  })
})
