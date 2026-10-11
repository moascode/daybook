import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { canWriteAccount, isGroupMember } from '../lib/sharing.ts'
import { businessDateOf, daysBetween, newId, todayStr } from '../lib.ts'
import { payableEdgesCents } from '../lib/settle-edges.ts'
import { routeTransfer, type RoutedPath } from '../lib/settle-path.ts'
import {
  allocate,
  cents,
  outstandingSplitsFor,
  ownCategoryLike,
  UNDO_WINDOW_DAYS,
  type Allocation,
} from './settlements.ts'

// FEAT-024 PR C (docs/backlog/EP-06-wallet-depth/FEAT-024-design.md §3) —
// three-party ("chain") settlement. A minimum-transfer plan (PR B) routinely
// proposes a payment between two people who share no splits: the money has
// to discharge two or more bilateral debt edges at once, and an
// intermediary's books move although they neither paid nor received
// anything. This route executes that atomically, on top of the same
// hand-built CAS discipline `worker/routes/settlements.ts` uses (CLAUDE.md
// §3) — D1 has no interactive transactions, so every read is hoisted, the
// whole write set is computed in JS, and ONE batch() per phase carries the
// compare-and-swap guards.
export const settlementChains = new Hono<AppEnv>()

interface Hop {
  fromUserId: string
  toUserId: string
  amountCents: number
}

/** Collapse routed paths into unique (from, to) hops, aggregating cents when
 * the same hop appears in more than one path — the spec's "aggregate if the
 * same hop appears in several paths". */
function aggregateHops(routed: RoutedPath[]): Hop[] {
  const totals = new Map<string, number>()
  for (const r of routed) {
    for (let i = 0; i < r.path.length - 1; i++) {
      const key = `${r.path[i]}:${r.path[i + 1]}`
      totals.set(key, (totals.get(key) ?? 0) + r.amountCents)
    }
  }
  return [...totals.entries()].map(([key, amountCents]) => {
    const sep = key.indexOf(':')
    return { fromUserId: key.slice(0, sep), toUserId: key.slice(sep + 1), amountCents }
  })
}

/** Every distinct user id touched by the routed paths, in first-appearance order. */
function partyOrder(routed: RoutedPath[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const r of routed) {
    for (const id of r.path) {
      if (!seen.has(id)) {
        seen.add(id)
        order.push(id)
      }
    }
  }
  return order
}

/** The category every discharged line agrees on, or null if they disagree —
 * same single-category rule settlements.ts's categoryOf uses, minus the
 * cash/offset split: a chain hop is wholly cash (payer) or wholly netted
 * (intermediary), never a mix of both within one hop. */
function categoryOf(lines: Allocation[]): string | null {
  if (lines.length === 0) return null
  const set = new Set(lines.map((l) => l.categoryId))
  return set.size === 1 ? (lines[0]?.categoryId ?? null) : null
}

async function usernamesOf(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { results } = await db
    .prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ id: string; username: string }>()
  return new Map(results.map((r) => [r.id, r.username]))
}

function insertTxn(
  db: D1Database,
  id: string,
  userId: string,
  accountId: string,
  description: string,
  type: 'expense' | 'income',
  amount: number,
  categoryId: string | null,
  isBalanceOnly: boolean,
  isNonCash: boolean,
) {
  return db
    .prepare(
      `INSERT INTO transactions
         (id, user_id, account_id, destination_account_id, date, merchant, description,
          amount, type, category_id, tag, import_hash, is_balance_only, is_non_cash,
          created_at, updated_at)
       VALUES
         (?, ?, ?, NULL, ?, 'Settlement', ?, ?, ?, ?, '[]', '', ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(
      id, userId, accountId, todayStr(), description, amount, type, categoryId,
      isBalanceOnly ? 1 : 0,
      isNonCash ? 1 : 0,
    )
}

interface HopPlan extends Hop {
  amount: number // dollars
  allocations: Allocation[]
}

/** Hoists the route + every hop's FIFO allocation. Shared by preview and create. */
async function planChain(
  db: D1Database,
  groupId: string,
  payerId: string,
  payeeId: string,
  amountCents: number,
): Promise<{ routed: RoutedPath[]; hops: HopPlan[]; parties: string[] }> {
  const edges = await payableEdgesCents(db, groupId)
  const routed = routeTransfer(edges, payerId, payeeId, amountCents)
  const aggregated = aggregateHops(routed)
  const hops: HopPlan[] = []
  for (const hop of aggregated) {
    const outstanding = await outstandingSplitsFor(db, groupId, hop.fromUserId, hop.toUserId)
    const amount = cents(hop.amountCents / 100)
    const allocations = allocate(outstanding, amount)
    hops.push({ ...hop, amount, allocations })
  }
  return { routed, hops, parties: partyOrder(routed) }
}

/**
 * POST /settlement-chains/preview — read-only, same route-finding + allocation
 * code the create endpoint uses (one definition, two callers, like
 * /settlements/preview). Lets the client show the hops before committing.
 */
settlementChains.post('/settlement-chains/preview', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const groupId = String(b.groupId ?? '')
  const payeeId = String(b.payeeId ?? '')
  const amount = Number(b.amount)
  if (!groupId || !payeeId) return c.json({ error: 'groupId and payeeId are required' }, 400)
  if (payeeId === callerId) return c.json({ error: 'payee must be someone else' }, 400)
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'amount must be a positive number' }, 400)
  }

  const [callerIn, payeeIn] = await Promise.all([
    isGroupMember(db, callerId, groupId),
    isGroupMember(db, payeeId, groupId),
  ])
  if (!callerIn) return c.json({ error: 'group not found' }, 404)
  if (!payeeIn) return c.json({ error: 'both users must be in the group' }, 403)

  const amountCents = Math.round(cents(amount) * 100)
  let plan: Awaited<ReturnType<typeof planChain>>
  try {
    plan = await planChain(db, groupId, callerId, payeeId, amountCents)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'could not route this transfer' }, 400)
  }

  const names = await usernamesOf(db, plan.parties)
  return c.json({
    hops: plan.hops.map((h) => ({
      fromUserId: h.fromUserId,
      fromUsername: names.get(h.fromUserId) ?? h.fromUserId,
      toUserId: h.toUserId,
      toUsername: names.get(h.toUserId) ?? h.toUserId,
      amount: h.amount,
    })),
    parties: plan.parties.map((id) => ({
      userId: id,
      username: names.get(id) ?? id,
      role: id === callerId ? 'payer' : id === payeeId ? 'payee' : 'intermediary',
    })),
  })
})

/**
 * POST /settlement-chains — the payer starts a chain. Hoists every read
 * (route, per-hop FIFO allocation, payer category), then ONE batch(): a
 * no-op probe CAS on every allocated split (reserving them exactly as the
 * bilateral awaiting-confirmation path does), the chain + party rows, the
 * payer's cash leg, the settlement rows (one per hop) and their split lines.
 */
settlementChains.post('/settlement-chains', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const groupId = String(b.groupId ?? '')
  const payeeId = String(b.payeeId ?? '')
  const accountId = String(b.accountId ?? '')
  const note = String(b.note ?? '')
  const amount = Number(b.amount)

  if (!groupId || !payeeId) return c.json({ error: 'groupId and payeeId are required' }, 400)
  if (payeeId === callerId) return c.json({ error: 'payee must be someone else' }, 400)
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'amount must be a positive number' }, 400)
  }
  if (!accountId) return c.json({ error: 'accountId is required' }, 400)

  const [callerIn, payeeIn] = await Promise.all([
    isGroupMember(db, callerId, groupId),
    isGroupMember(db, payeeId, groupId),
  ])
  if (!callerIn) return c.json({ error: 'group not found' }, 404)
  if (!payeeIn) return c.json({ error: 'both users must be in the group' }, 403)

  if (!(await canWriteAccount(db, callerId, accountId))) {
    return c.json({ error: 'you do not have write access to the selected account' }, 400)
  }
  const acct = await db
    .prepare('SELECT user_id FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ user_id: string }>()
  if (!acct) return c.json({ error: 'account not found' }, 400)

  const roundedAmount = cents(amount)
  const amountCents = Math.round(roundedAmount * 100)

  let plan: Awaited<ReturnType<typeof planChain>>
  try {
    plan = await planChain(db, groupId, callerId, payeeId, amountCents)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'could not route this transfer' }, 400)
  }
  const { hops, parties } = plan

  const payerLines = hops.filter((h) => h.fromUserId === callerId).flatMap((h) => h.allocations)
  const payerCategory = await ownCategoryLike(db, categoryOf(payerLines), callerId)

  const names = await usernamesOf(db, parties)
  const intermediaries = parties.filter((id) => id !== callerId && id !== payeeId)
  const intermediaryNames = intermediaries.map((id) => names.get(id) ?? id).join(', ')

  const chainId = newId()
  const cashTxnId = newId()
  const firstPayerHopIndex = hops.findIndex((h) => h.fromUserId === callerId)

  const allAllocations = hops.flatMap((h) => h.allocations)

  // Settlement row ids are needed by the split-line inserts below, so they
  // are minted up front rather than threaded out of the insert statements.
  const hopSettlementIds = hops.map(() => newId())

  const finalWrites = [
    // No-op probe CAS on every allocated split across every hop — the exact
    // reservation shape POST /settlements uses while awaiting_confirmation.
    ...allAllocations.map((a) =>
      db
        .prepare(
          `UPDATE transaction_splits SET settled_amount = settled_amount
            WHERE id = ? AND status IN ('pending', 'approved')
              AND settled_at IS NULL AND settled_amount = ?`,
        )
        .bind(a.id, a.previousSettled),
    ),
    db
      .prepare(
        `INSERT INTO settlement_chains
           (id, group_id, created_by, payer_id, payee_id, amount, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_confirmation', datetime('now'))`,
      )
      .bind(chainId, groupId, callerId, callerId, payeeId, roundedAmount, note),
    ...parties.map((id) =>
      db
        .prepare(
          `INSERT INTO settlement_chain_parties (chain_id, user_id, account_id, confirmed_at)
           VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)`,
        )
        .bind(chainId, id, id === callerId ? accountId : null, id === callerId ? 1 : 0),
    ),
    insertTxn(
      db, cashTxnId, acct.user_id, accountId,
      `Settlement to ${names.get(payeeId) ?? payeeId} via ${intermediaryNames}`,
      'expense', roundedAmount, payerCategory, false, false,
    ),
    ...hops.map((h, i) => {
      const isPayerHop = h.fromUserId === callerId
      return db
        .prepare(
          `INSERT INTO settlements
             (id, group_id, from_user, to_user, amount, currency, note,
              from_transaction_id, to_transaction_id,
              offset_total, offset_from_transaction_id, offset_to_transaction_id,
              scope_from, scope_to, settled_at, status, confirmed_at, chain_id)
           VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, NULL, ?, NULL, NULL, NULL, NULL,
                   datetime('now'), 'awaiting_confirmation', NULL, ?)`,
        )
        .bind(
          hopSettlementIds[i], groupId, h.fromUserId, h.toUserId,
          isPayerHop ? h.amount : 0, note,
          isPayerHop && i === firstPayerHopIndex ? cashTxnId : null,
          isPayerHop ? 0 : h.amount,
          chainId,
        )
    }),
    ...hops.flatMap((h, i) =>
      h.allocations.map((a) => {
        const isPayerHop = h.fromUserId === callerId
        return db
          .prepare(
            `INSERT INTO settlement_split_lines (settlement_id, share_id, amount, offset_amount)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(hopSettlementIds[i], a.id, isPayerHop ? a.appliedAmount : 0, isPayerHop ? 0 : a.appliedAmount)
      }),
    ),
  ]

  const results = await db.batch(finalWrites)
  const lost = allAllocations.filter((_, i) => (results[i]?.meta?.changes ?? 0) !== 1)

  if (lost.length > 0) {
    // Nothing moved real money yet (these were no-op probes), so compensation
    // is just deleting what this request inserted.
    await db.batch([
      db.prepare('DELETE FROM settlement_chains WHERE id = ?').bind(chainId),
      db.prepare('DELETE FROM transactions WHERE id = ?').bind(cashTxnId),
    ])
    console.warn(
      `settlement chain ${chainId} create rolled back: ${lost.length}/${allAllocations.length} probe guards lost a race`,
    )
    return c.json(
      { error: 'the outstanding balance changed while starting this settlement; please retry' },
      409,
    )
  }

  return c.json({ id: chainId }, 201)
})

/** GET /settlement-chains?groupId= — chains in that group the caller is a party to. */
settlementChains.get('/settlement-chains', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const groupId = c.req.query('groupId')
  if (!groupId) return c.json({ error: 'groupId is required' }, 400)
  if (!(await isGroupMember(db, callerId, groupId))) {
    return c.json({ error: 'group not found' }, 404)
  }

  const { results: chains } = await db
    .prepare(
      `SELECT sc.* FROM settlement_chains sc
       JOIN settlement_chain_parties scp ON scp.chain_id = sc.id AND scp.user_id = ?
       WHERE sc.group_id = ?
       ORDER BY sc.created_at DESC`,
    )
    .bind(callerId, groupId)
    .all<{
      id: string
      group_id: string
      created_by: string
      payer_id: string
      payee_id: string
      amount: number
      note: string
      status: string
      rejected_reason: string | null
      created_at: string
      confirmed_at: string | null
    }>()

  const out = []
  for (const chain of chains) {
    const { results: parties } = await db
      .prepare(
        `SELECT scp.user_id, u.username, scp.confirmed_at
           FROM settlement_chain_parties scp
           JOIN users u ON u.id = scp.user_id
          WHERE scp.chain_id = ?`,
      )
      .bind(chain.id)
      .all<{ user_id: string; username: string; confirmed_at: string | null }>()
    const { results: hops } = await db
      .prepare(
        `SELECT from_user AS from_user_id, to_user AS to_user_id,
                CASE WHEN from_user = ? THEN amount ELSE offset_total END AS amount
           FROM settlements WHERE chain_id = ?`,
      )
      .bind(chain.payer_id, chain.id)
      .all<{ from_user_id: string; to_user_id: string; amount: number }>()

    const hopTotalFor = (userId: string) =>
      cents(hops.filter((h) => h.from_user_id === userId).reduce((sum, h) => sum + h.amount, 0))

    out.push({
      id: chain.id,
      groupId: chain.group_id,
      payerId: chain.payer_id,
      payeeId: chain.payee_id,
      amount: chain.amount,
      note: chain.note,
      status: chain.status,
      rejectedReason: chain.rejected_reason,
      createdAt: chain.created_at,
      confirmedAt: chain.confirmed_at,
      parties: parties.map((p) => ({
        userId: p.user_id,
        username: p.username,
        role: p.user_id === chain.payer_id ? 'payer' : p.user_id === chain.payee_id ? 'payee' : 'intermediary',
        amount:
          p.user_id === chain.payer_id || p.user_id === chain.payee_id
            ? chain.amount
            : hopTotalFor(p.user_id),
        confirmed: !!p.confirmed_at,
      })),
      hops: hops.map((h) => ({ fromUserId: h.from_user_id, toUserId: h.to_user_id, amount: h.amount })),
    })
  }
  return c.json(out)
})

/**
 * Finalizes a chain once every party has confirmed: hoists EVERY read fresh
 * from the DB — never from the calling request — because by the time this
 * runs any party's account_id (including the caller's own) has already been
 * stored by the guarded party UPDATE in the route handler below. Computes
 * the whole write set in JS, issues ONE batch() guarded by a `confirmedAt`
 * value minted just for this attempt, and compensates on any miss.
 *
 * FINDING 2: a losing concurrent attempt's own chain-guard UPDATE affects 0
 * rows, but by the time ITS hop-row UPDATEs run (later in that same losing
 * batch) `settlement_chains.status` already reads 'confirmed' — set by
 * whichever attempt actually won, in an already-committed batch. A plain
 * `status = 'confirmed'` EXISTS check cannot tell "I won" from "someone else
 * won", so the hop-row guard instead checks `confirmed_at = <this attempt's
 * own value>` — a value only the winning attempt could have written.
 *
 * FINDING 3: returns 'confirmed' (this call finalized it), 'already'
 * (someone else's concurrent call won, or the chain was already confirmed by
 * the time this was checked), or 'conflict' (a split moved out from under
 * this chain; nothing was applied, the chain is left exactly as it stood,
 * and the caller should surface 409 — retryable, since no party's own
 * confirmation is undone by this failure, see the route handler).
 */
async function finalizeChain(
  db: D1Database,
  chainId: string,
): Promise<'confirmed' | 'already' | 'conflict'> {
  const statusRow = await db
    .prepare('SELECT status FROM settlement_chains WHERE id = ?')
    .bind(chainId)
    .first<{ status: string }>()
  if (!statusRow) return 'conflict'
  if (statusRow.status === 'confirmed') return 'already'
  if (statusRow.status !== 'awaiting_confirmation') return 'conflict'

  const row = await db
    .prepare('SELECT payer_id, payee_id, amount FROM settlement_chains WHERE id = ?')
    .bind(chainId)
    .first<{ payer_id: string; payee_id: string; amount: number }>()
  if (!row) return 'conflict'

  const { results: lines } = await db
    .prepare(
      `SELECT l.settlement_id, l.share_id, l.amount, l.offset_amount,
              s.from_user, s.to_user, t.category_id
         FROM settlement_split_lines l
         JOIN settlements s ON s.id = l.settlement_id
         JOIN transaction_splits ts ON ts.id = l.share_id
         JOIN transactions t ON t.id = ts.transaction_id
        WHERE s.chain_id = ?`,
    )
    .bind(chainId)
    .all<{
      settlement_id: string
      share_id: string
      amount: number
      offset_amount: number
      from_user: string
      to_user: string
      category_id: string | null
    }>()

  const shareIds = [...new Set(lines.map((l) => l.share_id))]
  const current = new Map<string, number>()
  if (shareIds.length) {
    const { results } = await db
      .prepare(
        `SELECT id, settled_amount FROM transaction_splits WHERE id IN (${shareIds.map(() => '?').join(', ')})`,
      )
      .bind(...shareIds)
      .all<{ id: string; settled_amount: number }>()
    for (const r of results) current.set(r.id, r.settled_amount)
  }

  const { results: hopRows } = await db
    .prepare(`SELECT id, from_user, to_user FROM settlements WHERE chain_id = ?`)
    .bind(chainId)
    .all<{ id: string; from_user: string; to_user: string }>()

  const { results: partyRows } = await db
    .prepare(`SELECT user_id, account_id FROM settlement_chain_parties WHERE chain_id = ?`)
    .bind(chainId)
    .all<{ user_id: string; account_id: string | null }>()
  // Every party's account — all read fresh from the DB, including the party
  // that triggered this finalize: their own account_id was already stored by
  // the route handler's guarded UPDATE before finalizeChain was ever called.
  const accountOf = new Map<string, string>(partyRows.map((p) => [p.user_id, p.account_id ?? '']))

  const names = await usernamesOf(db, [row.payer_id, row.payee_id])

  // Per-split net increment: amount + offset_amount discharged against it.
  const applied = shareIds.map((shareId) => {
    const forShare = lines.filter((l) => l.share_id === shareId)
    const delta = cents(forShare.reduce((sum, l) => sum + l.amount + l.offset_amount, 0))
    const offsetDelta = cents(forShare.reduce((sum, l) => sum + l.offset_amount, 0))
    const previous = current.get(shareId) ?? 0
    return { shareId, previous, next: cents(previous + delta), offset: offsetDelta }
  })

  // Every account chosen by any party, resolved to its actual owner in one
  // query — each leg is booked on the account its owner actually owns, same
  // as the bilateral path's callerAccountOwner lookups.
  const acctIds = [...new Set([...accountOf.values()].filter((v) => v))]
  const ownerOfAccount = new Map<string, string>()
  if (acctIds.length) {
    const { results: acctRows } = await db
      .prepare(`SELECT id, user_id FROM accounts WHERE id IN (${acctIds.map(() => '?').join(', ')})`)
      .bind(...acctIds)
      .all<{ id: string; user_id: string }>()
    for (const r of acctRows) ownerOfAccount.set(r.id, r.user_id)
  }
  const ownerOfUser = (uid: string) => ownerOfAccount.get(accountOf.get(uid) ?? '') ?? uid

  // Intermediaries: every distinct "from" user that is neither payer nor
  // payee, aggregated across their hops.
  const intermediaryIds = [...new Set(hopRows.map((h) => h.from_user))].filter(
    (uid) => uid !== row.payer_id,
  )
  const intermediaryLegs = new Map<string, { txnId: string; amount: number; category: string | null }>()
  for (const uid of intermediaryIds) {
    const myLines = lines.filter((l) => l.from_user === uid)
    const amount = cents(myLines.reduce((sum, l) => sum + l.offset_amount, 0))
    if (amount <= 0.005) continue
    const cat = categoryOf(
      myLines.map((l) => ({
        id: l.share_id,
        previousSettled: 0,
        newSettled: 0,
        appliedAmount: l.offset_amount,
        categoryId: l.category_id,
        merchant: '',
        date: '',
      })),
    )
    const category = await ownCategoryLike(db, cat, uid)
    intermediaryLegs.set(uid, { txnId: newId(), amount, category })
  }

  const payeeTxnId = row.amount > 0.005 ? newId() : null
  const firstPayeeHopId = hopRows.find((x) => x.to_user === row.payee_id)?.id ?? null

  // Minted once and reused on every statement below instead of calling
  // datetime('now') inline — the single value this specific attempt "owns",
  // which is what lets the hop-row guard (FINDING 2) and this attempt's own
  // identity be checked later in the same batch.
  const confirmedAt = (await db.prepare(`SELECT datetime('now') AS t`).first<{ t: string }>())!.t

  const writes = [
    // FINDING 4: the legacy POST /transaction-shares/:id/settle can move
    // settled_amount (and settled_at) on a split this chain also touches,
    // without changing status — so `status IN (...) AND settled_amount = ?`
    // alone can still match (this hoisted read simply sees the legacy write
    // as "current") while this write would still push the split past its
    // share_amount. `settled_at IS NULL` catches the legacy write directly;
    // the share_amount cap catches it even if some other path ever clears
    // settled_at without resetting the amount.
    ...applied.map((a) =>
      db
        .prepare(
          `UPDATE transaction_splits
              SET settled_amount = ?,
                  offset_amount = ROUND(offset_amount + ?, 2),
                  status = CASE WHEN ? >= share_amount THEN 'settled' ELSE 'approved' END,
                  settled_at = CASE WHEN ? >= share_amount THEN ? ELSE NULL END
            WHERE id = ? AND status IN ('pending', 'approved') AND settled_amount = ?
              AND settled_at IS NULL AND ? <= share_amount + 0.005`,
        )
        .bind(a.next, a.offset, a.next, a.next, confirmedAt, a.shareId, a.previous, a.next),
    ),
    db
      .prepare(
        `UPDATE settlement_chains SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'awaiting_confirmation'`,
      )
      .bind(confirmedAt, chainId),
    ...[...intermediaryLegs.entries()].map(([uid, leg]) =>
      insertTxn(
        db, leg.txnId, ownerOfUser(uid), accountOf.get(uid) ?? '',
        `Settled by three-way settlement (${names.get(row.payer_id) ?? row.payer_id} → ${names.get(row.payee_id) ?? row.payee_id})`,
        'expense', leg.amount, leg.category, false, true,
      ),
    ),
    ...(payeeTxnId
      ? [
          insertTxn(
            db, payeeTxnId, ownerOfUser(row.payee_id), accountOf.get(row.payee_id) ?? '',
            `Settlement from ${names.get(row.payer_id) ?? row.payer_id}`,
            'income', row.amount, null, true, false,
          ),
        ]
      : []),
    // FINDING 2: guarded so these only take effect when THIS attempt's own
    // chain-guard write above is the one that won — see the function
    // comment for why a plain status check cannot tell that apart from a
    // concurrent winner's already-committed write.
    ...hopRows.map((h) => {
      const leg = intermediaryLegs.get(h.from_user)
      const isPayeeHop = h.to_user === row.payee_id && h.id === firstPayeeHopId
      return db
        .prepare(
          `UPDATE settlements SET status = 'confirmed',
                  offset_from_transaction_id = CASE WHEN ? = 1 THEN ? ELSE offset_from_transaction_id END,
                  to_transaction_id = CASE WHEN ? = 1 THEN ? ELSE to_transaction_id END
            WHERE id = ? AND status = 'awaiting_confirmation'
              AND EXISTS (
                SELECT 1 FROM settlement_chains WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?
              )`,
        )
        .bind(
          leg ? 1 : 0, leg?.txnId ?? null, isPayeeHop ? 1 : 0, isPayeeHop ? payeeTxnId : null,
          h.id, chainId, confirmedAt,
        )
    }),
  ]

  const results = await db.batch(writes)
  const chainGuardOk = (results[applied.length]?.meta?.changes ?? 0) === 1
  const splitGuardsLost = applied.filter((_, i) => (results[i]?.meta?.changes ?? 0) !== 1)

  if (!chainGuardOk || splitGuardsLost.length > 0) {
    const survivors = applied.filter((a) => !splitGuardsLost.includes(a))
    const insertedTxnIds = [
      ...[...intermediaryLegs.values()].map((l) => l.txnId),
      ...(payeeTxnId ? [payeeTxnId] : []),
    ]
    await db.batch([
      ...insertedTxnIds.map((txnId) => db.prepare('DELETE FROM transactions WHERE id = ?').bind(txnId)),
      // Only this attempt's own win is this attempt's to unwind. When the
      // chain guard itself missed, nothing chain-shaped was touched by this
      // attempt (the EXISTS-guarded hop writes above are a no-op in that
      // case too, by construction), so there is nothing to restore here —
      // doing so unconditionally is exactly what used to resurrect a chain a
      // concurrent reject had already won (FINDING 2).
      ...(chainGuardOk
        ? [
            db
              .prepare(
                `UPDATE settlement_chains SET status = 'awaiting_confirmation', confirmed_at = NULL
                  WHERE id = ? AND status = 'confirmed'`,
              )
              .bind(chainId),
            db
              .prepare(
                `UPDATE settlements SET status = 'awaiting_confirmation',
                        offset_from_transaction_id = NULL, to_transaction_id = NULL
                  WHERE chain_id = ? AND status = 'confirmed'`,
              )
              .bind(chainId),
          ]
        : []),
      // Note: no party_chain_parties restore here. Party confirmation is
      // written by the route handler as its own immediate, guarded statement
      // BEFORE finalizeChain is ever called, and it is deliberately never
      // undone by a failed finalize — see FINDING 3's comment on the route.
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
    console.warn(
      `settlement chain ${chainId} confirm rolled back: chain guard ${chainGuardOk}, ${splitGuardsLost.length}/${applied.length} split guards lost a race`,
    )
    if (!chainGuardOk) {
      // Distinguish "a concurrent finalize already won" (the chain is really
      // confirmed — report success) from "the chain was rejected/cancelled
      // out from under us" (report conflict).
      const after = await db
        .prepare('SELECT status FROM settlement_chains WHERE id = ?')
        .bind(chainId)
        .first<{ status: string }>()
      return after?.status === 'confirmed' ? 'already' : 'conflict'
    }
    return 'conflict'
  }

  return 'confirmed'
}

/**
 * POST /settlement-chains/:id/confirm — a non-payer party confirms, picking
 * their own account.
 *
 * FINDING 3: this used to decide "am I the last unconfirmed party" from a
 * snapshot taken before any write, then bundle that party's own confirmation
 * into the SAME batch as finalization. If two parties both still appeared
 * unconfirmed to each other at that snapshot (a genuine concurrent confirm),
 * BOTH took the non-last path and nobody ever finalized — a deadlock. The
 * party-row write below is now its own immediate, guarded statement, always
 * sticking whatever happens next; finalization is driven off a FRESH
 * re-count of who is still unconfirmed, taken right after that write. And
 * because the party write and finalizeChain are no longer one unit, a failed
 * finalize (FINDING 2) never has to undo this party's own confirmation —
 * which is what makes the retry below possible at all.
 */
settlementChains.post('/settlement-chains/:id/confirm', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const accountId = String(b.accountId ?? '')

  const row = await db
    .prepare(
      `SELECT sc.id, sc.status, scp.confirmed_at AS my_confirmed_at
         FROM settlement_chains sc
         JOIN settlement_chain_parties scp ON scp.chain_id = sc.id AND scp.user_id = ?
        WHERE sc.id = ?`,
    )
    .bind(callerId, id)
    .first<{ id: string; status: string; my_confirmed_at: string | null }>()
  // 404 for anyone who is not a party — a chain id must not be probeable, and
  // a group member who isn't on this chain gets the same answer.
  if (!row) return c.json({ error: 'settlement chain not found' }, 404)
  if (row.status !== 'awaiting_confirmation') {
    return c.json({ error: `this settlement is already ${row.status}` }, 409)
  }
  if (!accountId) return c.json({ error: 'accountId is required' }, 400)
  if (!(await canWriteAccount(db, callerId, accountId))) {
    return c.json({ error: 'you do not have write access to the selected account' }, 400)
  }
  const acct = await db
    .prepare('SELECT user_id FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ user_id: string }>()
  if (!acct) return c.json({ error: 'account not found' }, 400)

  if (row.my_confirmed_at) {
    // Already confirmed by this party on an earlier call. If anyone else is
    // still outstanding this is the ordinary "already confirmed" response;
    // if nobody is, the chain is stuck awaiting — a previous finalize
    // attempt (by this party or another) must have lost a split-guard race
    // — and this retry is the only way to drive it forward. Any party,
    // including one who already confirmed, may trigger finalizeChain here.
    const { results: unconfirmed } = await db
      .prepare(`SELECT user_id FROM settlement_chain_parties WHERE chain_id = ? AND confirmed_at IS NULL`)
      .bind(id)
      .all<{ user_id: string }>()
    if (unconfirmed.length > 0) {
      return c.json({ error: 'you have already confirmed this settlement' }, 409)
    }
  } else {
    const res = await db
      .prepare(
        `UPDATE settlement_chain_parties SET confirmed_at = datetime('now'), account_id = ?
          WHERE chain_id = ? AND user_id = ? AND confirmed_at IS NULL`,
      )
      .bind(accountId, id, callerId)
      .run()
    if (!res.meta.changes) {
      // Lost to a concurrent confirm from this same party (a double-submit).
      return c.json({ error: 'you have already confirmed this settlement' }, 409)
    }
    const { results: unconfirmed } = await db
      .prepare(`SELECT user_id FROM settlement_chain_parties WHERE chain_id = ? AND confirmed_at IS NULL`)
      .bind(id)
      .all<{ user_id: string }>()
    if (unconfirmed.length > 0) {
      return c.json({ status: 'awaiting_confirmation' })
    }
  }

  const result = await finalizeChain(db, id)
  if (result === 'conflict') {
    return c.json({ error: 'this settlement changed while confirming it; please retry' }, 409)
  }
  return c.json({ id, status: 'confirmed' })
})

/**
 * POST /settlement-chains/:id/reject — any party other than the payer, while
 * the chain is still awaiting confirmation. Splits were never moved (only a
 * no-op probe ran at creation), so nothing needs reversing — just the
 * payer's cash leg and the rows.
 *
 * FINDING 1: the final confirm can commit between this handler's read of
 * `row.status` and this batch — both reject and a last confirm act on the
 * same awaiting chain, and only one may win. Unguarded, reject would delete
 * the payer's cash leg and mark the chain rejected while every split a
 * winning confirm just settled stays settled. So the chain row is the FIRST
 * write (guarded on 'awaiting_confirmation'), and every later write is
 * additionally self-guarded on that same chain now actually being
 * 'rejected' — which only this statement, if it won, could have set.
 */
settlementChains.post('/settlement-chains/:id/reject', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : ''

  const row = await db
    .prepare(
      `SELECT sc.id, sc.payer_id, sc.status
         FROM settlement_chains sc
         JOIN settlement_chain_parties scp ON scp.chain_id = sc.id AND scp.user_id = ?
        WHERE sc.id = ?`,
    )
    .bind(callerId, id)
    .first<{ id: string; payer_id: string; status: string }>()
  if (!row) return c.json({ error: 'settlement chain not found' }, 404)
  if (callerId === row.payer_id) {
    return c.json({ error: 'the payer cannot reject their own settlement; cancel it instead' }, 403)
  }
  if (row.status !== 'awaiting_confirmation') {
    return c.json({ error: `this settlement is already ${row.status}` }, 409)
  }

  const { results: hops } = await db
    .prepare('SELECT id, from_transaction_id FROM settlements WHERE chain_id = ?')
    .bind(id)
    .all<{ id: string; from_transaction_id: string | null }>()
  const cashTxnId = hops.map((h) => h.from_transaction_id).find((x): x is string => !!x) ?? null

  const results = await db.batch([
    db
      .prepare(
        `UPDATE settlement_chains SET status = 'rejected', rejected_reason = ?
          WHERE id = ? AND status = 'awaiting_confirmation'`,
      )
      .bind(reason, id),
    ...(cashTxnId
      ? [
          db
            .prepare(
              `DELETE FROM transactions WHERE id = ? AND user_id = ?
                 AND EXISTS (SELECT 1 FROM settlement_chains WHERE id = ? AND status = 'rejected')`,
            )
            .bind(cashTxnId, row.payer_id, id),
        ]
      : []),
    db
      .prepare(
        `UPDATE settlements SET status = 'rejected', from_transaction_id = NULL
          WHERE chain_id = ? AND status = 'awaiting_confirmation'
            AND EXISTS (SELECT 1 FROM settlement_chains WHERE id = ? AND status = 'rejected')`,
      )
      .bind(id, id),
  ])

  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const current = await db
      .prepare('SELECT status FROM settlement_chains WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
    return c.json({ error: `this settlement is already ${current?.status ?? 'confirmed'}` }, 409)
  }

  return c.json({ id, status: 'rejected' })
})

/**
 * DELETE /settlement-chains/:id — undo. Awaiting: payer only may cancel.
 * Confirmed: within UNDO_WINDOW_DAYS, measured exactly like
 * DELETE /settlements/:id (business-tz dates). No CAS needed on either path
 * — no read-then-write, same as the bilateral undo.
 */
settlementChains.delete('/settlement-chains/:id', async (c) => {
  const callerId = c.get('userId')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(
      `SELECT sc.id, sc.payer_id, sc.status, sc.confirmed_at
         FROM settlement_chains sc
         JOIN settlement_chain_parties scp ON scp.chain_id = sc.id AND scp.user_id = ?
        WHERE sc.id = ?`,
    )
    .bind(callerId, id)
    .first<{ id: string; payer_id: string; status: string; confirmed_at: string | null }>()
  if (!row) return c.json({ error: 'settlement chain not found' }, 404)

  if (row.status === 'awaiting_confirmation') {
    if (callerId !== row.payer_id) {
      return c.json({ error: 'only the payer may cancel an unconfirmed settlement' }, 403)
    }
    const { results: hops } = await db
      .prepare('SELECT from_transaction_id FROM settlements WHERE chain_id = ?')
      .bind(id)
      .all<{ from_transaction_id: string | null }>()
    const cashTxnId = hops.map((h) => h.from_transaction_id).find((x): x is string => !!x) ?? null
    // FINDING 1 (same shape as reject): a final confirm can commit between
    // the read above and this batch. The chain delete is guarded on its own
    // status; the cash-leg delete and the settlements delete are each
    // self-guarded on the hop rows still being 'awaiting_confirmation' —
    // confirm flips both the chain AND the settlements rows to 'confirmed'
    // together in one winning batch, so if confirm won, every guard here
    // misses and this cancel becomes a no-op instead of unwinding a
    // settlement that already completed.
    const results = await db.batch([
      db.prepare(`DELETE FROM settlement_chains WHERE id = ? AND status = 'awaiting_confirmation'`).bind(id),
      ...(cashTxnId
        ? [
            db
              .prepare(
                `DELETE FROM transactions WHERE id = ? AND user_id = ?
                   AND EXISTS (SELECT 1 FROM settlements WHERE chain_id = ? AND status = 'awaiting_confirmation')`,
              )
              .bind(cashTxnId, row.payer_id, id),
          ]
        : []),
      db.prepare(`DELETE FROM settlements WHERE chain_id = ? AND status = 'awaiting_confirmation'`).bind(id),
    ])
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      const current = await db
        .prepare('SELECT status FROM settlement_chains WHERE id = ?')
        .bind(id)
        .first<{ status: string }>()
      return c.json({ error: `this settlement is already ${current?.status ?? 'confirmed'}` }, 409)
    }
    return c.body(null, 204)
  }

  if (row.status !== 'confirmed') {
    return c.json({ error: `this settlement is already ${row.status}` }, 409)
  }

  const age = daysBetween(businessDateOf(row.confirmed_at ?? ''), todayStr())
  if (age > UNDO_WINDOW_DAYS) {
    return c.json(
      { error: `can only undo a settlement within ${UNDO_WINDOW_DAYS} days of confirming it` },
      409,
    )
  }

  const { results: hops } = await db
    .prepare(
      `SELECT id, from_user, to_user, from_transaction_id, offset_from_transaction_id, to_transaction_id
         FROM settlements WHERE chain_id = ?`,
    )
    .bind(id)
    .all<{
      id: string
      from_user: string
      to_user: string
      from_transaction_id: string | null
      offset_from_transaction_id: string | null
      to_transaction_id: string | null
    }>()

  const { results: lines } = await db
    .prepare(
      `SELECT l.share_id, l.amount, l.offset_amount, s.from_user
         FROM settlement_split_lines l
         JOIN settlements s ON s.id = l.settlement_id
        WHERE s.chain_id = ?`,
    )
    .bind(id)
    .all<{ share_id: string; amount: number; offset_amount: number; from_user: string }>()

  const legOwners: Array<readonly [string, string]> = []
  for (const h of hops) {
    if (h.from_transaction_id) legOwners.push([h.from_transaction_id, h.from_user])
    if (h.offset_from_transaction_id) legOwners.push([h.offset_from_transaction_id, h.from_user])
    if (h.to_transaction_id) legOwners.push([h.to_transaction_id, h.to_user])
  }

  await db.batch([
    ...legOwners.map(([txnId, owner]) =>
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(txnId, owner),
    ),
    ...lines.map((line) =>
      db
        .prepare(
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
    db.prepare('DELETE FROM settlements WHERE chain_id = ?').bind(id),
    db.prepare('DELETE FROM settlement_chains WHERE id = ?').bind(id),
  ])

  return c.body(null, 204)
})
