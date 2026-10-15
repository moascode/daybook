/**
 * 115 — Nudge: ping the assignee of a task you handed out.
 *
 * A nudge is a `push_sent_log` row (kind `nudge:<taskId>`, keyed on the
 * assignee) — no schema. The harness has no VAPID keys, so `devices` is 0 and
 * the UI must say the assignee will see it in their notifications, never that
 * a push happened.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

const API = '/api'

async function createGroupOfTwo(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const assigneeCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const assigneePage = await assigneeCtx.newPage()

  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const ownerName = `owner_ndg_${stamp}`
  const assigneeName = `asnee_ndg_${stamp}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await assigneePage.request.post(`${API}/auth/signup`, { data: { username: assigneeName, password: 'test-password' } })

  const group = await (await ownerPage.request.post(`${API}/groups`, { data: { name: 'Nudge Household' } })).json()
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: assigneeName } })
  const invites = await (await assigneePage.request.get(`${API}/invites`)).json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await assigneePage.request.post(`${API}/invites/${invite.id}/accept`)

  return { ownerPage, assigneePage, ownerName, assigneeName, ownerCtx, assigneeCtx }
}

async function currentUserId(page: Page): Promise<string> {
  const { user } = await (await page.request.get(`${API}/auth/me`)).json()
  return user.id
}

async function assign(owner: Page, assigneeId: string, content: string): Promise<string> {
  const task = await (await owner.request.post(`${API}/tasks`, { data: { content } })).json()
  await owner.request.patch(`${API}/tasks/${task.id}`, { data: { assigneeId } })
  return task.id
}

async function pending(page: Page): Promise<{ kind: string; title: string; body: string }[]> {
  const res = await page.request.get(`${API}/notifications/pending`)
  return (await res.json()).notifications
}

test.describe('115 — Tasks nudge', () => {
  test('owner nudges via the row button, a second nudge is refused, the assignee is told, completing retires it', async ({
    browser,
  }) => {
    const { ownerPage, assigneePage, ownerName, assigneeName, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)
    const content = `Send the form ${Date.now()}`
    const taskId = await assign(ownerPage, assigneeId, content)

    await ownerPage.goto('/tasks/assigned')
    const btn = ownerPage.getByTestId(`assigned-nudge-${taskId}`)
    await expect(btn).toHaveText('Nudge', { timeout: 20_000 })
    await expect(btn).toHaveAccessibleName(`Nudge ${assigneeName} about ${content}`)
    await btn.click()

    // No push service in the harness: the toast must not claim a phone was pinged.
    await expect(
      ownerPage.getByText(`Nudged ${assigneeName} — they'll see it in their notifications next time they open Daybook`),
    ).toBeVisible()
    await expect(btn).toHaveText('Nudged')
    await expect(btn).toBeDisabled()

    // Server is the source of truth: a reload keeps it nudged…
    await ownerPage.reload()
    await expect(ownerPage.getByTestId(`assigned-nudge-${taskId}`)).toBeDisabled({ timeout: 20_000 })
    await expect(ownerPage.getByTestId(`assigned-nudge-${taskId}`)).toHaveText('Nudged')

    // …and a second request is refused with a clear message.
    const again = await ownerPage.request.post(`${API}/tasks/${taskId}/nudge`)
    expect(again.status()).toBe(409)
    expect((await again.json()).error).toBe('Already nudged today')

    // The assignee sees it, via the API and the bell.
    const list = await pending(assigneePage)
    expect(list[0]).toMatchObject({ kind: 'nudge', title: `${ownerName} nudged you`, body: content })

    await assigneePage.goto('/tasks')
    await assigneePage.getByTestId('notifications-bell').click()
    const item = assigneePage.locator('[data-testid="notification-item"][data-kind="nudge"]')
    await expect(item).toContainText(`${ownerName} nudged you`)
    await expect(item).toContainText(content)

    // Completing the task retires the nudge.
    await assigneePage.request.post(`${API}/tasks/${taskId}/complete`)
    expect((await pending(assigneePage)).filter((n) => n.kind === 'nudge')).toHaveLength(0)

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('only the assigning owner may nudge, and only an open task assigned to someone else', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)
    const ownerId = await currentUserId(ownerPage)
    const taskId = await assign(ownerPage, assigneeId, `Guarded ${Date.now()}`)

    const asAssignee = await assigneePage.request.post(`${API}/tasks/${taskId}/nudge`)
    expect(asAssignee.status()).toBe(403)
    expect((await asAssignee.json()).error).toMatch(/assigned a task/)

    const unassigned = await (await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Mine alone' } })).json()
    expect((await ownerPage.request.post(`${API}/tasks/${unassigned.id}/nudge`)).status()).toBe(409)

    const selfAssigned = await assign(ownerPage, ownerId, 'Self assigned')
    expect((await ownerPage.request.post(`${API}/tasks/${selfAssigned}/nudge`)).status()).toBe(409)

    await ownerPage.request.post(`${API}/tasks/${taskId}/complete`)
    const done = await ownerPage.request.post(`${API}/tasks/${taskId}/nudge`)
    expect(done.status()).toBe(409)
    expect((await done.json()).error).toBe('That task is already done')

    expect((await ownerPage.request.post(`${API}/tasks/nope-${Date.now()}/nudge`)).status()).toBe(404)

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('several nudges collapse into one "n nudges" notification', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)
    const a = await assign(ownerPage, assigneeId, `First ${Date.now()}`)
    const b = await assign(ownerPage, assigneeId, `Second ${Date.now()}`)
    expect((await ownerPage.request.post(`${API}/tasks/${a}/nudge`)).status()).toBe(200)
    expect((await ownerPage.request.post(`${API}/tasks/${b}/nudge`)).status()).toBe(200)

    const nudges = (await pending(assigneePage)).filter((n) => n.kind === 'nudge')
    expect(nudges).toHaveLength(1)
    expect(nudges[0].title).toBe('2 nudges')

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('"Nudge all" nudges every open handed-out task and summarises', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)
    const ids = [
      await assign(ownerPage, assigneeId, `All one ${Date.now()}`),
      await assign(ownerPage, assigneeId, `All two ${Date.now()}`),
      await assign(ownerPage, assigneeId, `All three ${Date.now()}`),
    ]
    // One was already nudged earlier today.
    expect((await ownerPage.request.post(`${API}/tasks/${ids[0]}/nudge`)).status()).toBe(200)

    await ownerPage.goto('/tasks/assigned')
    await expect(ownerPage.getByTestId(`assigned-nudge-${ids[0]}`)).toHaveText('Nudged', { timeout: 20_000 })
    await ownerPage.getByTestId('assigned-nudge-all').click()

    await expect(ownerPage.getByText('Nudged 2 · 1 already nudged today')).toBeVisible()
    for (const id of ids) await expect(ownerPage.getByTestId(`assigned-nudge-${id}`)).toHaveText('Nudged')

    // A second "Nudge all" has nothing new to send.
    await ownerPage.getByTestId('assigned-nudge-all').click()
    await expect(ownerPage.getByText('Nudged 0 · 3 already nudged today')).toBeVisible()

    const nudges = (await pending(assigneePage)).filter((n) => n.kind === 'nudge')
    expect(nudges[0].title).toBe('3 nudges')

    await ownerCtx.close()
    await assigneeCtx.close()
  })
})
