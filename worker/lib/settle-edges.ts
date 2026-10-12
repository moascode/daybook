// Shared edge-building query for FEAT-024 (PR B's `GET /groups/:id/settle-plan`
// and PR C's `worker/routes/settlement-chains.ts`) — one definition, two
// callers, same discipline as `outstandingSplitsFor` in settlements.ts.
//
// Extracted verbatim out of groups.ts so the settle-plan endpoint and the
// chain route-finder see exactly the same payable debt graph: the PAYABLE set
// `outstandingSplitsFor` discharges (pending/approved, not yet claimed into an
// awaiting_confirmation settlement), netted bilaterally into a single
// directed edge per pair, in integer cents. A chain routed over edges this
// query did not build is a promise the commit does not have to keep.

/**
 * The group's current payable debt graph, netted bilaterally into one
 * directed `"debtorId:creditorId" -> cents` edge per pair. Only a positive
 * net direction is kept — if raw rows run both ways between two people, the
 * smaller is already subtracted off here.
 */
export async function payableEdgesCents(
  db: D1Database,
  groupId: string,
): Promise<Map<string, number>> {
  const { results: rows } = await db
    .prepare(
      `SELECT ts.user_id AS debtor_id, t.user_id AS creditor_id,
              SUM(ts.share_amount - ts.settled_amount) AS total_owed
       FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       JOIN group_members gm_d ON gm_d.user_id = ts.user_id AND gm_d.group_id = ?
       JOIN group_members gm_c ON gm_c.user_id = t.user_id AND gm_c.group_id = ?
       WHERE ts.settled_at IS NULL AND ts.user_id != t.user_id
         AND ts.status IN ('pending', 'approved')
         AND ts.id NOT IN (
           SELECT l.share_id FROM settlement_split_lines l
           JOIN settlements sx ON sx.id = l.settlement_id
           WHERE sx.status = 'awaiting_confirmation'
         )
       GROUP BY ts.user_id, t.user_id`,
    )
    .bind(groupId, groupId)
    .all<{ debtor_id: string; creditor_id: string; total_owed: number }>()

  // Net bilaterally into a single directed edge per pair, in integer cents.
  const raw = new Map<string, number>()
  for (const row of rows) {
    const cents = Math.round(row.total_owed * 100)
    if (cents === 0) continue
    const fwd = `${row.debtor_id}:${row.creditor_id}`
    const rev = `${row.creditor_id}:${row.debtor_id}`
    if (raw.has(rev)) {
      raw.set(rev, (raw.get(rev) ?? 0) - cents)
    } else {
      raw.set(fwd, (raw.get(fwd) ?? 0) + cents)
    }
  }
  const edges = new Map<string, number>()
  for (const [key, cents] of raw) {
    if (cents === 0) continue
    if (cents > 0) {
      edges.set(key, cents)
    } else {
      const sep = key.indexOf(':')
      const debtorId = key.slice(0, sep)
      const creditorId = key.slice(sep + 1)
      edges.set(`${creditorId}:${debtorId}`, -cents)
    }
  }
  return edges
}
