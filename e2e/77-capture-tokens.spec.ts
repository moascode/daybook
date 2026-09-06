/**
 * 77 — Capture tokens (R18, docs/v2/wallet/feature-capture-inbox.md §4).
 *
 * The two auth negatives are the POINT of this spec, not an extra:
 *   - a session cookie must NOT authenticate anything under /api/capture/*
 *     (a cookie-authenticated POST a third-party page can reach is CSRF, and
 *      sameSite:'Lax' does not block top-level form POSTs);
 *   - a capture token must NOT authenticate anything on protectedApi (else the
 *     scope list is decorative and the token inherits every read, every delete,
 *     and the routes that spend the owner's Anthropic key).
 *
 * `page.request` carries the session cookie; a bare `request` fixture context
 * does not, which is how the two credential domains are told apart here.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

async function createToken(page: Page, label: string): Promise<string> {
  const res = await page.request.post(`${API}/capture-tokens`, { data: { label } })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.token).toMatch(/^dbk_cap_[A-Za-z0-9_-]{43}$/)
  return body.token
}

/** A context with NO session cookie — the only honest way to test a bearer. */
async function anonContext(baseURL: string | undefined) {
  return playwrightRequest.newContext({ baseURL })
}

test.describe('capture tokens', () => {
  test('creates a token, authenticates with it, and revokes it', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await createToken(page, 'Spec iPhone')

    const anon = await anonContext(baseURL)

    // The token authenticates the machine surface.
    const ok = await anon.get(`${API}/capture/health`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(ok.status()).toBe(200)
    expect((await ok.json()).device).toBe('Spec iPhone')

    // …and stops the moment it is revoked.
    const listed = await page.request.get(`${API}/capture-tokens`)
    const [row] = await listed.json()
    const revoked = await page.request.delete(`${API}/capture-tokens/${row.id}`)
    expect(revoked.ok()).toBeTruthy()

    const after = await anon.get(`${API}/capture/health`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(after.status()).toBe(401)

    await anon.dispose()
  })

  test('a session cookie does NOT authenticate the capture surface', async ({ browser }) => {
    const page = await newAppPage(browser)
    // page.request carries the logged-in session cookie. It must still be 401.
    const res = await page.request.get(`${API}/capture/health`)
    expect(res.status()).toBe(401)
  })

  test('a capture token does NOT authenticate the app surface', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await createToken(page, 'Scope test')
    const anon = await anonContext(baseURL)

    for (const path of ['/transactions', '/accounts', '/settings', '/capture-tokens']) {
      const res = await anon.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status(), `${path} must reject a capture token`).toBe(401)
    }

    await anon.dispose()
  })

  test('rejects a missing, malformed or unknown token', async ({ baseURL }) => {
    const anon = await anonContext(baseURL)
    for (const headers of [
      undefined,
      { Authorization: 'Bearer' },
      { Authorization: 'Basic dXNlcjpwYXNz' },
      { Authorization: 'Bearer dbk_cap_totallymadeupvaluethatwasneverissued00' },
    ]) {
      const res = await anon.get(`${API}/capture/health`, { headers })
      expect(res.status()).toBe(401)
    }
    await anon.dispose()
  })

  test('a device name is required', async ({ browser }) => {
    const page = await newAppPage(browser)
    const res = await page.request.post(`${API}/capture-tokens`, { data: { label: '   ' } })
    expect(res.status()).toBe(400)
  })

  test('one user cannot revoke another user\'s token', async ({ browser }) => {
    const owner = await newAppPage(browser)
    await createToken(owner, 'Owner device')
    const listed = await owner.request.get(`${API}/capture-tokens`)
    const [row] = await listed.json()

    const other = await newAppPage(browser)
    const res = await other.request.delete(`${API}/capture-tokens/${row.id}`)
    expect(res.status()).toBe(404)

    // …and it still works for its owner.
    const stillListed = await owner.request.get(`${API}/capture-tokens`)
    expect((await stillListed.json())[0].revoked_at).toBeNull()
  })

  test('the counter key cannot be reset through the settings API', async ({ browser }) => {
    const page = await newAppPage(browser)
    const res = await page.request.put(`${API}/settings/capture_rate_limit_anything`, {
      data: { value: '{"count":0}' },
    })
    expect(res.status()).toBe(400)
  })

  test('UI: creates a token, reveals it once, and lists the device', async ({ browser }) => {
    const page = await newAppPage(browser, '/settings')

    await page.getByTestId('capture-token-label').fill('Kitchen iPad')
    await page.getByTestId('capture-token-create').click()

    const reveal = page.getByTestId('capture-token-reveal')
    await expect(reveal).toBeVisible()
    await expect(reveal).toContainText('shown once')
    await expect(reveal.locator('code')).toHaveText(/^dbk_cap_/)

    await expect(page.getByTestId('capture-token-row')).toHaveCount(1)
    await expect(page.getByTestId('capture-token-row')).toContainText('Kitchen iPad')
    await expect(page.getByTestId('capture-token-row')).toContainText('Last used never')

    // Reloading must not show the secret again — it was never stored.
    await page.reload()
    await expect(page.getByTestId('capture-token-reveal')).toHaveCount(0)
    await expect(page.getByTestId('capture-token-row')).toHaveCount(1)
  })

  test('UI: revoking asks first, then removes the device', async ({ browser }) => {
    const page = await newAppPage(browser, '/settings')
    await page.getByTestId('capture-token-label').fill('Old phone')
    await page.getByTestId('capture-token-create').click()
    await expect(page.getByTestId('capture-token-row')).toHaveCount(1)

    await page.getByTestId('capture-token-revoke').click()
    await page.getByTestId('capture-token-revoke-confirm').click()

    await expect(page.getByTestId('capture-token-row')).toHaveCount(0)
    await expect(page.getByTestId('capture-tokens-section')).toContainText('No devices connected yet')
  })
})
