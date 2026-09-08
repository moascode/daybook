/**
 * 86 — The three phone regressions found after R17 shipped.
 *
 * Every one of them is invisible at desktop width, which is exactly why R17's
 * own specs (84, 85) missed them: they all run at the default viewport.
 *
 *  1. The bulk-action bar rendered UNDER the mobile tab bar (fixed, bottom:0,
 *     z-50) — a selection on a phone looked like it had no actions at all.
 *  2. The notifications bell disappeared, because the rule hiding the app
 *     bar's quick-add matched `.circle-btn:first-of-type` and R17 gave each
 *     button its own `.pop-anchor` wrapper, making BOTH of them first.
 *  3. Quick add did nothing: the app bar's `+` is hidden on a phone by design
 *     ("quick-add lives in the FAB") and the FAB was never wired past R2's
 *     "isn't wired up yet" toast.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { signUpOnPage, waitForApp, businessToday, navigateToImportCsv } from './helpers'

const PHONE = { width: 390, height: 844 }

async function phonePage(browser: Browser, path = '/wallet'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: PHONE })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto(path)
  await waitForApp(page)
  return page
}

test.describe('phone shell', () => {
  test('the notifications bell survives the quick-add hiding rule', async ({ browser }) => {
    const page = await phonePage(browser, '/tasks')

    await expect(page.getByTestId('notifications-bell')).toBeVisible()
    // ...and quick-add is still the one that stands down, since the FAB is it.
    await expect(page.getByTestId('quick-add')).toBeHidden()
    await expect(page.getByTestId('fab-quick-add')).toBeVisible()

    await page.context().close()
  })

  test('the FAB is quick add, not a placeholder toast', async ({ browser }) => {
    const page = await phonePage(browser)
    await page.request.post('/api/accounts', { data: { name: 'Main', type: 'bank' } })
    await page.reload()
    await waitForApp(page)

    await page.getByTestId('fab-quick-add').click()
    await expect(page.getByTestId('fab-quick-add-menu')).toHaveClass(/open/)
    await page.locator('[data-testid="fab-quick-add-item"][data-action="income"]').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Income', pressed: true })).toBeVisible()

    await page.context().close()
  })

  test('the bulk-action bar clears the tab bar instead of hiding behind it', async ({ browser }) => {
    const page = await phonePage(browser)
    const account = await (await page.request.post('/api/accounts', { data: { name: 'Main', type: 'bank' } })).json()
    await page.request.post('/api/transactions', {
      data: { accountId: account.id, date: businessToday(), merchant: 'Kopitiam', amount: 12, type: 'expense' },
    })
    await page.reload()
    await waitForApp(page)

    await page.locator('[data-testid="transaction-row"]').first().locator('input[type="checkbox"]').click()

    const bar = page.getByTestId('bulk-action-bar')
    await expect(bar).toBeVisible()
    // Every action has to be reachable, not merely present: a bar drawn
    // underneath the tab bar passes `toBeVisible` (it has a box and is not
    // display:none) while being untappable, so assert the geometry instead.
    const barBox = (await bar.boundingBox())!
    const tabBox = (await page.locator('.tabbar').boundingBox())!
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabBox.y + 1)

    // The FAB overlaps the bar's band, so it stands down while a selection is up.
    await expect(page.getByTestId('fab-quick-add')).toBeHidden()

    // And the actions actually fit the 390px screen rather than overflowing it.
    for (const id of ['bulk-edit-btn', 'bulk-split-btn', 'bulk-delete-btn', 'bulk-export-btn']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
    }

    await page.context().close()
  })

  test('the CSV review bar clears the tab bar too', async ({ browser }) => {
    const page = await phonePage(browser)
    await page.request.post('/api/accounts', { data: { name: 'Main', type: 'bank' } })
    await page.reload()
    await waitForApp(page)

    // /wallet/import is review-only — the rows arrive as router state from the
    // in-page modal, so drive the real path rather than deep-linking.
    await navigateToImportCsv(page)
    await page.evaluate(async (content) => {
      await window.__testCsvFileSelect(new File([content], 'statement.csv', { type: 'text/csv' }))
    }, `Date,Merchant,Amount\n${businessToday()},Kopitiam,-12.00\n`)
    await page.getByRole('button', { name: 'Review rows' }).click()
    await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })

    const bar = page.getByTestId('import-bulk-action-bar')
    await expect(bar).toBeVisible()
    const barBox = (await bar.boundingBox())!
    const tabBox = (await page.locator('.tabbar').boundingBox())!
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabBox.y + 1)
    await expect(page.getByTestId('import-confirm-btn')).toBeVisible()

    await page.context().close()
  })
})
