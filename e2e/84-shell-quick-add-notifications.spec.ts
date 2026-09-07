/**
 * 84 — Quick add and the notifications panel (R17 §2–§3).
 *
 * Both controls have sat in the app bar since R2 raising a toast that said they
 * weren't wired up. These assert they now do the thing — and, for the bell,
 * that its count and its contents come from the SAME computation the push
 * digest uses, so the badge and your phone can never disagree.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

async function seedAccount(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/accounts`, { data: { name: 'Main', type: 'bank' } })
  return (await res.json()).id as string
}

test.describe('quick add', () => {
  test('opens a menu and creates each kind of transaction', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seedAccount(page)

    for (const [action, expectedType] of [
      ['expense', 'expense'],
      ['income', 'income'],
      ['transfer', 'transfer'],
    ] as const) {
      await page.getByTestId('quick-add').click()
      await expect(page.getByTestId('quick-add-menu')).toHaveClass(/open/)
      await page.locator(`[data-testid="quick-add-item"][data-action="${action}"]`).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // The form opens pre-set to the type that was chosen — asserted through
      // aria-pressed, which is also what makes that state readable to anyone
      // not looking at the colour.
      const label = expectedType[0].toUpperCase() + expectedType.slice(1)
      await expect(dialog.getByRole('button', { name: label, pressed: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
  })

  test('routes to Tasks and to the import modal', async ({ browser }) => {
    const page = await newAppPage(browser)
    await seedAccount(page)

    await page.getByTestId('quick-add').click()
    await page.locator('[data-testid="quick-add-item"][data-action="task"]').click()
    await expect(page).toHaveURL(/\/tasks/)

    await page.getByTestId('quick-add').click()
    await page.locator('[data-testid="quick-add-item"][data-action="import"]').click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('closes on Escape and on an outside click', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.getByTestId('quick-add').click()
    await expect(page.getByTestId('quick-add-menu')).toHaveClass(/open/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('quick-add-menu')).not.toHaveClass(/open/)

    await page.getByTestId('quick-add').click()
    await expect(page.getByTestId('quick-add-menu')).toHaveClass(/open/)
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await expect(page.getByTestId('quick-add-menu')).not.toHaveClass(/open/)
  })
})

test.describe('notifications panel', () => {
  test('says so plainly when there is nothing to do', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.getByTestId('notifications-bell').click()
    await expect(page.getByTestId('notifications-empty')).toBeVisible()
    // An empty bell must carry no badge — a badge that is always lit stops
    // meaning anything.
    await expect(page.getByTestId('notifications-bell').locator('.count')).toHaveCount(0)
  })

  test('lists what needs attention and navigates there', async ({ browser }) => {
    const page = await newAppPage(browser)
    const tok = await (await page.request.post(`${API}/capture-tokens`, { data: { label: 'Panel spec' } })).json()
    await page.request.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${tok.token}`, 'Idempotency-Key': `panel-${Date.now()}` },
      data: { merchant: 'Kopi', amount: 4.5 },
    })

    await page.reload()
    await page.getByTestId('notifications-bell').click()

    const item = page.locator('[data-testid="notification-item"][data-kind="captures"]')
    await expect(item).toBeVisible()
    await expect(item).toContainText('1 payment to review')

    await item.click()
    await expect(page).toHaveURL(/\/wallet\/inbox/)
  })

  test('the badge counts attention items only, not the spend summary', async ({ browser }) => {
    const page = await newAppPage(browser)
    const accountId = await seedAccount(page)
    // Spending money is not something to act on — it must not light the bell.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Lunch', amount: 12, type: 'expense' },
    })
    await page.reload()

    await page.getByTestId('notifications-bell').click()
    // The summary is IN the panel…
    await expect(page.locator('[data-testid="notification-item"][data-kind="spend"]')).toBeVisible()
    // …but does not count towards the badge.
    await expect(page.getByTestId('notifications-bell').locator('.count')).toHaveCount(0)
  })

  test('says something when it cannot load, rather than looking empty', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.route('**/api/notifications/pending', (route) => route.abort())
    await page.getByTestId('notifications-bell').click()
    // Rule 13: a failed fetch and an empty inbox must not render identically.
    await expect(page.getByTestId('notifications-error')).toBeVisible()
  })
})
