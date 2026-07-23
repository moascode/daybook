import { test, expect } from '@playwright/test'

const API = 'http://localhost:5173/api'

test.describe.configure({ mode: 'serial' })

/**
 * Wave A1 — settlement direction (B-01) and true partial settlement (B-02).
 * These paths had zero coverage, which is exactly where the bugs lived.
 */
test.describe('39 — Settlement direction & partial settlement', () => {
  // Sets up Alice + Bob in a group with a RM200 dinner split 100/100 (Bob owes
  // Alice RM100). Returns the request contexts, user ids, group id, and accounts.
  async function setup(browser: import('@playwright/test').Browser, tag: string) {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_${tag}_${ts}`
    const bobName = `bob_${tag}_${ts}`

    await alice.request.post(`${API}/auth/signup`, { data: { username: aliceName, password: 'test-password' } })
    await bob.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })
    const aliceMe = await (await alice.request.get(`${API}/auth/me`)).json()
    const bobMe = await (await bob.request.get(`${API}/auth/me`)).json()

    const group = await (await alice.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })).json()
    await alice.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await (await bob.request.get(`${API}/invites`)).json()
    await bob.request.post(`${API}/invites/${invites[0].id}/accept`)

    const aliceAcct = await (await alice.request.post(`${API}/accounts`, {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
    const bobAcct = await (await bob.request.post(`${API}/accounts`, {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    })).json()

    const txn = await (await alice.request.post(`${API}/transactions`, {
      data: { accountId: aliceAcct.id, date: '2026-01-01', merchant: 'Dinner', amount: 200, type: 'expense', tag: '[]' },
    })).json()
    await alice.request.post(`${API}/transactions/shares`, {
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

    return { aliceCtx, bobCtx, alice, bob, aliceId: aliceMe.user.id, bobId: bobMe.user.id, groupId: group.id, aliceAcct, bobAcct }
  }

  async function balanceAmount(page: import('@playwright/test').Page, groupId: string) {
    const balances = await (await page.request.get(`${API}/groups/${groupId}/balances`)).json()
    return balances.length === 0 ? 0 : Math.round(balances[0].amount)
  }

  async function acctBalance(page: import('@playwright/test').Page, accountId: string) {
    const balances = await (await page.request.get(`${API}/accounts/balances`)).json()
    const row = balances.find((b: { id: string; balance: number }) => b.id === accountId)
    return row ? Math.round(row.balance) : 0
  }

  test('B-01: creditor "Mark Received" clears the debt and credits (not debits) the creditor', async ({ browser }) => {
    const s = await setup(browser, 'recv')

    // Alice's account holds the RM200 dinner already, so capture the baseline.
    const before = await acctBalance(s.alice, s.aliceAcct.id)

    // Alice is owed RM100. She records receipt from Bob into her own account.
    const res = await s.alice.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, fromUserId: s.bobId, amount: 100, note: 'cash', toAccountId: s.aliceAcct.id },
    })
    expect(res.status()).toBe(201)

    // Debt is cleared.
    expect(await balanceAmount(s.alice, s.groupId)).toBe(0)

    // The settlement is INCOME for Alice: her balance went UP by 100. The pre-fix
    // bug booked an expense on the creditor's own account (balance would drop).
    const after = await acctBalance(s.alice, s.aliceAcct.id)
    expect(after - before).toBe(100)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-02: a partial payment leaves the remainder outstanding', async ({ browser }) => {
    const s = await setup(browser, 'part')

    // Bob owes RM100, pays RM40.
    const r1 = await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 40, fromAccountId: s.bobAcct.id },
    })
    expect(r1.status()).toBe(201)
    expect(await balanceAmount(s.bob, s.groupId)).toBe(60)

    // Pays the remaining RM60 → fully settled.
    const r2 = await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 60, fromAccountId: s.bobAcct.id },
    })
    expect(r2.status()).toBe(201)
    expect(await balanceAmount(s.bob, s.groupId)).toBe(0)

    // Bob cannot over-pay after the debt is cleared.
    const r3 = await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 20, fromAccountId: s.bobAcct.id },
    })
    expect(r3.status()).toBe(400)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-02: undoing a partial settlement restores exactly the paid amount', async ({ browser }) => {
    const s = await setup(browser, 'undo')

    await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 40, fromAccountId: s.bobAcct.id },
    })
    expect(await balanceAmount(s.bob, s.groupId)).toBe(60)

    const history = await (await s.bob.request.get(`${API}/settlements?groupId=${s.groupId}`)).json()
    const del = await s.bob.request.delete(`${API}/settlements/${history[0].id}`)
    expect(del.status()).toBe(204)

    // Back to the full RM100 owed.
    expect(await balanceAmount(s.bob, s.groupId)).toBe(100)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-01: over-paying is still capped at the outstanding amount', async ({ browser }) => {
    const s = await setup(browser, 'cap')

    const res = await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 500, fromAccountId: s.bobAcct.id },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message).toContain('100')
    expect(await balanceAmount(s.bob, s.groupId)).toBe(0)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })
})
