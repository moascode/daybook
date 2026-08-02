import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { canWriteAccount, isGroupMember } from '../lib/sharing.ts'
import { businessDateOf, daysBetween, newId, todayStr } from '../lib.ts'

// Port of server/routes/settlements.ts, including the atomicity work the plan
// schedules for Phase 5 — the two cannot be separated, because the Express
// handler's correctness rests entirely on `db.transaction()` and D1 has no
// interactive transactions.
export const settlements = new Hono<AppEnv>()

/** Round to cents the same way the server does, so amounts stay comparable. */
const cents = (n: number) => Math.round(n * 100) / 100

interface OutstandingSplit {
  id: string
  share_amount: number
  settled_amount: number
  category_id: string | null
  merchant: string
  date: string
}

/**
 * The debtor's unclaimed splits owed to the creditor, oldest first.
 *
 * Shared by the preview and the commit path deliberately. A preview computed
 * from its own copy of this query is a promise the commit does not have to keep:
 * it would drift the moment either changed, and the user has been taught to
 * trust it. One definition, two callers.
 *
 * Unclaimed only — a split already awaiting confirmation has been paid once and
 * must not be claimed again. Both resting states are payable: agreeing to a debt
 * is an acknowledgement, not a precondition.
 */
async function outstandingSplitsFor(
  db: D1Database,
  groupId: string,
  debtorId: string,
  creditorId: string,
  scope: DateScope = {},
): Promise<OutstandingSplit[]> {
  // Scoped on the TRANSACTION date, not the split's created_at: that is the date
  // the row shows, and the date the Shared page's filter already means. Absent
  // means all time, which is what the dialog inherits by default.
  const binds: unknown[] = [groupId, debtorId, creditorId]
  let dateClause = ''
  if (scope.dateFrom) { dateClause += ' AND t.date >= ?'; binds.push(scope.dateFrom) }
  if (scope.dateTo) { dateClause += ' AND t.date <= ?'; binds.push(scope.dateTo) }

  const { results } = await db
    .prepare(
      `SELECT ts.id, ts.share_amount, ts.settled_amount, t.category_id,
              t.merchant, t.date
       FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
       WHERE ts.user_id = ? AND t.user_id = ? AND ts.settled_at IS NULL
         AND ts.status IN ('pending', 'approved')
         AND ts.id NOT IN (
           SELECT l.share_id FROM settlement_split_lines l
           JOIN settlements sx ON sx.id = l.settlement_id
           WHERE sx.status = 'awaiting_confirmation'
         )${dateClause}
       ORDER BY ts.created_at ASC`,
    )
    .bind(...binds)
    .all<OutstandingSplit>()
  return results
}

interface DateScope { dateFrom?: string; dateTo?: string }

/**
 * What settling between two people actually clears, in both directions.
 *
 * The whole reason this exists: `POST /settlements` used to look one way only,
 * on that direction's gross. With Kakon owed RM30 and owing RM15 the only way to
 * clear both claims was RM30 one way and RM15 the other — RM45 of cash to
 * discharge a RM15 debt, and no path back to zero, because the moment the net
 * hit zero the "no outstanding balance" guard refused any further settlement.
 *
 * Only the difference moves. The rest — `min(each direction)` — is netted off:
 * a real settlement, paid in kind rather than in cash.
 */
interface Netting {
  /** Claims the caller holds against the counterparty, oldest first. */
  theirSplits: OutstandingSplit[]
  /** Claims the counterparty holds against the caller. */
  mySplits: OutstandingSplit[]
  theyOweYou: number
  youOweThem: number
  /** Cancelled against each other; discharged on BOTH sides, no money. */
  offset: number
  /** Positive when they owe you on net; negative when you owe them. */
  net: number
  /** Who has to actually send money. Null when the net is zero. */
  payerId: string | null
}

async function computeNetting(
  db: D1Database,
  groupId: string,
  callerId: string,
  counterpartyId: string,
  scope: DateScope,
): Promise<Netting> {
  const [theirSplits, mySplits] = await Promise.all([
    outstandingSplitsFor(db, groupId, counterpartyId, callerId, scope),
    outstandingSplitsFor(db, groupId, callerId, counterpartyId, scope),
  ])
  const total = (rows: OutstandingSplit[]) =>
    cents(rows.reduce((sum, s) => sum + (s.share_amount - s.settled_amount), 0))
  const theyOweYou = total(theirSplits)
  const youOweThem = total(mySplits)
  const net = cents(theyOweYou - youOweThem)
  return {
    theirSplits,
    mySplits,
    theyOweYou,
    youOweThem,
    offset: cents(Math.min(theyOweYou, youOweThem)),
    net,
    payerId: Math.abs(net) < 0.005 ? null : net > 0 ? counterpartyId : callerId,
  }
}

/**
 * The leg-owner's own category matching the one on the claim being cleared.
 *
 * §9.7 has a settlement inherit the original transaction's category so the food
 * budget sees food. Categories are **per user**, though, and the transaction
 * being cleared belongs to the other person — so inheriting the id verbatim
 * writes a category the leg's owner does not own. It satisfies the foreign key
 * (the row exists) and then never matches anything in their own budget or
 * dashboard, so the payment lands in a category they cannot see. Pre-existing,
 * and it becomes visible the moment netting starts booking legs on both sides.
 *
 * Resolved by name, which is what the seed makes reliable: every user gets the
 * same fifteen. No match, no category — an uncategorised expense is honest,
 * a foreign one is not.
 */
async function ownCategoryLike(
  db: D1Database,
  categoryId: string | null,
  ownerId: string,
): Promise<string | null> {
  if (!categoryId) return null
  const source = await db
    .prepare('SELECT name, user_id FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ name: string; user_id: string }>()
  if (!source) return null
  if (source.user_id === ownerId) return categoryId
  const mine = await db
    .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? LIMIT 1')
    .bind(ownerId, source.name)
    .first<{ id: string }>()
  return mine?.id ?? null
}

/** One claim being discharged, and by what mix of netting and cash. */
export interface Discharge extends Allocation {
  offsetPart: number
  cashPart: number
}

/**
 * Splits an allocation into its netted and cash halves, netting first.
 *
 * FIFO on both, so the oldest claim is the one the netting lands on — the same
 * order `allocate` already uses, which is what keeps the preview honest.
 */
function splitByOffset(alloc: Allocation[], offset: number): Discharge[] {
  let remaining = offset
  return alloc.map((a) => {
    const offsetPart = cents(Math.min(remaining, a.appliedAmount))
    remaining = cents(remaining - offsetPart)
    return { ...a, offsetPart, cashPart: cents(a.appliedAmount - offsetPart) }
  })
}

export interface Allocation {
  id: string
  previousSettled: number
  newSettled: number
  appliedAmount: number
  categoryId: string | null
  merchant: string
  date: string
}

/**
 * Spreads a payment across outstanding splits, FIFO and partial-aware (B-02) —
 * not whole-split-or-nothing.
 *
 * Pure, so the preview can show exactly what the commit will do without
 * touching the database.
 */
function allocate(splits: OutstandingSplit[], amount: number): Allocation[] {
  let remaining = amount
  const applied: Allocation[] = []
  for (const split of splits) {
    if (remaining <= 0.005) break
    const outstanding = cents(split.share_amount - split.settled_amount)
    if (outstanding <= 0) continue
    const amt = Math.min(remaining, outstanding)
    applied.push({
      id: split.id,
      previousSettled: split.settled_amount,
      newSettled: cents(split.settled_amount + amt),
      appliedAmount: cents(amt),
      categoryId: split.category_id,
      merchant: split.merchant,
      date: split.date,
    })
    remaining -= amt
  }
  return applied
}

/**
 * POST /api/settlements/preview — what settling would actually clear.
 *
 * Read-only. Settling used to be "type a number and hope": the FIFO spread and
 * the over-payment cap were both invisible until after the write, so the user
 * learned what they had done from the result. This shows it first, computed by
 * the same functions the commit uses.
 *
 * `amount` is optional now. Omit it and you get the full picture — both
 * directions, what nets off, and what one payment would leave to move — which is
 * what the dialog needs before the user has typed anything.
 *
 * Registered before POST /settlements/:id/* — a literal segment and a parameter
 * at the same position are exactly the collision groups.ts documents.
 */
settlements.post('/settlements/preview', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const groupId = String(b.groupId ?? '')
  const counterpartyId = String(b.counterpartyId ?? '')
  if (!groupId || !counterpartyId) {
    return c.json({ error: 'groupId and counterpartyId are required' }, 400)
  }
  if (counterpartyId === callerId) {
    return c.json({ error: 'counterparty must be someone else' }, 400)
  }
  if (b.amount !== undefined && (!Number.isFinite(Number(b.amount)) || Number(b.amount) < 0)) {
    return c.json({ error: 'amount must be a non-negative number' }, 400)
  }

  const [callerIn, otherIn] = await Promise.all([
    isGroupMember(db, callerId, groupId),
    isGroupMember(db, counterpartyId, groupId),
  ])
  if (!callerIn || !otherIn) {
    return c.json({ error: 'both users must be in the group' }, 403)
  }

  const scope = readScope(b)
  const n = await computeNetting(db, groupId, callerId, counterpartyId, scope)
  // Defaulting to the full net is what makes "clear everything" one click. The
  // cap (U-13) still applies to anything larger.
  const requested = b.amount === undefined ? Math.abs(n.net) : cents(Number(b.amount))
  const cash = cents(Math.min(requested, Math.abs(n.net)))

  const payerSplits = n.payerId === callerId ? n.mySplits : n.theirSplits
  const otherSplits = n.payerId === callerId ? n.theirSplits : n.mySplits
  const payerLines = splitByOffset(allocate(payerSplits, cents(n.offset + cash)), n.offset)
  // The lighter side is discharged entirely by the netting — its whole debt IS
  // the offset, by definition of min().
  const otherLines = splitByOffset(allocate(otherSplits, n.offset), n.offset)

  const describe = (lines: Discharge[], pool: OutstandingSplit[]) =>
    lines.map((l) => ({
      splitId: l.id,
      merchant: l.merchant,
      date: l.date,
      applied: l.appliedAmount,
      netted: l.offsetPart,
      paid: l.cashPart,
      clears: l.newSettled + 0.005 >= pool.find((s) => s.id === l.id)!.share_amount,
    }))

  return c.json({
    theyOweYou: n.theyOweYou,
    youOweThem: n.youOweThem,
    offset: n.offset,
    net: n.net,
    payerId: n.payerId,
    requested: cents(requested),
    applied: cash,
    capped: requested > Math.abs(n.net) + 0.005,
    // Kept for the existing caller, which reads `outstanding` and `lines`.
    outstanding: Math.abs(n.net),
    lines: [...describe(payerLines, payerSplits), ...describe(otherLines, otherSplits)],
  })
})

/** dateFrom / dateTo off a request body, ignoring blanks. */
function readScope(b: Record<string, unknown>): DateScope {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { dateFrom: str(b.dateFrom), dateTo: str(b.dateTo) }
}

// POST /api/settlements — record that a debtor paid a creditor; books the two
// ledger legs and clears the debtor's outstanding shares (partial-aware).
//
// Direction (B-01): the settlement always stores from_user=debtor,
// to_user=creditor, regardless of who calls. Either party can record it:
//   • Debtor-initiated ("Settle Up"): caller owes → pass toUserId=creditor.
//   • Creditor-initiated ("Mark Received"): caller is owed → pass fromUserId=debtor.
//
// ─── Why this is not a mechanical port ───
//
// The server wraps read-compute-write in one interactive transaction: it reads
// the debtor's outstanding shares, decides in JS how to spread the payment
// across them (FIFO, partial-aware), then writes. D1 cannot hold a transaction
// open across those reads, so the read and the write are separated by a real
// network gap. A concurrent settlement landing in that gap would make the
// payment be applied against balances that no longer exist — double-clearing a
// debt, which is money.
//
// The structure below is therefore: hoist every read, compute the whole write
// set in JS, then issue one atomic batch() whose share updates are
// compare-and-swap guarded on the exact settled_amount that was read. If any
// guard misses, the batch is undone by an explicit compensating batch and the
// caller gets 409 rather than a silently wrong ledger.
settlements.post('/settlements', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const groupId = String(b.groupId ?? '')
  const note = String(b.note ?? '')
  const scope = readScope(b)
  // The caller's own account — whichever leg they are booking. Historically
  // named by role (fromAccountId = debtor side, toAccountId = creditor side);
  // both are still accepted, and the caller only ever names one.
  const callerAccountId = String(b.fromAccountId ?? '') || String(b.toAccountId ?? '')

  // B-01: the body names the counterparty, from either side. Which of them ends
  // up paying is no longer taken from that hint — it follows from the NET,
  // because with debts running both ways the hint can simply be wrong. A caller
  // who passes toUserId ("I owe them") may turn out to be owed money on balance.
  const rawFrom = String(b.fromUserId ?? '')
  const rawTo = String(b.toUserId ?? '')
  const counterpartyId = rawFrom && rawFrom !== callerId ? rawFrom : rawTo
  if (!counterpartyId || counterpartyId === callerId) {
    return c.json({ error: 'toUserId (creditor) or fromUserId (debtor) is required' }, 400)
  }
  if (!groupId) return c.json({ error: 'groupId is required' }, 400)
  const rawAmount = b.amount === undefined ? undefined : Number(b.amount)
  if (rawAmount !== undefined && (!Number.isFinite(rawAmount) || rawAmount < 0)) {
    return c.json({ error: 'amount must be a non-negative number' }, 400)
  }

  const [callerIn, otherIn] = await Promise.all([
    isGroupMember(db, callerId, groupId),
    isGroupMember(db, counterpartyId, groupId),
  ])
  if (!callerIn || !otherIn) {
    return c.json({ error: 'both users must be in the group' }, 403)
  }

  // ── Hoisted reads ────────────────────────────────────
  // Everything the write set depends on is read here, before any write. Nothing
  // below this point queries for a value it then writes back.

  const n = await computeNetting(db, groupId, callerId, counterpartyId, scope)
  // Something has to be owed SOMEWHERE. The old guard asked only about one
  // direction, which is what made the RM30-owed/RM15-owing case unsettleable:
  // the net was RM15, one payment cleared it, and from then on every further
  // settlement was refused while both claims sat half-open forever.
  if (n.theyOweYou < 0.005 && n.youOweThem < 0.005) {
    return c.json({ error: 'no outstanding balance owed in this group' }, 400)
  }

  // Default to clearing the whole net — that is what makes "settle everything"
  // one click. U-13's cap still applies to anything larger.
  const wanted = rawAmount === undefined ? Math.abs(n.net) : cents(rawAmount)
  const cash = cents(Math.min(wanted, Math.abs(n.net)))
  const offset = n.offset

  // The net decides who pays, and therefore which leg the caller books. A zero
  // net is still a real settlement: the two piles cancel and nothing moves.
  const callerIsDebtor = n.payerId === callerId
  const debtorId = n.payerId ?? callerId
  const creditorId = debtorId === callerId ? counterpartyId : callerId

  // The caller books their cash leg (when they are the payer, or when they are
  // recording receipt) and their netted leg (whenever anything nets off — both
  // people discharge `offset`, so both owe an expense for it).
  const callerBooksLeg = cash > 0.005 || offset > 0.005
  if (callerBooksLeg && !callerAccountId) {
    return c.json({ error: 'an account is required to record this settlement' }, 400)
  }
  if (callerAccountId && !(await canWriteAccount(db, callerId, callerAccountId))) {
    return c.json({ error: 'you do not have write access to the selected account' }, 400)
  }

  const { results: users } = await db
    .prepare('SELECT id, username FROM users WHERE id IN (?, ?)')
    .bind(debtorId, creditorId)
    .all<{ id: string; username: string }>()
  const nameOf = (id: string) => users.find((u) => u.id === id)?.username ?? '(unknown user)'

  // Every leg is booked on the account its owner named — the caller's here, the
  // other party's when they confirm.
  let callerAccountOwner: string | null = null
  if (callerAccountId) {
    const acct = await db
      .prepare('SELECT user_id FROM accounts WHERE id = ?')
      .bind(callerAccountId)
      .first<{ user_id: string }>()
    if (!acct) return c.json({ error: 'account not found' }, 400)
    callerAccountOwner = acct.user_id
  }

  // ── Compute the entire write set in JS ───────────────
  //
  // B-02: FIFO across outstanding shares, partial-aware (not
  // whole-share-or-nothing) — and now across BOTH directions. The heavier side
  // discharges `offset + cash`; the lighter side's whole debt IS the offset, by
  // definition of min(). The same functions back POST /settlements/preview, so
  // what the user is shown before confirming is what actually happens.
  const debtorSplits = callerIsDebtor ? n.mySplits : n.theirSplits
  const creditorSplits = callerIsDebtor ? n.theirSplits : n.mySplits
  const debtorLines = splitByOffset(allocate(debtorSplits, cents(offset + cash)), offset)
  const creditorLines = splitByOffset(allocate(creditorSplits, offset), offset)
  const applied: Discharge[] = [...debtorLines, ...creditorLines]

  // §9.7: a settlement leg inherits the original transaction's category, so the
  // food budget sees food. Only when every split it clears agrees — one payment
  // covering groceries and petrol has no honest single category, and picking
  // either would quietly mis-attribute the other.
  const categoryOf = (lines: Discharge[], pick: (l: Discharge) => number) => {
    const touched = lines.filter((l) => pick(l) > 0.005)
    const set = new Set(touched.map((l) => l.categoryId))
    return set.size === 1 ? (touched[0]?.categoryId ?? null) : null
  }
  // Each person's netted expense is categorised from the claims THEY discharged,
  // not from the payment as a whole: Kakon nets off what he owed for Tumpa's
  // Aeon run, so his RM15 lands in household supplies, not in her groceries.
  // Resolved into the caller's own category set — see ownCategoryLike.
  const [cashCategory, callerOffsetCategory] = await Promise.all([
    ownCategoryLike(db, categoryOf(debtorLines, (l) => l.cashPart), callerId),
    ownCategoryLike(
      db,
      categoryOf(callerIsDebtor ? debtorLines : creditorLines, (l) => l.offsetPart),
      callerId,
    ),
  ])

  // Two-step settlement (§2). A debtor recording a payment is making a *claim*:
  // the money is gone from their side, but the creditor's books must not move
  // until the creditor says it arrived. A creditor recording one ("Mark
  // Received", B-01) is already the confirmation — there is nobody left to ask —
  // so that path stays single-step.
  //
  // A pure netting (zero net, no cash) needs confirmation too. Nothing moves, but
  // it writes off claims on BOTH sides, and half of those belong to the other
  // person; agreeing to that is theirs to do.
  const needsConfirmation = callerIsDebtor || n.payerId === null

  const today = todayStr()
  const settlementId = newId()
  // The caller's own legs, written now. The other party's are written when they
  // confirm, into an account they pick themselves.
  const callerCashTxnId = callerAccountOwner && cash > 0.005 ? newId() : null
  const callerOffsetTxnId = callerAccountOwner && offset > 0.005 ? newId() : null

  const insertTxn = (
    id: string,
    userId: string,
    accountId: string,
    description: string,
    type: 'expense' | 'income',
    amount: number,
    categoryId: string | null = null,
    nonCash = false,
  ) =>
    db
      .prepare(
        `INSERT INTO transactions
           (id, user_id, account_id, destination_account_id, date, merchant, description,
            amount, type, category_id, tag, import_hash, is_balance_only, is_non_cash,
            created_at, updated_at)
         VALUES
           (?, ?, ?, NULL, ?, 'Settlement', ?, ?, ?, ?, '[]', '', ?, ?, datetime('now'), datetime('now'))`,
      )
      // §3: the creditor's income leg is balance-only — their expense already
      // fell by the settled amount via EFFECTIVE_AMOUNT_SQL, so counting the
      // arrival as income corrects the same money twice. The debtor's expense
      // leg is NOT flagged: it is a plain expense and their only record of what
      // they paid.
      //
      // A netted leg is the mirror: real expense, no money. The debt was
      // discharged by giving up a receivable rather than by cash, so it belongs
      // in spending and budgets but must not move the account balance. Without
      // it, netting deletes real household spending from both sets of books.
      .bind(
        id, userId, accountId, today, description, amount, type, categoryId,
        type === 'income' ? 1 : 0,
        nonCash ? 1 : 0,
      )

  // Compare-and-swap. The row is only updated if it is still exactly as it was
  // read — same settled_amount, still unsettled. A concurrent settlement that
  // touched this share first changes settled_amount, the WHERE misses, and
  // meta.changes comes back 0 instead of silently overwriting their work.
  //
  // Two shapes, one guard discipline. When the creditor records the payment the
  // money is settled outright. When the debtor records it, nothing about the
  // amounts moves yet — only the claim's status — so the guard is on status
  // instead, and settled_amount stays untouched until POST /:id/confirm.
  const casUpdate = (a: (typeof applied)[number]) =>
    needsConfirmation
      ? // A claim moves no money and must NOT move the split's status: a partial
        // payment leaves the rest of that split owed, and flipping the whole row
        // to awaiting_confirmation would strand the remainder as unclaimable.
        // The row is touched only to prove it has not changed under us — the
        // no-op write keeps meta.changes meaningful as a guard.
        //
        // The write assigns settled_amount to itself rather than writing a
        // status literal. It used to write status='pending', which was a true
        // no-op only while 'pending' was the sole payable state; with 'approved'
        // payable too, that literal silently demoted an agreed claim back into
        // the recipient's review queue on every payment they recorded.
        db
          .prepare(
            `UPDATE transaction_splits SET settled_amount = settled_amount
              WHERE id = ? AND status IN ('pending', 'approved')
                AND settled_at IS NULL AND settled_amount = ?`,
          )
          .bind(a.id, a.previousSettled)
      : db
          .prepare(
            // Paying is agreeing: a claim that has had money put against it
            // rests in 'approved', never back in 'pending'. A partly-paid claim
            // returning to the review queue looking untouched is what made
            // partial settlement so confusing before.
            //
            // offset_amount accumulates alongside settled_amount rather than
            // replacing it: a netted claim IS settled, and the group balance is
            // right to treat it that way. This only records how much of it never
            // involved cash, which is what the row hint reads and what an undo
            // has to give back.
            `UPDATE transaction_splits
                SET settled_amount = ?,
                    offset_amount = ROUND(offset_amount + ?, 2),
                    status = CASE WHEN ? >= share_amount THEN 'settled' ELSE 'approved' END,
                    settled_at = CASE WHEN ? >= share_amount THEN datetime('now') ELSE NULL END
              WHERE id = ? AND settled_at IS NULL AND settled_amount = ?`,
          )
          .bind(a.newSettled, a.offsetPart, a.newSettled, a.newSettled, a.id, a.previousSettled)

  // The caller's cash leg: an expense when they are paying, a balance-only
  // credit when they are recording receipt. Suppressed while awaiting
  // confirmation — the other side books their own leg, into their own account,
  // when they confirm. That is what removed the old dead end where the debtor
  // had to target an account the creditor must have shared in advance.
  const callerCashLeg =
    callerCashTxnId && callerAccountOwner && (callerIsDebtor || !needsConfirmation)
      ? [
          insertTxn(
            callerCashTxnId,
            callerAccountOwner,
            callerAccountId,
            callerIsDebtor
              ? `Settlement to ${nameOf(creditorId)}${note ? ' — ' + note : ''}`
              : `Settlement from ${nameOf(debtorId)}${note ? ' — ' + note : ''}`,
            callerIsDebtor ? 'expense' : 'income',
            cash,
            callerIsDebtor ? cashCategory : null,
          ),
        ]
      : []

  // The caller's netted leg. Real spending, no money: they discharged their own
  // debt by giving up a receivable. Both people book one, because when debts run
  // both ways both people discharge something.
  const callerOffsetLeg =
    callerOffsetTxnId && callerAccountOwner
      ? [
          insertTxn(
            callerOffsetTxnId,
            callerAccountOwner,
            callerAccountId,
            `Settled by netting with ${nameOf(callerIsDebtor ? creditorId : debtorId)}`,
            'expense',
            offset,
            callerOffsetCategory,
            true,
          ),
        ]
      : []

  const writes = [
    // Share updates first so their meta.changes are at known indices.
    ...applied.map(casUpdate),
    ...callerCashLeg,
    ...callerOffsetLeg,
    db
      .prepare(
        `INSERT INTO settlements
           (id, group_id, from_user, to_user, amount, currency, note,
            from_transaction_id, to_transaction_id,
            offset_total, offset_from_transaction_id, offset_to_transaction_id,
            scope_from, scope_to, settled_at, status, confirmed_at)
         VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?,
                 CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE NULL END)`,
      )
      .bind(
        settlementId, groupId, debtorId, creditorId, cash, note,
        callerIsDebtor ? callerCashTxnId : null,
        callerIsDebtor || needsConfirmation ? null : callerCashTxnId,
        offset,
        callerIsDebtor ? callerOffsetTxnId : null,
        callerIsDebtor ? null : callerOffsetTxnId,
        scope.dateFrom ?? null, scope.dateTo ?? null,
        needsConfirmation ? 'awaiting_confirmation' : 'confirmed',
        needsConfirmation ? 'awaiting_confirmation' : 'confirmed',
      ),
    // Record exactly what this settlement put against each share, cash and
    // netting kept apart, so an undo can give back precisely what it took.
    ...applied.map((a) =>
      db
        .prepare(
          `INSERT INTO settlement_split_lines (settlement_id, share_id, amount, offset_amount)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(settlementId, a.id, a.cashPart, a.offsetPart),
    ),
  ]

  const results = await db.batch(writes)

  // ── Verify the optimistic guards held ────────────────
  //
  // batch() is atomic, so everything above committed together — but a CAS that
  // matched no rows is a successful statement affecting 0 rows, not an error.
  // If any missed, the settlement was recorded against a balance that had
  // already moved, so it must be undone explicitly.
  const lost = applied.filter((_, i) => (results[i]?.meta?.changes ?? 0) !== 1)

  if (lost.length > 0) {
    const survivors = applied.filter((a) => !lost.includes(a))
    await db.batch([
      // settlement_split_lines cascades from settlements.
      db.prepare('DELETE FROM settlements WHERE id = ?').bind(settlementId),
      ...[callerCashTxnId, callerOffsetTxnId]
        .filter((id): id is string => !!id)
        .map((id) => db.prepare('DELETE FROM transactions WHERE id = ?').bind(id)),
      // Restore only the shares this request actually changed, and only if they
      // still hold the value it wrote — never clobber a third party's update.
      // settled_at returns to NULL because the CAS required it to be NULL.
      // Restore whichever column this shape actually wrote. The awaiting path
      // never touched settled_amount, so rewinding it here would corrupt a
      // partially-settled share rather than repair it.
      // The awaiting path has nothing to rewind: its forward write was a no-op
      // probe that left status and settled_amount exactly as it found them, and
      // deleting the settlement above is what releases the splits. There used to
      // be an UPDATE here guarding on status='awaiting_confirmation', a status
      // the forward path never sets — it matched zero rows every time.
      ...survivors
        .filter(() => !needsConfirmation)
        .map((a) =>
          db
            .prepare(
              // Back to 'approved', not 'pending': the money is being unwound,
              // but the recipient's agreement to owe it is not. The netting this
              // request added comes back off with it.
              `UPDATE transaction_splits
                  SET settled_amount = ?, offset_amount = MAX(0, ROUND(offset_amount - ?, 2)),
                      settled_at = NULL, status = 'approved'
                WHERE id = ? AND settled_amount = ?`,
            )
            .bind(a.previousSettled, a.offsetPart, a.id, a.newSettled),
        ),
    ])

    console.warn(
      `settlement ${settlementId} rolled back: ${lost.length}/${applied.length} share guards lost a race`,
    )
    return c.json(
      { error: 'the outstanding balance changed while recording this settlement; please retry' },
      409,
    )
  }

  // U-13/B-18: surface when the amount was capped below what was requested.
  // The cap is now the NET, not one direction's gross — asking to pay more than
  // the net is asking to overpay, whatever either side's gross says.
  const response: { id: string; message?: string } = { id: settlementId }
  if (rawAmount !== undefined && rawAmount > Math.abs(n.net) + 0.005) {
    response.message =
      `Only ${Math.abs(n.net).toFixed(2)} was outstanding on balance. Recorded ${cash.toFixed(2)}.`
  }
  return c.json(response, 201)
})

// POST /api/settlements/:id/confirm — the creditor acknowledges the money
// arrived, and books their own leg into their own account (§5.2).
//
// This is where the debt actually clears. Until it runs, the debtor's cash has
// left and the claim is recorded, but the creditor's books are untouched — which
// is the point: one party cannot move the other's ledger.
settlements.post('/settlements/:id/confirm', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const accountId = String(b.accountId ?? '')

  const st = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND to_user = ?')
    .bind(id, userId)
    .first<{
      id: string
      from_user: string
      to_user: string
      amount: number
      note: string
      status: string
      offset_total: number
    }>()
  // 404 for anyone but the creditor — a settlement id must not be probeable.
  if (!st) return c.json({ error: 'settlement not found' }, 404)
  if (st.status !== 'awaiting_confirmation') {
    return c.json({ error: `this settlement is already ${st.status}` }, 409)
  }
  if (!accountId) return c.json({ error: 'accountId is required' }, 400)
  if (!(await canWriteAccount(db, userId, accountId))) {
    return c.json({ error: 'you do not have write access to the selected account' }, 400)
  }
  const acct = await db
    .prepare('SELECT user_id FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ user_id: string }>()
  if (!acct) return c.json({ error: 'account not found' }, 400)

  const { results: lines } = await db
    .prepare(
      `SELECT l.share_id, l.amount, l.offset_amount, ts.user_id AS debtor_id, t.category_id
         FROM settlement_split_lines l
         JOIN transaction_splits ts ON ts.id = l.share_id
         JOIN transactions t ON t.id = ts.transaction_id
        WHERE l.settlement_id = ?`,
    )
    .bind(id)
    .all<{
      share_id: string
      amount: number
      offset_amount: number
      debtor_id: string
      category_id: string | null
    }>()

  // Hoisted read: the current settled_amount of every share this will clear, so
  // each write can be guarded on exactly the value it was computed from.
  const shareIds = lines.map((l) => l.share_id)
  const current = new Map<string, number>()
  if (shareIds.length) {
    const { results } = await db
      .prepare(
        `SELECT id, settled_amount FROM transaction_splits
         WHERE id IN (${shareIds.map(() => '?').join(', ')})`,
      )
      .bind(...shareIds)
      .all<{ id: string; settled_amount: number }>()
    for (const r of results) current.set(r.id, r.settled_amount)
  }

  const debtor = await db
    .prepare('SELECT username FROM users WHERE id = ?')
    .bind(st.from_user)
    .first<{ username: string }>()
  const toTxnId = st.amount > 0.005 ? newId() : null
  // The confirmer's own netted leg. Both people discharge the offset, so both
  // book an expense for it — the payer's went in when they recorded it, this is
  // the other half. Categorised from the claims THEY discharged, which are the
  // lines where they are the debtor.
  const myOffsetLines = lines.filter((l) => l.debtor_id === userId && l.offset_amount > 0.005)
  const myOffset = cents(myOffsetLines.reduce((sum, l) => sum + l.offset_amount, 0))
  const myOffsetCats = new Set(myOffsetLines.map((l) => l.category_id))
  const offsetTxnId = myOffset > 0.005 ? newId() : null
  // Resolved into the confirmer's own categories: the claim being cleared sits
  // on the other person's transaction, and categories are per user.
  const offsetCategory = await ownCategoryLike(
    db,
    myOffsetCats.size === 1 ? (myOffsetLines[0]?.category_id ?? null) : null,
    userId,
  )

  const applied = lines.map((l) => ({
    shareId: l.share_id,
    previous: current.get(l.share_id) ?? 0,
    // Cash and netting both settle the claim; only the mix differs.
    next: cents((current.get(l.share_id) ?? 0) + l.amount + l.offset_amount),
    offset: l.offset_amount,
  }))

  const writes = [
    // Guards first, at known indices, so meta.changes can be checked positionally.
    ...applied.map((a) =>
      db
        .prepare(
          `UPDATE transaction_splits
              SET settled_amount = ?,
                  offset_amount = ROUND(offset_amount + ?, 2),
                  -- 'settled' only once the whole share is paid. Marking a
                  -- partly-paid share settled drops it out of the balance query
                  -- and silently forgives the remainder. The unpaid remainder
                  -- rests in 'approved' — money went against this claim, so it
                  -- is not something the recipient still has to review.
                  status = CASE WHEN ? >= share_amount THEN 'settled' ELSE 'approved' END,
                  settled_at = CASE WHEN ? >= share_amount THEN datetime('now') ELSE NULL END
            WHERE id = ? AND status IN ('pending', 'approved') AND settled_amount = ?`,
        )
        .bind(a.next, a.offset, a.next, a.next, a.shareId, a.previous),
    ),
    ...(offsetTxnId
      ? [
          db
            .prepare(
              `INSERT INTO transactions
                 (id, user_id, account_id, destination_account_id, date, merchant, description,
                  amount, type, category_id, tag, import_hash, is_balance_only, is_non_cash,
                  created_at, updated_at)
               VALUES (?, ?, ?, NULL, ?, 'Settlement', ?, ?, 'expense', ?, '[]', '', 0, 1,
                       datetime('now'), datetime('now'))`,
            )
            .bind(
              offsetTxnId,
              acct.user_id,
              accountId,
              todayStr(),
              `Settled by netting with ${debtor?.username ?? '(unknown user)'}`,
              myOffset,
              offsetCategory,
            ),
        ]
      : []),
    // Skipped when the net was zero: there is no money to receive, and a
    // RM0.00 "Settlement" row is noise in a ledger, not a record.
    ...(toTxnId
      ? [
          db
            .prepare(
              `INSERT INTO transactions
                 (id, user_id, account_id, destination_account_id, date, merchant, description,
                  amount, type, category_id, tag, import_hash, is_balance_only, created_at, updated_at)
               VALUES (?, ?, ?, NULL, ?, 'Settlement', ?, ?, 'income', NULL, '[]', '', 1,
                       datetime('now'), datetime('now'))`,
            )
            .bind(
              toTxnId,
              acct.user_id,
              accountId,
              todayStr(),
              `Settlement from ${debtor?.username ?? '(unknown user)'}${st.note ? ' — ' + st.note : ''}`,
              st.amount,
            ),
        ]
      : []),
    db
      .prepare(
        `UPDATE settlements SET status = 'confirmed', confirmed_at = datetime('now'),
                to_transaction_id = ?, offset_to_transaction_id = ?
          WHERE id = ? AND status = 'awaiting_confirmation'`,
      )
      .bind(toTxnId, offsetTxnId, id),
  ]

  const results = await db.batch(writes)
  const lost = applied.filter((_, i) => (results[i]?.meta?.changes ?? 0) !== 1)

  if (lost.length > 0) {
    // Same discipline as POST: batch() committed, but a CAS matching zero rows
    // is a successful statement. Undo our own writes and report the conflict.
    const survivors = applied.filter((a) => !lost.includes(a))
    await db.batch([
      ...[toTxnId, offsetTxnId]
        .filter((txnId): txnId is string => !!txnId)
        .map((txnId) => db.prepare('DELETE FROM transactions WHERE id = ?').bind(txnId)),
      db
        .prepare(
          `UPDATE settlements SET status = 'awaiting_confirmation', confirmed_at = NULL,
                  to_transaction_id = NULL, offset_to_transaction_id = NULL
            WHERE id = ?`,
        )
        .bind(id),
      ...survivors.map((a) =>
        db
          .prepare(
            `UPDATE transaction_splits
                SET settled_amount = ?, offset_amount = MAX(0, ROUND(offset_amount - ?, 2)),
                    settled_at = NULL, status = 'approved'
              WHERE id = ? AND settled_amount = ?`,
          )
          .bind(a.previous, a.offset, a.shareId, a.next),
      ),
    ])
    console.warn(`settlement ${id} confirm rolled back: ${lost.length}/${applied.length} guards lost a race`)
    return c.json({ error: 'this settlement changed while confirming it; please retry' }, 409)
  }

  return c.json({ id, status: 'confirmed', toTransactionId: toTxnId })
})

// POST /api/settlements/:id/reject — the creditor says the money never arrived.
//
// Symmetric with the recipient's right to reject a split. The claim is undone
// rather than deleted-and-forgotten: the debtor's expense leg goes (their money
// did not actually leave, or they will re-record it), and the splits return to
// pending so the debt is outstanding again.
settlements.post('/settlements/:id/reject', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : ''

  const st = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND to_user = ?')
    .bind(id, userId)
    .first<{
      id: string
      from_transaction_id: string | null
      offset_from_transaction_id: string | null
      from_user: string
      status: string
    }>()
  if (!st) return c.json({ error: 'settlement not found' }, 404)
  if (st.status !== 'awaiting_confirmation') {
    return c.json({ error: `this settlement is already ${st.status}` }, 409)
  }

  const { results: lines } = await db
    .prepare('SELECT share_id FROM settlement_split_lines WHERE settlement_id = ?')
    .bind(id)
    .all<{ share_id: string }>()

  // The splits' own status was never moved — marking the settlement rejected is
  // what releases them, because the claimable-amount query only excludes lines
  // belonging to an *awaiting* settlement. Each split therefore returns to
  // whichever resting state it held, 'pending' or 'approved', with no write.
  // Nothing was netted off them either: the netting applies at confirm, so a
  // rejected settlement leaves both directions exactly as it found them.
  void lines
  await db.batch([
    // Both of the payer's legs go: the cash they say left, and the netted
    // expense that stood for the debt they had discharged. Neither happened.
    ...[st.from_transaction_id, st.offset_from_transaction_id]
      .filter((txnId): txnId is string => !!txnId)
      .map((txnId) =>
        db
          .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
          .bind(txnId, st.from_user),
      ),
    db
      .prepare(
        `UPDATE settlements SET status = 'rejected', rejected_reason = ?,
                from_transaction_id = NULL, offset_from_transaction_id = NULL
          WHERE id = ?`,
      )
      .bind(reason, id),
  ])

  return c.json({ id, status: 'rejected' })
})

// GET /api/settlements — settlement history, filtered by groupId.
settlements.get('/settlements', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.query('groupId') ? String(c.req.query('groupId')) : null

  // The server used named parameters (@userId twice, @groupId). D1 is
  // positional, so the bind list is built alongside the SQL to keep the two in
  // step — @userId appearing three times becomes three separate binds.
  let sql = `
    SELECT s.*, uf.username AS from_username, ut.username AS to_username,
           s.original_transaction_id AS original_transaction_id
    FROM settlements s
    JOIN users uf ON uf.id = s.from_user
    JOIN users ut ON ut.id = s.to_user
    WHERE (s.from_user = ? OR s.to_user = ?)`
  const binds: unknown[] = [userId, userId]

  if (groupId) {
    // S-8: also verify the caller is a member of the requested group.
    sql += ` AND s.group_id = ?
             AND s.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)`
    binds.push(groupId, userId)
  }
  sql += ' ORDER BY s.settled_at DESC'

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json(results)
})

/**
 * How long a settlement stays undoable, in whole business-timezone days.
 *
 * Counted from the calendar date it was recorded, so "7" means "today plus the
 * next seven days" rather than a rolling 168 hours — the same shape the previous
 * same-day rule had, just wider. A named constant because the number appears in
 * the error message the user reads.
 */
const UNDO_WINDOW_DAYS = 7

// DELETE /api/settlements/:id — undo settlement (within UNDO_WINDOW_DAYS).
settlements.delete('/settlements/:id', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')

  // B-01: either party (debtor or creditor) may undo their settlement.
  const settlement = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND (from_user = ? OR to_user = ?)')
    .bind(id, userId, userId)
    .first<{
      id: string
      from_transaction_id: string | null
      to_transaction_id: string | null
      offset_from_transaction_id: string | null
      offset_to_transaction_id: string | null
      settled_at: string
      from_user: string
      to_user: string
      status: string
    }>()

  if (!settlement) return c.json({ error: 'settlement not found' }, 404)

  // Only allow undo within UNDO_WINDOW_DAYS, in the business timezone.
  //
  // The window was one calendar day, which in practice meant "until midnight" —
  // a settlement recorded at 23:00 was unundoable an hour later, and one spotted
  // the next morning could not be fixed at all. A week is long enough that a
  // mistake found at the weekend is still reversible, and still short enough
  // that undo cannot silently rewrite last month's books.
  //
  // Both sides are converted to business-timezone dates first. settled_at is
  // written by datetime('now'), which SQLite emits in UTC, so comparing it raw
  // against todayStr() compares a UTC date against an MYT date — they disagree
  // for the first 8 hours of every MYT day.
  const age = daysBetween(businessDateOf(settlement.settled_at), todayStr())
  if (age > UNDO_WINDOW_DAYS) {
    return c.json(
      { error: `can only undo a settlement within ${UNDO_WINDOW_DAYS} days of creating it` },
      409,
    )
  }

  // B-02: subtract exactly what this settlement applied to each share, and
  // re-open (settled_at = NULL) any share that is no longer fully cleared.
  const { results: lines } = await db
    .prepare(
      'SELECT share_id, amount, offset_amount FROM settlement_split_lines WHERE settlement_id = ?',
    )
    .bind(id)
    .all<{ share_id: string; amount: number; offset_amount: number }>()

  // All reads are done; the writes below are a straight batch() conversion of
  // the server's db.transaction() — no read-then-write, so no CAS needed.
  await db.batch([
    // Up to four legs: each side's cash leg and each side's netted expense.
    // Deleted with their owner in the WHERE, so an undo can never reach into the
    // other person's ledger for a row that is not theirs.
    ...([
      [settlement.from_transaction_id, settlement.from_user],
      [settlement.offset_from_transaction_id, settlement.from_user],
      [settlement.to_transaction_id, settlement.to_user],
      [settlement.offset_to_transaction_id, settlement.to_user],
    ] as const)
      .filter((pair): pair is readonly [string, string] => !!pair[0])
      .map(([txnId, owner]) =>
        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(txnId, owner),
      ),
    // An unconfirmed claim never applied its amounts — only the status moved.
    // Subtracting here would drive a partially-settled share negative and
    // "repair" it into corruption, so the two states rewind different columns.
    ...lines.map((line) =>
      settlement.status === 'awaiting_confirmation'
        ? // Nothing to rewind: an unconfirmed claim never applied its amounts,
          // and deleting the settlement below is what releases the splits.
          db.prepare('SELECT 1 WHERE ?').bind(line.share_id)
        : db
            .prepare(
              // 'approved', not 'pending'. Undoing a settlement takes back the
              // money, not the recipient's agreement that they owed it — and an
              // undo can land weeks later, so re-queueing the claim for review
              // would ask them to re-decide something they already decided.
              // Cash and netting both come back off: the claim was settled by
              // the sum of them, so giving back only the cash would leave it
              // looking part-paid by money that never existed.
              `UPDATE transaction_splits
                  SET settled_amount = MAX(0, ROUND(settled_amount - ?, 2)),
                      offset_amount = MAX(0, ROUND(offset_amount - ?, 2)),
                      status = 'approved',
                      settled_at = CASE WHEN ROUND(settled_amount - ?, 2) >= share_amount
                                        THEN settled_at ELSE NULL END
                WHERE id = ?`,
            )
            .bind(
              cents(line.amount + line.offset_amount),
              line.offset_amount,
              cents(line.amount + line.offset_amount),
              line.share_id,
            ),
    ),
    db.prepare('DELETE FROM settlements WHERE id = ?').bind(id),
  ])

  return c.body(null, 204)
})

// POST /api/transaction-shares/:id/settle — manually mark a single share settled.
settlements.post('/transaction-shares/:id/settle', async (c) => {
  const id = c.req.param('id')
  const share = await c.env.DB.prepare(
    'SELECT id FROM transaction_splits WHERE id = ? AND user_id = ?',
  )
    .bind(id, c.get('userId'))
    .first()
  if (!share) return c.json({ error: 'share not found' }, 404)

  await c.env.DB.prepare(
    "UPDATE transaction_splits SET settled_amount = share_amount, settled_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run()
  return c.json({ ok: true })
})

// POST /api/transaction-shares/:id/unsettle
settlements.post('/transaction-shares/:id/unsettle', async (c) => {
  const id = c.req.param('id')
  const share = await c.env.DB.prepare(
    'SELECT id FROM transaction_splits WHERE id = ? AND user_id = ?',
  )
    .bind(id, c.get('userId'))
    .first()
  if (!share) return c.json({ error: 'share not found' }, 404)

  await c.env.DB.prepare(
    'UPDATE transaction_splits SET settled_amount = 0, settled_at = NULL WHERE id = ?',
  )
    .bind(id)
    .run()
  return c.json({ ok: true })
})
