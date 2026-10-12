// Route-finding for FEAT-024 PR C (docs/backlog/EP-06-wallet-depth/FEAT-024-design.md
// §3) — pure maths, no D1, no worker runtime imports, mirroring min-transfers.ts.
//
// Given the payable, bilaterally-netted debt edges a group currently holds
// (the same edges GET /groups/:id/settle-plan builds — see
// worker/lib/settle-edges.ts), find a set of paths from a payer to a payee
// that together carry a requested cash amount, so a transfer the minimum-
// transfer plan proposes between two people who share no direct debt can
// still be executed by discharging every edge along the way.
//
// Repeated BFS augmenting paths (a textbook Edmonds–Karp maxflow), shortest
// path each time, until the amount is routed or no augmenting path remains.
// Integer cents throughout. Deterministic: neighbours are visited in sorted
// id order, so equal inputs always produce an equal route.

export interface RoutedPath {
  /** Ordered user ids from payer to payee, inclusive. Length >= 3 (>= 2 hops). */
  path: string[]
  amountCents: number
}

/**
 * `edgesCents` keys are `"debtorId:creditorId"` strings mapping to the
 * remaining payable cents the debtor owes the creditor — exactly the shape
 * `worker/lib/settle-edges.ts`'s `payableEdgesCents` produces and
 * `GET /groups/:id/settle-plan` already consumes via `netPositions`.
 *
 * Throws when:
 * - payer and payee are directly connected (a 1-hop "path") — that is a plain
 *   bilateral transfer, which the caller should execute via `POST
 *   /settlements` instead of a chain.
 * - the total capacity routable from payer to payee is less than
 *   `amountCents` — the transfer cannot be fully discharged through existing
 *   debts.
 */
export function routeTransfer(
  edgesCents: ReadonlyMap<string, number>,
  payerId: string,
  payeeId: string,
  amountCents: number,
): RoutedPath[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`routeTransfer: amountCents must be a positive integer, got ${amountCents}`)
  }

  // Mutable residual capacity map, decremented as paths are found — the
  // standard Edmonds–Karp residual graph. Only forward capacity matters here:
  // discharging a debtor->creditor edge never creates reverse capacity,
  // because this is not a flow network with "undo" — it is FIFO discharge of
  // real outstanding splits.
  const residual = new Map(edgesCents)

  // Reject a direct 1-hop transfer up front — regardless of remaining
  // capacity elsewhere, the caller should use the bilateral endpoint for it.
  if ((residual.get(`${payerId}:${payeeId}`) ?? 0) > 0) {
    throw new Error('this transfer is a direct, one-hop debt; use POST /settlements instead')
  }

  // Build an adjacency list once: for each debtor, every creditor they have
  // positive remaining capacity toward, sorted by id for determinism.
  const neighbours = (from: string): string[] => {
    const out: string[] = []
    for (const key of residual.keys()) {
      const sep = key.indexOf(':')
      const debtorId = key.slice(0, sep)
      if (debtorId !== from) continue
      const creditorId = key.slice(sep + 1)
      if ((residual.get(key) ?? 0) > 0) out.push(creditorId)
    }
    return out.sort()
  }

  const routed: RoutedPath[] = []
  let remaining = amountCents

  while (remaining > 0) {
    // BFS shortest augmenting path from payer to payee over edges with
    // remaining capacity.
    const parent = new Map<string, string>()
    const visited = new Set<string>([payerId])
    const queue: string[] = [payerId]
    let found = false
    while (queue.length > 0 && !found) {
      const u = queue.shift() as string
      for (const v of neighbours(u)) {
        if (visited.has(v)) continue
        visited.add(v)
        parent.set(v, u)
        if (v === payeeId) {
          found = true
          break
        }
        queue.push(v)
      }
    }
    if (!found) {
      throw new Error('this transfer cannot be routed through existing debts')
    }

    // Reconstruct the path payer -> ... -> payee.
    const path: string[] = [payeeId]
    let cur = payeeId
    while (cur !== payerId) {
      const p = parent.get(cur) as string
      path.push(p)
      cur = p
    }
    path.reverse()

    // Bottleneck capacity along this path.
    let bottleneck = Infinity
    for (let i = 0; i < path.length - 1; i++) {
      const cap = residual.get(`${path[i]}:${path[i + 1]}`) ?? 0
      bottleneck = Math.min(bottleneck, cap)
    }
    const amount = Math.min(bottleneck, remaining)
    if (amount <= 0) {
      throw new Error('this transfer cannot be routed through existing debts')
    }

    routed.push({ path, amountCents: amount })
    for (let i = 0; i < path.length - 1; i++) {
      const key = `${path[i]}:${path[i + 1]}`
      residual.set(key, (residual.get(key) ?? 0) - amount)
    }
    remaining -= amount
  }

  return routed
}
