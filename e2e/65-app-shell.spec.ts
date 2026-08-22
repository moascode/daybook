/**
 * R2 — the v2 app shell: app bar (module tabs, search, quick-add, bell,
 * account menu), module-scoped sidebar, mobile bottom tab bar + FAB.
 * See docs/v2/foundation/03-app-shell.md.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, waitForApp, signUpOnPage, businessDatePlus, bulletNodeFor } from './helpers'

test.describe('module tabs', () => {
  test('Tasks and Wallet tabs navigate and mark the active module', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const tasksTab = page.getByTestId('nav-tasks').locator('visible=true')
    const walletTab = page.getByTestId('nav-wallet').locator('visible=true')

    await expect(tasksTab).toHaveAttribute('aria-current', 'page')
    await expect(walletTab).not.toHaveAttribute('aria-current', 'page')

    await walletTab.click()
    await expect(page).toHaveURL(/\/wallet$/)
    await expect(walletTab).toHaveAttribute('aria-current', 'page')
    await expect(tasksTab).not.toHaveAttribute('aria-current', 'page')
  })

  test('Day and Trips tabs are disabled and do not navigate', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // Both AppBar and MobileTabBar render a "modtab-day"/"modtab-trips" copy
    // (only one visible per viewport) — same duplicate-testid convention as
    // nav-tasks/nav-wallet (context map / e2e/helpers.ts navItem).
    const dayTab = page.getByTestId('modtab-day').locator('visible=true')
    const tripsTab = page.getByTestId('modtab-trips').locator('visible=true')

    await expect(dayTab).toHaveAttribute('aria-disabled', 'true')
    await expect(tripsTab).toHaveAttribute('aria-disabled', 'true')
    await expect(dayTab).toContainText('Coming soon')

    // Neither renders as a link (no href) — clicking must not change the route.
    await dayTab.click({ force: true })
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('the Tasks tab shows a live overdue+due-today count', async ({ browser }) => {
    // This test does more server round-trips than most (task create + update
    // + a full reload, which itself fires the shell's whole badge-poll burst
    // on top of the normal boot sequence) — local D1/miniflare has shown
    // itself to be tight on the default 45s budget under that load; give it
    // real headroom rather than a flaky pass/fail line.
    test.setTimeout(90_000)
    const page = await newAppPage(browser, '/tasks')

    // No tasks yet — no badge.
    const tasksTab = page.getByTestId('nav-tasks').locator('visible=true')
    await expect(tasksTab.locator('.count')).toHaveCount(0)

    // Seed one overdue task, then reload so the shell's badge poll (fires once
    // on mount) picks it up — it only re-polls every 60s otherwise.
    await page.getByRole('button', { name: 'New task' }).first().click()
    await page.keyboard.type('Overdue badge check')
    await page.getByRole('textbox', { name: 'Task content' }).last().blur()
    await page.waitForTimeout(500)

    const node = bulletNodeFor(page, 'Overdue badge check')
    const taskId = await node.getAttribute('data-task-id')
    await page.evaluate(
      ({ id, dueDate }: { id: string; dueDate: string }) => window.__testUpdateTask(id, { dueDate }),
      { id: taskId, dueDate: businessDatePlus(-2) },
    )
    await page.waitForTimeout(400)

    await page.reload()
    await waitForApp(page)
    await expect(tasksTab.locator('.count')).toHaveText('1')
  })
})

test.describe('account menu', () => {
  test('opens, slides to the settings pane, and back again', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const trigger = page.getByTestId('account-menu-button')
    await trigger.click()
    // "Settings & privacy" also appears as the settings pane's heading (hidden
    // until that pane is shown) — the root pane's menu-wide BUTTON is the one
    // unambiguous match while both panes exist in the DOM simultaneously.
    await expect(page.getByRole('button', { name: 'Settings & privacy' })).toBeVisible()

    await page.getByTestId('account-menu-settings').click()
    await expect(page.getByText('Module settings')).toBeVisible()
    await expect(page.getByText('Preferences')).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('Log out')).toBeVisible()
  })

  test('closes on outside click and Escape', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('account-menu-button').click()
    await expect(page.getByText('Log out')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Log out')).toBeHidden()

    await page.getByTestId('account-menu-button').click()
    await expect(page.getByText('Log out')).toBeVisible()
    // Click the page content area — guaranteed outside the appbar/menu-panel.
    await page.locator('main').click({ position: { x: 20, y: 20 } })
    await expect(page.getByText('Log out')).toBeHidden()
  })
})

test.describe('search field', () => {
  test('focuses without navigating or opening anything', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const search = page.getByLabel('Search across all modules')
    await search.click()
    await expect(search).toBeFocused()
    await search.fill('groceries')
    await expect(page).toHaveURL(/\/tasks$/)
  })
})

test.describe('responsive chrome', () => {
  test('mobile tab bar and FAB show at 390px, hidden at 1440px', async ({ browser }: { browser: Browser }) => {
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const mobilePage = await mobileCtx.newPage()
    await signUpOnPage(mobilePage)
    await mobilePage.goto('/tasks')
    await waitForApp(mobilePage)

    await expect(mobilePage.getByTestId('fab-quick-add')).toBeVisible()
    await expect(mobilePage.locator('.tabbar')).toBeVisible()
    await mobileCtx.close()

    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const desktopPage = await desktopCtx.newPage()
    await signUpOnPage(desktopPage)
    await desktopPage.goto('/tasks')
    await waitForApp(desktopPage)

    await expect(desktopPage.getByTestId('fab-quick-add')).toBeHidden()
    await expect(desktopPage.locator('.tabbar')).toBeHidden()
    await desktopCtx.close()
  })
})
