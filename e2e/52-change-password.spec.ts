import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { waitForApp } from './helpers'

// 52 — Change password (Settings → Change password).
//
// The app had no way to change a password at all until this shipped; the only
// route was editing the hash in the database by hand.
//
// These tests need the username in order to re-login afterwards, which
// newAppPage() does not return — so they do their own signup instead.
test.describe.configure({ mode: 'serial' })

const ORIGINAL = 'test-password'
const UPDATED = 'a-much-longer-new-password'

let seq = 0

async function signUpAndOpenSettings(
  browser: Browser,
): Promise<{ page: Page; username: string }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const username = `e2e_pw_${Date.now()}_${seq++}`
  await page.request.post('/api/auth/signup', {
    data: { username, password: ORIGINAL },
  })
  await page.goto('/settings')
  await waitForApp(page)
  return { page, username }
}

async function submitChange(page: Page, current: string, next: string, confirm = next) {
  await page.getByTestId('current-password').fill(current)
  await page.getByTestId('new-password').fill(next)
  await page.getByTestId('confirm-password').fill(confirm)
  await page.getByTestId('change-password-submit').click()
}

test('the form is present on the Settings page', async ({ browser }) => {
  const { page } = await signUpAndOpenSettings(browser)
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
  await expect(page.getByTestId('current-password')).toBeVisible()
  await expect(page.getByTestId('new-password')).toBeVisible()
  await expect(page.getByTestId('confirm-password')).toBeVisible()
})

test('mismatched confirmation is rejected client-side', async ({ browser }) => {
  const { page } = await signUpAndOpenSettings(browser)
  await submitChange(page, ORIGINAL, UPDATED, 'something-else-entirely')
  await expect(page.getByTestId('password-error')).toContainText('do not match')
})

test('a too-short new password is rejected', async ({ browser }) => {
  const { page } = await signUpAndOpenSettings(browser)
  await submitChange(page, ORIGINAL, 'short')
  await expect(page.getByTestId('password-error')).toContainText('at least 12')
})

test('a wrong current password is rejected by the server', async ({ browser }) => {
  const { page } = await signUpAndOpenSettings(browser)
  await submitChange(page, 'not-the-right-password', UPDATED)
  await expect(page.getByTestId('password-error')).toContainText('current password is incorrect')
})

test('changing the password succeeds; the old one stops working', async ({ browser }) => {
  const { page, username } = await signUpAndOpenSettings(browser)
  await submitChange(page, ORIGINAL, UPDATED)

  // Success clears the form and leaves the caller signed in on this device.
  await expect(page.getByTestId('current-password')).toHaveValue('')
  await expect(page.getByText('Signed in as')).toBeVisible()

  const stale = await page.request.post('/api/auth/login', {
    data: { username, password: ORIGINAL },
  })
  expect(stale.status()).toBe(401)

  const fresh = await page.request.post('/api/auth/login', {
    data: { username, password: UPDATED },
  })
  expect(fresh.status()).toBe(200)
})

test('changing the password signs other devices out', async ({ browser }) => {
  const { page, username } = await signUpAndOpenSettings(browser)

  // A second, independent session for the same user — the "other device".
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  const login = await otherPage.request.post('/api/auth/login', {
    data: { username, password: ORIGINAL },
  })
  expect(login.status()).toBe(200)
  expect((await otherPage.request.get('/api/auth/me')).status()).toBe(200)

  await submitChange(page, ORIGINAL, UPDATED)
  await expect(page.getByTestId('current-password')).toHaveValue('')

  // The other device's session is now dead — this is the point of the feature.
  expect((await otherPage.request.get('/api/auth/me')).status()).toBe(401)

  // …while the device that made the change is still signed in.
  expect((await page.request.get('/api/auth/me')).status()).toBe(200)

  await other.close()
})
