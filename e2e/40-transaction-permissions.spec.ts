import { test, expect } from '@playwright/test'

const API = 'http://localhost:5173/api'

test.describe.configure({ mode: 'serial' })

/**
 * Wave A2 — cross-tenant permission gaps in the transaction routes.
 *   B-03: PATCH must re-check write permission on a changed account.
 *   B-07: a transfer needs write permission on the destination account.
 */
test.describe('40 — Transaction write permissions', () => {
  async function setup(browser: import('@playwright/test').Browser, tag: string) {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()
    const ts = Date.now()
    const bobName = `bob_${tag}_${ts}`

    await alice.request.post(`${API}/auth/signup`, { data: { username: `alice_${tag}_${ts}`, password: 'test-password' } })
    await bob.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })

    const group = await (await alice.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })).json()
    await alice.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await (await bob.request.get(`${API}/invites`)).json()
    await bob.request.post(`${API}/invites/${invites[0].id}/accept`)

    const mkAcct = async (page: import('@playwright/test').Page, name: string) =>
      (await page.request.post(`${API}/accounts`, {
        data: { name, type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
      })).json()

    return { aliceCtx, bobCtx, alice, bob, groupId: group.id, mkAcct }
  }

  test('B-03: cannot move a transaction onto another user\'s private account', async ({ browser }) => {
    const s = await setup(browser, 'priv')
    const alicePrivate = await s.mkAcct(s.alice, 'Alice Private')
    const bobAcct = await s.mkAcct(s.bob, 'Bob Cash')

    const txn = await (await s.bob.request.post(`${API}/transactions`, {
      data: { accountId: bobAcct.id, date: '2026-02-01', merchant: 'Shop', amount: 5000, type: 'expense', tag: '[]' },
    })).json()

    const patch = await s.bob.request.patch(`${API}/transactions/${txn.id}`, {
      data: { accountId: alicePrivate.id },
    })
    expect(patch.status()).toBe(403)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-03: cannot move a transaction onto a read-only shared account', async ({ browser }) => {
    const s = await setup(browser, 'ro')
    const aliceRO = await s.mkAcct(s.alice, 'Alice Read-Only')
    await s.alice.request.post(`${API}/accounts/${aliceRO.id}/shares`, { data: { groupId: s.groupId, canWrite: false } })
    const bobAcct = await s.mkAcct(s.bob, 'Bob Cash')

    const txn = await (await s.bob.request.post(`${API}/transactions`, {
      data: { accountId: bobAcct.id, date: '2026-02-01', merchant: 'Shop', amount: 5000, type: 'expense', tag: '[]' },
    })).json()

    const patch = await s.bob.request.patch(`${API}/transactions/${txn.id}`, {
      data: { accountId: aliceRO.id },
    })
    expect(patch.status()).toBe(403)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-03: CAN move a transaction onto a writable shared account', async ({ browser }) => {
    const s = await setup(browser, 'rw')
    const aliceRW = await s.mkAcct(s.alice, 'Alice Joint')
    await s.alice.request.post(`${API}/accounts/${aliceRW.id}/shares`, { data: { groupId: s.groupId, canWrite: true } })
    const bobAcct = await s.mkAcct(s.bob, 'Bob Cash')

    const txn = await (await s.bob.request.post(`${API}/transactions`, {
      data: { accountId: bobAcct.id, date: '2026-02-01', merchant: 'Shop', amount: 20, type: 'expense', tag: '[]' },
    })).json()

    const patch = await s.bob.request.patch(`${API}/transactions/${txn.id}`, {
      data: { accountId: aliceRW.id },
    })
    expect(patch.status()).toBe(200)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-07: cannot transfer into a read-only shared account', async ({ browser }) => {
    const s = await setup(browser, 'trro')
    const aliceRO = await s.mkAcct(s.alice, 'Alice Savings')
    await s.alice.request.post(`${API}/accounts/${aliceRO.id}/shares`, { data: { groupId: s.groupId, canWrite: false } })
    const bobAcct = await s.mkAcct(s.bob, 'Bob Cash')

    const transfer = await s.bob.request.post(`${API}/transactions`, {
      data: {
        accountId: bobAcct.id, destinationAccountId: aliceRO.id,
        date: '2026-02-01', merchant: 'Transfer', amount: 100, type: 'transfer', tag: '[]',
      },
    })
    expect(transfer.status()).toBe(400)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })

  test('B-07: CAN transfer into a writable shared account', async ({ browser }) => {
    const s = await setup(browser, 'trrw')
    const aliceRW = await s.mkAcct(s.alice, 'Alice Joint')
    await s.alice.request.post(`${API}/accounts/${aliceRW.id}/shares`, { data: { groupId: s.groupId, canWrite: true } })
    const bobAcct = await s.mkAcct(s.bob, 'Bob Cash')

    const transfer = await s.bob.request.post(`${API}/transactions`, {
      data: {
        accountId: bobAcct.id, destinationAccountId: aliceRW.id,
        date: '2026-02-01', merchant: 'Transfer', amount: 100, type: 'transfer', tag: '[]',
      },
    })
    expect(transfer.status()).toBe(201)

    await s.aliceCtx.close()
    await s.bobCtx.close()
  })
})
