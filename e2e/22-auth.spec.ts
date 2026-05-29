/**
 * Phase 4 auth — signup, login, logout, and the unauthenticated gate.
 * Each test drives the auth screen directly rather than via newAppPage (which
 * auto-signs-up), so it works against a raw, logged-out browser context.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, fillAccountForm, accountCardFor, bulletNodeFor } from './helpers'

const unique = () => `e2e_auth_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

test('unauthenticated visit shows the sign-in screen, not the app', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Daybook' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  // The app shell (sidebar/main nav) must not be reachable while logged out.
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveCount(0)
  await context.close()
})

test('sign up creates an account and lands in the app', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Username').fill(unique())
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Lands in the app: the main content area renders.
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
  await context.close()
})

test('log out returns to the sign-in screen, and the same credentials log back in', async ({ browser }) => {
  const username = unique()
  const context = await browser.newContext()
  const page = await context.newPage()

  // Register up front, then load the app authenticated.
  await page.request.post('http://localhost:5173/api/auth/signup', {
    data: { username, password: 'test-password' },
  })
  await page.goto('/settings')
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })

  // Sign out from Settings.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // Log back in with the same credentials.
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
  await context.close()
})

test('two users have fully isolated data (the v1 guarantee)', async ({ browser }) => {
  // User A creates an account and a task. newAppPage signs up a fresh user.
  const pageA = await newAppPage(browser, '/wallet/accounts')
  await pageA.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(pageA, { name: 'Alice Private Bank', type: 'bank' })
  await expect(accountCardFor(pageA, 'Alice Private Bank')).toBeVisible()

  await pageA.getByRole('link', { name: 'Tasks' }).click()
  await pageA.getByRole('button', { name: 'New task' }).first().click()
  await expect(pageA.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await pageA.keyboard.type('Alice secret task')
  await pageA.getByRole('textbox', { name: 'Task content' }).last().blur()
  await expect(bulletNodeFor(pageA, 'Alice secret task')).toBeVisible()

  // User B is a different fresh user — must see none of A's data.
  const pageB = await newAppPage(browser, '/wallet/accounts')
  await expect(pageB.locator('[data-testid="account-card"]')).toHaveCount(0)
  await expect(accountCardFor(pageB, 'Alice Private Bank')).toHaveCount(0)

  await pageB.getByRole('link', { name: 'Tasks' }).click()
  await expect(bulletNodeFor(pageB, 'Alice secret task')).toHaveCount(0)

  // A's data is untouched by B's session.
  await pageA.bringToFront()
  await expect(bulletNodeFor(pageA, 'Alice secret task')).toBeVisible()

  await pageA.context().close()
  await pageB.context().close()
})

test('login with wrong password shows an error', async ({ browser }) => {
  const username = unique()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.request.post('http://localhost:5173/api/auth/signup', {
    data: { username, password: 'test-password' },
  })
  // New context = logged out (cookie lives on the request context above only
  // after navigation; here we start fresh to drive the login form).
  const freshContext = await browser.newContext()
  const freshPage = await freshContext.newPage()
  await freshPage.goto('/')

  await freshPage.getByLabel('Username').fill(username)
  await freshPage.getByLabel('Password').fill('wrong-password')
  await freshPage.getByRole('button', { name: 'Sign in' }).click()

  await expect(freshPage.getByText('Invalid username or password.')).toBeVisible()
  await context.close()
  await freshContext.close()
})
