/**
 * B-15 residual (Wave F3): budget "spent" must use the caller's EFFECTIVE
 * share of a transaction — their own share_amount when they've split it,
 * not the full transaction amount.
 *
 * Scenario: Alice creates a RM200 Food & Drink expense and a budget on that
 * category. Spent should show ~200. She then splits the transaction 50/50
 * with Bob. Spent should drop to ~100 (her own share), never the full 200.
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test.describe('43 — Budget spending uses the effective split amount', () => {
  test('splitting an expense drops budget spend to the caller\'s own share', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_budget_eff_${ts}`
    const bobName = `bob_budget_eff_${ts}`

    await alicePage.request.post('http://localhost:5173/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('http://localhost:5173/api/auth/signup', { data: { username: bobName, password: 'test-password' } })

    // Alice + Bob in a group together
    const group = await alicePage.request.post('http://localhost:5173/api/groups', { data: { name: 'BudgetEffGroup' } }).then((r) => r.json()) as { id: string }
    await alicePage.request.post(`http://localhost:5173/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('http://localhost:5173/api/invites').then((r) => r.json()) as Array<{ id: string }>
    await bobPage.request.post(`http://localhost:5173/api/invites/${invites[0].id}/accept`)

    // Alice creates an account
    const acct = await alicePage.request.post('http://localhost:5173/api/accounts', {
      data: { name: 'Alice Budget Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    // Find the seeded "Food & Drink" category
    const categories = await alicePage.request.get('http://localhost:5173/api/categories').then((r) => r.json()) as Array<{ id: string; name: string }>
    const foodCategory = categories.find((c) => c.name === 'Food & Drink')!

    // Current-month expense of 200
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const txn = await alicePage.request.post('http://localhost:5173/api/transactions', {
      data: {
        accountId: acct.id,
        date: today,
        merchant: 'Dinner Split',
        amount: 200,
        type: 'expense',
        categoryId: foodCategory.id,
        tag: '[]',
      },
    }).then((r) => r.json()) as { id: string }

    // Budget on Food & Drink, limit well above 200 so no over-budget alert noise
    await alicePage.request.post('http://localhost:5173/api/budgets', {
      data: { categoryId: foodCategory.id, limitAmount: 1000 },
    })

    // Before splitting: budget row shows the full 200 spent
    await alicePage.goto('/wallet/budgets')
    await expect(alicePage.locator('main').getByRole('heading', { name: 'Budgets', exact: true })).toBeVisible({ timeout: 15_000 })
    const row = alicePage.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row.getByText(/RM\s?200\.00/)).toBeVisible({ timeout: 5000 })

    // Alice splits the transaction 50/50 with Bob (100 each)
    const members = await alicePage.request.get('http://localhost:5173/api/groups/members').then((r) => r.json()) as Array<{ user_id: string; username: string }>
    const bobId = members.find((m) => m.username === bobName)!.user_id
    await alicePage.request.post(`http://localhost:5173/api/transactions/${txn.id}/share`, {
      data: { recipientId: bobId, splitMode: 'equal' },
    })

    // After splitting: spent reflects Alice's own RM100 share, not the full RM200
    await alicePage.goto('/wallet/budgets')
    await expect(alicePage.locator('main').getByRole('heading', { name: 'Budgets', exact: true })).toBeVisible({ timeout: 15_000 })
    const rowAfter = alicePage.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
    await expect(rowAfter).toBeVisible({ timeout: 10_000 })
    await expect(rowAfter.getByText(/RM\s?100\.00/)).toBeVisible({ timeout: 5000 })
    await expect(rowAfter.getByText(/RM\s?200\.00/)).not.toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })
})
