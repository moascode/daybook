/**
 * FEAT-032 — Tasks: Wallet chips on task rows
 * (docs/backlog/EP-07-tasks-depth/FEAT-032-tasks-wallet-chips.md).
 *
 * Covers: the outliner's "Link to Wallet…" picker (empty state, linking a
 * recurring bill, linking a goal), the resolved chip text for each kind, and
 * the server rejecting a walletRef that doesn't belong to the caller.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, openTaskMenu, bulletNodeFor, businessDatePlus } from './helpers'

const API = '/api'

async function addTaskViaOutliner(page: import('@playwright/test').Page, content: string) {
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type(content)
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
}

test.describe('96 — Tasks wallet chips', () => {
  test('options menu offers "Link to Wallet…", empty when there is nothing to link', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')
    await addTaskViaOutliner(page, 'Pay the internet bill')

    await openTaskMenu(page, 'Pay the internet bill')
    await expect(page.getByRole('menuitem', { name: /Link to Wallet/i })).toBeVisible()
    await page.getByRole('menuitem', { name: /Link to Wallet/i }).click()

    await expect(page.getByRole('dialog').getByText(/No bills or goals to link yet/i)).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('linking a recurring bill shows a "Wallet · RM… due…" chip', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')
    const tomorrow = businessDatePlus(1)

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: account.id, amount: 89.9, merchant: 'Internet', frequency: 'monthly', nextDueDate: tomorrow },
    })

    await addTaskViaOutliner(page, 'Pay the internet bill')
    await openTaskMenu(page, 'Pay the internet bill')
    await page.getByRole('menuitem', { name: /Link to Wallet/i }).click()

    const select = page.getByTestId('wallet-ref-select')
    const value = await select.locator('option', { hasText: 'Internet' }).getAttribute('value')
    await select.selectOption(value!)
    await page.getByTestId('wallet-ref-save-btn').click()

    const node = bulletNodeFor(page, 'Pay the internet bill')
    await expect(node.getByTestId('wallet-chip')).toBeVisible()
    await expect(node.getByTestId('wallet-chip')).toContainText('Wallet ·')
    await expect(node.getByTestId('wallet-chip')).toContainText(/RM\s*89\.90/)
    await expect(node.getByTestId('wallet-chip')).toContainText('due tomorrow')
  })

  test('linking a goal shows a "Wallet goal · N% funded" chip', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Savings', type: 'bank', openingBalance: 500 },
    })
    const account = await accountRes.json()
    await page.request.post(`${API}/goals`, {
      data: { name: 'New laptop', targetAmount: 1000, accountId: account.id },
    })

    await addTaskViaOutliner(page, 'Save for a laptop')
    await openTaskMenu(page, 'Save for a laptop')
    await page.getByRole('menuitem', { name: /Link to Wallet/i }).click()

    const select = page.getByTestId('wallet-ref-select')
    const value = await select.locator('option', { hasText: 'New laptop' }).getAttribute('value')
    await select.selectOption(value!)
    await page.getByTestId('wallet-ref-save-btn').click()

    const node = bulletNodeFor(page, 'Save for a laptop')
    await expect(node.getByTestId('wallet-chip')).toBeVisible()
    await expect(node.getByTestId('wallet-chip')).toContainText('Wallet goal · 50% funded')
  })

  test('the server rejects a walletRef pointing at another user’s goal', async ({ browser }) => {
    const alice = await newAppPage(browser, '/tasks')
    const bob = await newAppPage(browser, '/tasks')

    const bobAccountRes = await bob.request.post(`${API}/accounts`, {
      data: { name: 'Bob account', type: 'bank', openingBalance: 0 },
    })
    const bobAccount = await bobAccountRes.json()
    const bobGoalRes = await bob.request.post(`${API}/goals`, {
      data: { name: "Bob's goal", targetAmount: 100, accountId: bobAccount.id },
    })
    const bobGoal = await bobGoalRes.json()

    const taskRes = await alice.request.post(`${API}/tasks`, { data: { content: 'Alice task' } })
    const task = await taskRes.json()

    const patchRes = await alice.request.patch(`${API}/tasks/${task.id}`, {
      data: { walletRef: `goal:${bobGoal.id}` },
    })
    expect(patchRes.status()).toBe(400)
  })
})
