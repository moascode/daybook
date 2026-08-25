/**
 * App: mobile-responsive layout — Tier 3 feature.
 * Verifies the app is fully usable on a 390 × 844 mobile viewport
 * (iPhone 14 logical resolution) with no horizontal overflow.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { waitForApp, signUpOnPage, fillAccountForm, fillTransactionForm, navTo, navItem } from './helpers'

const MOBILE_VIEWPORT = { width: 390, height: 844 }
// Short viewport for modal/drawer scroll checks (Wave 2 — B3/C11)
const SHORT_MOBILE_VIEWPORT = { width: 390, height: 600 }

// ── No horizontal overflow ─────────────────────────────────────────────

test('tasks page renders without horizontal scroll on 390 px viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // 1 px tolerance for sub-pixel rounding
  await ctx.close()
})

test('wallet page renders without horizontal scroll on 390 px viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet')
  await waitForApp(page)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  await ctx.close()
})

// ── Navigation accessible on mobile ───────────────────────────────────

test('main navigation is accessible on mobile (hamburger menu or visible nav links)', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  // On mobile the sidebar may collapse to a hamburger toggle
  const hasHamburger = await navItem(page, 'menu-open')
    .isVisible()
    .catch(() => false)
  const hasNavLinks = await navItem(page, 'tasks').isVisible().catch(() => false)

  expect(hasHamburger || hasNavLinks).toBeTruthy()
  await ctx.close()
})

test('tapping the mobile menu button reveals the module sidebar drawer', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet')
  await waitForApp(page)

  // R2: Tasks/Wallet live in the always-visible bottom tab bar now, not the
  // drawer, so this checks the MODULE'S OWN nav (something only the drawer
  // reveals) rather than nav-tasks/nav-wallet. The `<aside class="sidebar">`
  // is always in the DOM (translated off-screen when closed, per the ported
  // CSS), so this asserts on the `.open` class and real clickability
  // (toBeInViewport) rather than plain visibility, which a transform-hidden
  // element can still satisfy.
  const hamburger = navItem(page, 'menu-open')
  const isHamburgerVisible = await hamburger.isVisible().catch(() => false)
  const sidebar = page.locator('.sidebar')

  if (isHamburgerVisible) {
    await expect(sidebar).not.toHaveClass(/\bopen\b/)
    await hamburger.click()
    await expect(sidebar).toHaveClass(/\bopen\b/)
    await expect(navItem(page, 'budgets')).toBeInViewport()
  } else {
    // If no hamburger at this width, the sidebar must already be on screen.
    await expect(navItem(page, 'budgets')).toBeInViewport()
  }
  await ctx.close()
})

// ── Core interactions work on mobile ──────────────────────────────────

test('can add a task on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks/lists/unsorted')
  await waitForApp(page)

  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Mobile task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Mobile task' }),
  ).toBeVisible()
  await ctx.close()
})

test('wallet "Add Transaction" button is tappable on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet')
  await waitForApp(page)

  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await ctx.close()
})

// ── Readable font size ─────────────────────────────────────────────────

test('task content text is at least 14 px on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks/lists/unsorted')
  await waitForApp(page)

  // Add a task so there is something to measure
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.keyboard.type('Font size check')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)

  const fontSize = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Task content"]')
    if (!el) return 0
    return parseFloat(getComputedStyle(el).fontSize)
  })
  expect(fontSize).toBeGreaterThanOrEqual(14)
  await ctx.close()
})

// ── Wave 2 (Phase 5c): modal scroll, dashboard reflow, drawer scroll ───

test('transaction form Type and Save are both reachable on a short mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: SHORT_MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet/accounts')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Mobile Cash' })

  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Type toggle at the top of the form is on screen
  await expect(dialog.getByRole('button', { name: 'Expense' })).toBeVisible()

  // The dialog itself must not extend beyond the viewport (B3 max-height)
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_MOBILE_VIEWPORT.height + 1)

  // Save at the bottom is reachable by scrolling inside the dialog
  const save = dialog.getByRole('button', { name: /Add Transaction/ })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeVisible()
  await ctx.close()
})

test('dashboard reflows without horizontal scroll at 390 px with chart data', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet/accounts')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Dash Cash' })

  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { amount: '80', merchant: 'Market' })
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { type: 'Income', amount: '3200', merchant: 'Salary' })

  await page.goto('/wallet/dashboard')
  await waitForApp(page)
  // Wait for the dashboard to have actually rendered its data before measuring:
  // the hero is the last thing to settle, and measuring an empty page would
  // pass no matter how badly a populated one overflows.
  await expect(page.getByTestId('spend-hero')).toBeVisible()
  await expect(page.getByTestId('merchant-table')).toBeVisible()

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  await ctx.close()
})

test('sidebar drawer keeps Settings reachable on a short mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: SHORT_MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  // /wallet's module sidebar has the full 7-item grouped nav — the long-list case (C11)
  await page.goto('/wallet')
  await waitForApp(page)
  await navTo(page, 'menu-open')

  // Settings is pinned below the scrollable nav and stays fully on screen
  const settings = navItem(page, 'settings')
  await expect(settings).toBeVisible()
  const box = await settings.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_MOBILE_VIEWPORT.height + 1)

  // The nav list itself scrolls, so the last wallet sub-item ("Analyse" group,
  // Reports) is reachable too. Import CSV no longer lives in the sidebar
  // (moved to the account menu — see 23-wallet-navigation.spec.ts).
  const reportsLink = navItem(page, 'reports')
  await reportsLink.scrollIntoViewIfNeeded()
  await expect(reportsLink).toBeVisible()
  await ctx.close()
})
