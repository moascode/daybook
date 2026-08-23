/**
 * Budget "spent" tracks the caller's EFFECTIVE amount — the ledger amount less
 * whatever others have actually settled on it.
 *
 * ⚠️ BEHAVIOUR CHANGED 2026-07-28 (docs/split-settlement-plan.md, owner decision
 * §9.1). This file previously asserted that splitting an expense *immediately*
 * dropped budget spend to the caller's own share — accrual accounting. The owner
 * reversed that: "it's all in the payer's expense until it is settled; when they
 * settle, the expense is lower based on the settled amount." Splitting alone now
 * changes nothing; only money coming back does.
 *
 * The scenario below is the same one, extended through settlement so both halves
 * of the rule are covered rather than just the new one:
 *   RM200 expense  →  split 50/50  →  still 200  →  Bob settles 100  →  100.
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = '/api'

test.describe('43 — Budget spending uses the effective split amount', () => {
  test('budget spend falls when a split is settled, not when it is created', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_budget_eff_${ts}`
    const bobName = `bob_budget_eff_${ts}`

    await alicePage.request.post(`${API}/auth/signup`, { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })
    const aliceId = await alicePage.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)

    // Alice + Bob in a group together
    const group = await alicePage.request.post(`${API}/groups`, { data: { name: 'BudgetEffGroup' } }).then((r) => r.json()) as { id: string }
    await alicePage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get(`${API}/invites`).then((r) => r.json()) as Array<{ id: string }>
    await bobPage.request.post(`${API}/invites/${invites[0].id}/accept`)

    const acct = await alicePage.request.post(`${API}/accounts`, {
      data: { name: 'Alice Budget Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    const categories = await alicePage.request.get(`${API}/categories`).then((r) => r.json()) as Array<{ id: string; name: string }>
    const foodCategory = categories.find((c) => c.name === 'Food & Drink')!

    // Current-month expense of 200
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const txn = await alicePage.request.post(`${API}/transactions`, {
      data: {
        accountId: acct.id, date: today, merchant: 'Dinner Split', amount: 200,
        type: 'expense', categoryId: foodCategory.id, tag: '[]',
      },
    }).then((r) => r.json()) as { id: string }

    await alicePage.request.post(`${API}/budgets`, {
      data: { categoryId: foodCategory.id, limitAmount: 1000 },
    })

    const budgetRow = async () => {
      await alicePage.goto('/wallet/budgets')
      await expect(alicePage.locator('main').getByRole('heading', { name: 'Budgets', exact: true }))
        .toBeVisible({ timeout: 15_000 })
      const row = alicePage.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
      await expect(row).toBeVisible({ timeout: 10_000 })
      return row
    }

    // ── Before splitting: the full 200 ──
    await expect((await budgetRow()).getByText(/RM\s?200\.00/)).toBeVisible({ timeout: 5000 })

    // ── Split 50/50 — and nothing changes (§9.1) ──
    const members = await alicePage.request.get(`${API}/groups/members`).then((r) => r.json()) as Array<{ user_id: string; username: string }>
    const bobId = members.find((m) => m.username === bobName)!.user_id
    await alicePage.request.post(`${API}/transactions/${txn.id}/split`, {
      data: { recipientId: bobId, splitMode: 'equal' },
    })

    const afterSplit = await budgetRow()
    await expect(afterSplit.getByText(/RM\s?200\.00/)).toBeVisible({ timeout: 5000 })
    await expect(afterSplit.getByText(/RM\s?100\.00/)).not.toBeVisible()

    // ── Bob settles his RM100 — now it drops ──
    const bobAcct = await bobPage.request.post(`${API}/accounts`, {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    // Two-step since W4: Bob records the payment out of his own account, Alice
    // confirms it into hers. Neither needs the other's account shared.
    const settle = await bobPage.request.post(`${API}/settlements`, {
      data: { groupId: group.id, toUserId: aliceId, amount: 100, fromAccountId: bobAcct.id },
    })
    expect(settle.ok()).toBeTruthy()
    const settlementId = (await settle.json()).id as string
    // Alice's budget must not move on the claim alone — only on her confirmation.
    await expect((await budgetRow()).getByText(/RM\s?200\.00/)).toBeVisible({ timeout: 5000 })
    const confirm = await alicePage.request.post(`${API}/settlements/${settlementId}/confirm`, {
      data: { accountId: acct.id },
    })
    expect(confirm.ok()).toBeTruthy()

    const afterSettle = await budgetRow()
    await expect(afterSettle.getByText(/RM\s?100\.00/)).toBeVisible({ timeout: 5000 })
    await expect(afterSettle.getByText(/RM\s?200\.00/)).not.toBeVisible()

    await aliceCtx.close()
    await bobCtx.close()
  })
})
