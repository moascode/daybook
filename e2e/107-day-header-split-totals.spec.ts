import { test, expect } from '@playwright/test'
import { format, parseISO } from 'date-fns'
import { businessToday, businessDatePlus } from './helpers'

test.describe.configure({ mode: 'serial' })

// BUG-003 regression. The day header's net (data-testid="day-header-net") is
// supposed to count a split transaction at the viewer's *effective* share,
// not its gross — matching the dashboard (PR #106) and the summary row above
// the list. TransactionList.tsx's groupByDay() has routed the header through
// countableAmount() since 42c1a1c (v2.0.0), so this pins that behaviour rather
// than fixing it; see BUG-003's resolution note for why the bug's original
// "should show half right after splitting" repro was wrong.
test.describe('107 — Day header totals follow splits', () => {
  test('an unsettled split still shows the full expense (§9.1)', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_dh1_${ts}`
    const bobName = `bob_dh1_${ts}`
    const today = businessToday()

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })
    const aliceMe = await alicePage.request.get('/api/auth/me').then((r) => r.json()) as { user: { id: string } }
    const bobMe = await bobPage.request.get('/api/auth/me').then((r) => r.json()) as { user: { id: string } }

    const group = await alicePage.request.post('/api/groups', { data: { name: 'DayHeaderGroup1' } })
      .then((r) => r.json()) as { id: string }
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('/api/invites').then((r) => r.json()) as { id: string }[]
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const aliceAcct = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    const txn = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: today, merchant: 'SplitLunch', amount: 100, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    // 50/50 split, left unsettled — §9.1: the full amount stays on the payer
    // until the other party actually settles, not from the moment of the split.
    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 50, note: '' },
            { userId: bobMe.user.id, shareAmount: 50, note: '' },
          ],
        }],
      },
    })

    await alicePage.goto('/wallet')
    await expect(alicePage.getByTestId('summary-income')).toBeVisible({ timeout: 10_000 })
    await expect(alicePage.getByText('SplitLunch')).toBeVisible({ timeout: 10_000 })

    const rowAmount = alicePage.getByTestId('transaction-row').filter({ hasText: 'SplitLunch' }).getByTestId('transaction-row-amount')
    await expect(rowAmount).toContainText(/100\.00/)

    // Fresh user, single transaction for the day — the only day-header on the
    // page is the one for `today`.
    const dayHeaderNet = alicePage.getByTestId('day-header').first().getByTestId('day-header-net')
    await expect(dayHeaderNet).toHaveText(/-\s*RM\s*100\.00/)

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('a fully settled split lowers the day header to the net effective amount', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alicePage = await aliceCtx.newPage()
    const bobPage = await bobCtx.newPage()
    const ts = Date.now()
    const aliceName = `alice_dh2_${ts}`
    const bobName = `bob_dh2_${ts}`
    // The expense is dated two days back and the settlement is recorded (and
    // confirmed) TODAY, deliberately on a different calendar day.
    //
    // Settling on the SAME day the expense was booked cannot distinguish the
    // bug from the fix: on that one day, the gross `t.amount` minus-nothing
    // on the expense and the full gross of the balance-only settlement income
    // leg cancel out to the exact same net as effectiveAmount minus the
    // balance-only leg counted as zero — both arithmetically reduce to
    // `settledAmount - grossAmount`. Only when the settlement's income leg
    // lands on a DIFFERENT date than the expense does reading gross `t.amount`
    // (no isBalanceOnly check, no effectiveAmount) actually diverge from the
    // correct figure on the expense's own day — which is exactly the shape of
    // the original BUG-003 report (a day header disagreeing with the
    // dashboard for a split made earlier and settled later).
    const expenseDate = businessDatePlus(-2)

    await alicePage.request.post('/api/auth/signup', { data: { username: aliceName, password: 'test-password' } })
    await bobPage.request.post('/api/auth/signup', { data: { username: bobName, password: 'test-password' } })
    const aliceMe = await alicePage.request.get('/api/auth/me').then((r) => r.json()) as { user: { id: string } }
    const bobMe = await bobPage.request.get('/api/auth/me').then((r) => r.json()) as { user: { id: string } }

    const group = await alicePage.request.post('/api/groups', { data: { name: 'DayHeaderGroup2' } })
      .then((r) => r.json()) as { id: string }
    await alicePage.request.post(`/api/groups/${group.id}/invites`, { data: { username: bobName } })
    const invites = await bobPage.request.get('/api/invites').then((r) => r.json()) as { id: string }[]
    await bobPage.request.post(`/api/invites/${invites[0].id}/accept`)

    const aliceAcct = await alicePage.request.post('/api/accounts', {
      data: { name: 'Alice Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const bobAcct = await bobPage.request.post('/api/accounts', {
      data: { name: 'Bob Cash', type: 'cash', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    // The one and only transaction dated `expenseDate` on Alice's books, so
    // the day header this test reads has nothing else contributing to it.
    const txn = await alicePage.request.post('/api/transactions', {
      data: { accountId: aliceAcct.id, date: expenseDate, merchant: 'SplitDinner', amount: 100, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }

    await alicePage.request.post('/api/transactions/splits', {
      data: {
        transactions: [{
          transactionId: txn.id,
          shares: [
            { userId: aliceMe.user.id, shareAmount: 50, note: '' },
            { userId: bobMe.user.id, shareAmount: 50, note: '' },
          ],
        }],
      },
    })

    // Bob (the debtor) records the RM50 settlement — a claim, not a clearance
    // (W4): it does not move Alice's books until she confirms it arrived.
    const settlement = await bobPage.request.post('/api/settlements', {
      data: { groupId: group.id, toUserId: aliceMe.user.id, amount: 50, note: '', fromAccountId: bobAcct.id },
    }).then((r) => r.json()) as { id: string }

    // Alice confirms receipt into her own account. This is what actually clears
    // the split's settled_amount and, through EFFECTIVE_AMOUNT_SQL, lowers her
    // expense on the original transaction from RM100 to RM50. It also books a
    // balance-only income leg on her books, dated TODAY (the server's
    // todayStr()) — not `expenseDate` — for the RM50 that arrived.
    await alicePage.request.post(`/api/settlements/${settlement.id}/confirm`, { data: { accountId: aliceAcct.id } })

    // ?range=all: the expense is outside the current-month default whenever
    // this test runs near the start of a month.
    await alicePage.goto('/wallet?range=all')
    await expect(alicePage.getByTestId('summary-income')).toBeVisible({ timeout: 10_000 })
    await expect(alicePage.getByText('SplitDinner')).toBeVisible({ timeout: 10_000 })

    // Ledger figure on the row is unchanged — RM100 really left the account.
    const rowAmount = alicePage.getByTestId('transaction-row').filter({ hasText: 'SplitDinner' }).getByTestId('transaction-row-amount')
    await expect(rowAmount).toContainText(/100\.00/)

    // The day header for `expenseDate` specifically (not today's, which now
    // also exists for the settlement's balance-only income leg). Expense side
    // is countableAmount(SplitDinner) = effectiveAmount (100 - 50 settled) =
    // 50; there is no income that day. Net = 0 - 50 = -50.00, formatted as
    // "-RM<nbsp>50.00" by formatMYR (ms-MY Intl currency format).
    const expenseDateLabel = format(parseISO(expenseDate), 'dd MMM yyyy')
    const dayHeaderNet = alicePage
      .getByTestId('day-header')
      .filter({ hasText: expenseDateLabel })
      .getByTestId('day-header-net')
    await expect(dayHeaderNet).toHaveText(/-\s*RM\s*50\.00/)

    await aliceCtx.close()
    await bobCtx.close()
  })
})
