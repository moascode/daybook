/**
 * U-16: first-run onboarding — dismissible WelcomeCards.
 * A brand-new account sees an orientation card at the top of each empty module
 * (Tasks / Wallet / Sharing). Dismissing one persists per-user so it never
 * returns, and the cards are independent of one another.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, waitForApp } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks/lists/unsorted')
})

test.afterAll(async () => {
  await page.context().close()
})

test('Tasks shows a welcome card on the empty outline', async () => {
  await expect(page.getByTestId('welcome-card-onboarding_dismissed_tasks')).toBeVisible()
})

test('dismissing the Tasks card hides it and persists across reload', async () => {
  const card = page.getByTestId('welcome-card-onboarding_dismissed_tasks')
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toHaveCount(0)

  // Give the background settings write a moment, then reload.
  await page.waitForTimeout(400)
  await page.reload()
  await waitForApp(page)

  await expect(page.getByTestId('welcome-card-onboarding_dismissed_tasks')).toHaveCount(0)
})

test('Wallet shows its own welcome card when there are no accounts', async () => {
  await page.goto('/wallet')
  await waitForApp(page)
  await expect(page.getByTestId('welcome-card-onboarding_dismissed_wallet')).toBeVisible()
})

test('the Wallet and Sharing cards are independent of the dismissed Tasks card', async () => {
  // Tasks was dismissed; Wallet's card is still up (asserted above). Sharing too.
  await page.goto('/settings/sharing')
  await waitForApp(page)
  await expect(page.getByTestId('welcome-card-onboarding_dismissed_sharing')).toBeVisible()
})

test('dismissing the Sharing card leaves the Wallet card intact', async () => {
  const sharing = page.getByTestId('welcome-card-onboarding_dismissed_sharing')
  await sharing.getByRole('button', { name: 'Dismiss' }).click()
  await expect(sharing).toHaveCount(0)
  await page.waitForTimeout(400)

  await page.goto('/wallet')
  await waitForApp(page)
  await expect(page.getByTestId('welcome-card-onboarding_dismissed_wallet')).toBeVisible()
})
