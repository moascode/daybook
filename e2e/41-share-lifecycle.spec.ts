import { test, expect } from '@playwright/test'

const API = 'http://localhost:5173/api'

test.describe.configure({ mode: 'serial' })

/**
 * Wave B — protecting settled splits and account deletion.
 *   B-04: can't re-split a transaction whose shares are (partly) settled.
 *   B-05: can't delete an account that carries live debts or others' rows.
 *   B-06: can't change the amount of a transaction with settled splits.
 *   B-08: share-status reports "Keep as-is" (recipient-only) shares.
 */
test.describe('41 — Settled-share lifecycle', () => {
  async function setup(browser: import('@playwright/test').Browser, tag: string) {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()
    const ts = Date.now()
    const bobName = `bob_${tag}_${ts}`
    await alice.request.post(`${API}/auth/signup`, { data: { username: `alice_${tag}_${ts}`, password: 'test-password' } })
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
      data: { transactions: [{ transactionId: txn.id, shares: [
        { userId: aliceMe.user.id, shareAmount: 100, note: '' },
        { userId: bobMe.user.id, shareAmount: 100, note: '' },
      ] }] },
    })

    return { aliceCtx, bobCtx, alice, bob, aliceId: aliceMe.user.id, bobId: bobMe.user.id, groupId: group.id, aliceAcct, bobAcct, txn }
  }

  async function bobSettles(s: Awaited<ReturnType<typeof setup>>) {
    const r = await s.bob.request.post(`${API}/settlements`, {
      data: { groupId: s.groupId, toUserId: s.aliceId, amount: 100, fromAccountId: s.bobAcct.id },
    })
    expect(r.status()).toBe(201)
  }

  test('B-04: cannot re-split a transaction after it has been settled', async ({ browser }) => {
    const s = await setup(browser, 'resplit')
    await bobSettles(s)

    const bulk = await s.alice.request.post(`${API}/transactions/shares`, {
      data: { transactions: [{ transactionId: s.txn.id, shares: [
        { userId: s.aliceId, shareAmount: 150, note: '' },
        { userId: s.bobId, shareAmount: 50, note: '' },
      ] }] },
    })
    expect(bulk.status()).toBe(409)

    const single = await s.alice.request.post(`${API}/transactions/${s.txn.id}/share`, {
      data: { recipientId: s.bobId, splitMode: 'none' },
    })
    expect(single.status()).toBe(409)

    await s.aliceCtx.close(); await s.bobCtx.close()
  })

  test('B-06: cannot change the amount of a settled split', async ({ browser }) => {
    const s = await setup(browser, 'amt')
    await bobSettles(s)

    const patch = await s.alice.request.patch(`${API}/transactions/${s.txn.id}`, { data: { amount: 80 } })
    expect(patch.status()).toBe(409)

    await s.aliceCtx.close(); await s.bobCtx.close()
  })

  test('B-06: rejects an amount too small to keep every split positive (unsettled)', async ({ browser }) => {
    const s = await setup(browser, 'tiny')
    // Not settled yet; two shares → amount must stay >= 0.02.
    const patch = await s.alice.request.patch(`${API}/transactions/${s.txn.id}`, { data: { amount: 0.01 } })
    expect(patch.status()).toBe(400)

    await s.aliceCtx.close(); await s.bobCtx.close()
  })

  test('B-05: cannot delete an account with an outstanding split; can after settling', async ({ browser }) => {
    const s = await setup(browser, 'del')

    const before = await s.alice.request.delete(`${API}/accounts/${s.aliceAcct.id}`)
    expect(before.status()).toBe(409)

    await bobSettles(s)

    const after = await s.alice.request.delete(`${API}/accounts/${s.aliceAcct.id}`)
    expect(after.status()).toBe(204)

    await s.aliceCtx.close(); await s.bobCtx.close()
  })

  test('B-08: share-status reports a "Keep as-is" (recipient-only) share to the owner', async ({ browser }) => {
    const s = await setup(browser, 'status')
    // Fresh transaction shared "keep as-is": only Bob's row is written.
    const txn2 = await (await s.alice.request.post(`${API}/transactions`, {
      data: { accountId: s.aliceAcct.id, date: '2026-01-02', merchant: 'Taxi', amount: 30, type: 'expense', tag: '[]' },
    })).json()
    await s.alice.request.post(`${API}/transactions/${txn2.id}/share`, {
      data: { recipientId: s.bobId, splitMode: 'none' },
    })

    const status = await (await s.alice.request.post(`${API}/transactions/shares/status`, {
      data: { transactionIds: [txn2.id] },
    })).json()
    expect(status).toEqual([{ transactionId: txn2.id, hasShares: true }])

    await s.aliceCtx.close(); await s.bobCtx.close()
  })
})
