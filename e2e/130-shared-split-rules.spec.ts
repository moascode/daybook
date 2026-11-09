/**
 * Wallet → Shared "Split rules" card reads the caller's real rules
 * (worker/routes/rules.ts) instead of the old hardcoded mockup rows.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

test('Shared split-rules card lists enabled split rules and links to Settings', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet')
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  const otherName = `ssr_other_${Date.now()}`
  await other.request.post(`${API}/auth/signup`, { data: { username: otherName, password: 'test-password' } })
  const otherMe = await other.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }
  const group = await page.request.post(`${API}/groups`, { data: { name: 'G_ssr' } }).then((r) => r.json()) as { id: string }
  await page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: otherName } })
  const invites = await other.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await other.request.post(`${API}/invites/${invites[0].id}/accept`)

  await page.goto('/wallet/shared')
  const card = page.getByTestId('split-rules')
  await expect(card.getByTestId('split-rules-empty')).toBeVisible()
  await expect(card).not.toContainText('Rent & utilities')

  await page.request.post(`${API}/rules`, {
    data: { name: 'Groceries SSR', matchMerchant: 'Jaya', splitUserId: otherMe.user.id, splitPercent: 40 },
  })
  const off = await page.request.post(`${API}/rules`, {
    data: { name: 'Disabled SSR', matchMerchant: 'Off', splitUserId: otherMe.user.id, splitPercent: 50 },
  }).then((r) => r.json()) as { id: string }
  await page.request.patch(`${API}/rules/${off.id}`, { data: { enabled: false } })
  // A rule without a split is not a split rule.
  await page.request.post(`${API}/rules`, { data: { name: 'Tag only SSR', matchMerchant: 'Tag', addTags: ['x'] } })

  await page.reload()
  const rows = card.getByTestId('split-rule-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Groceries SSR')
  await expect(rows.first()).toContainText(`${otherName} pays 40%`)

  await card.getByTestId('split-rules-manage').click()
  await expect(page).toHaveURL(/\/settings\/wallet$/)

  await otherCtx.close()
  await page.context().close()
})
