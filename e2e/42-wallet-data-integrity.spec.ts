import { test, expect } from '@playwright/test'

const API = 'http://localhost:5173/api'

test.describe.configure({ mode: 'serial' })

/**
 * Wave D — server-side validation & data integrity.
 *   B-21 : account API rejects a non-numeric opening balance / bad type.
 *   CD-11: account name is validated on edit, not only on create.
 *   B-20 : a recurring rule can't be created with a far-past due date.
 *   B-09 : equal split is cent-exact and sums to the amount.
 */
test.describe('42 — Wallet data integrity', () => {
  async function signup(browser: import('@playwright/test').Browser, tag: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.request.post(`${API}/auth/signup`, { data: { username: `u_${tag}_${Date.now()}`, password: 'test-password' } })
    return { ctx, page }
  }

  test('B-21: account rejects a non-numeric opening balance and a bad type', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'acct')
    const bad1 = await page.request.post(`${API}/accounts`, {
      data: { name: 'Bad', type: 'cash', openingBalance: 'abc' },
    })
    expect(bad1.status()).toBe(400)

    const bad2 = await page.request.post(`${API}/accounts`, {
      data: { name: 'Bad', type: 'spaceship', openingBalance: 0 },
    })
    expect(bad2.status()).toBe(400)

    const good = await page.request.post(`${API}/accounts`, {
      data: { name: 'Good', type: 'cash', openingBalance: 10.5 },
    })
    expect(good.status()).toBe(201)
    await ctx.close()
  })

  test('CD-11: account name is validated on PATCH, not just create', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'name')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Real', type: 'cash', openingBalance: 0 },
    })).json()

    const blank = await page.request.patch(`${API}/accounts/${acct.id}`, { data: { name: '  ' } })
    expect(blank.status()).toBe(400)

    const ok = await page.request.patch(`${API}/accounts/${acct.id}`, { data: { name: 'Renamed' } })
    expect(ok.status()).toBe(200)
    await ctx.close()
  })

  test('B-20: recurring rule rejects a due date more than a year in the past', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'rec')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const bad = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: acct.id, amount: 50, merchant: 'Rent', type: 'expense', frequency: 'monthly', nextDueDate: '2020-01-01' },
    })
    expect(bad.status()).toBe(400)

    const good = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: acct.id, amount: 50, merchant: 'Rent', type: 'expense', frequency: 'monthly', nextDueDate: '2026-01-01' },
    })
    expect(good.status()).toBe(201)
    await ctx.close()
  })

  test('B-09: equal split is cent-exact and sums to the amount', async ({ browser }) => {
    // Alice + Bob group so the owner can split with a co-member.
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()
    const ts = Date.now()
    const bobName = `bob_split_${ts}`
    await alice.request.post(`${API}/auth/signup`, { data: { username: `alice_split_${ts}`, password: 'test-password' } })
    await bob.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })
    const bobMe = await (await bob.request.get(`${API}/auth/me`)).json()

    const group = await (await alice.request.post(`${API}/groups`, { data: { name: 'Split' } })).json()
    await alice.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await (await bob.request.get(`${API}/invites`)).json()
    await bob.request.post(`${API}/invites/${invites[0].id}/accept`)

    const acct = await (await alice.request.post(`${API}/accounts`, {
      data: { name: 'Alice Cash', type: 'cash', openingBalance: 0 },
    })).json()
    // 8.25 split two ways is 4.13 / 4.12 — must not drift or lose a cent.
    const txn = await (await alice.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: '2026-01-01', merchant: 'Snacks', amount: 8.25, type: 'expense', tag: '[]' },
    })).json()

    const shares = await (await alice.request.post(`${API}/transactions/${txn.id}/share`, {
      data: { recipientId: bobMe.user.id, splitMode: 'equal' },
    })).json()

    const amounts = shares.map((s: { share_amount: number }) => s.share_amount).sort((a: number, b: number) => b - a)
    expect(amounts).toEqual([4.13, 4.12])
    expect(Math.round((amounts[0] + amounts[1]) * 100) / 100).toBe(8.25)

    await aliceCtx.close()
    await bobCtx.close()
  })
})
