// Minimum-transfer settlement plan for a whole group — pure maths, no D1,
// no worker runtime imports. This is PR A of FEAT-024; see
// docs/backlog/EP-06-wallet-depth/FEAT-024-design.md §1 for the spec this
// file implements, and the design doc's "problem" section for why this is
// only half the feature: `POST /settlements` (CLAUDE.md §3) is bilateral by
// construction, so a transfer this module proposes between two people who
// share no splits (`direct: false`) cannot be executed by that endpoint
// as-is — it needs the three-party settlement in design.md §3 (PR C).
//
// Input is each member's net position in integer cents: positive = owed
// money (creditor), negative = owes money (debtor). Positions must sum to
// zero; this is asserted, not assumed, because a caller that fed in a
// partial or stale balance snapshot should get a thrown Error, not a plan
// that silently fails to balance.
//
// Algorithm:
//   - n <= 12 non-zero positions: EXACT. Minimum transfers for a balanced
//     set is (n - k), where k is the largest number of disjoint subsets
//     that are each individually zero-sum (a subset that is its own
//     "contained" sub-problem never needs a transfer crossing its
//     boundary). Found via bitmask DP over all 2^n subsets. Each subset is
//     then settled internally by greedy largest-debtor-to-largest-creditor,
//     which is optimal once a group is known to be a single zero-sum
//     component (standard result: greedy settles a zero-sum group of size m
//     in m-1 transfers, and m-1 is the lower bound for a connected group).
//   - n > 12: plain greedy over the whole set, never exact but guaranteed
//     <= n - 1 transfers.
//   - Tie-break: among equal-length settlements of a subset, prefer pairing
//     a debtor with a creditor they already have an on-graph debt to
//     (existingDebtCents), because that transfer can execute through the
//     unchanged bilateral POST /settlements today (direct: true) rather
//     than waiting on PR C's chain settlement.
//
// Deterministic: ids are sorted before any tie-breaking so equal inputs
// always produce an equal plan, and the final transfer list is sorted by
// (fromUserId, toUserId).

export interface Transfer {
  fromUserId: string
  toUserId: string
  amountCents: number
  /**
   * True when the debtor already owes the creditor at least this amount on
   * the existing bilateral debt graph (existingDebtCents), so this transfer
   * can execute through the current, unchanged POST /settlements. False
   * means it is an "off-graph" transfer — see design.md §3 (PR C, not yet
   * built) for how it would actually be executed.
   */
  direct: boolean
}

interface Position {
  id: string
  cents: number
}

const EXACT_LIMIT = 12

export function minTransfers(
  positionsCents: ReadonlyMap<string, number>,
  existingDebtCents?: ReadonlyMap<string, number>,
): Transfer[] {
  const debts = existingDebtCents ?? new Map<string, number>()

  let sum = 0
  for (const [id, cents] of positionsCents) {
    if (!Number.isInteger(cents)) {
      throw new Error(`minTransfers: non-integer position for "${id}": ${cents}`)
    }
    sum += cents
  }
  if (sum !== 0) {
    throw new Error(`minTransfers: positions must sum to 0, got ${sum}`)
  }
  for (const [key, cents] of debts) {
    if (!Number.isInteger(cents)) {
      throw new Error(`minTransfers: non-integer existing debt for "${key}": ${cents}`)
    }
  }

  // Drop zeros, sort ids for determinism.
  const nonZero: Position[] = [...positionsCents.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([id, cents]) => ({ id, cents }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  if (nonZero.length === 0) return []

  let transfers: Transfer[]
  if (nonZero.length <= EXACT_LIMIT) {
    transfers = exactPlan(nonZero, debts)
  } else {
    transfers = greedyPlan(nonZero, debts)
  }

  return transfers
    .filter((t) => t.amountCents !== 0)
    .sort((a, b) =>
      a.fromUserId !== b.fromUserId
        ? a.fromUserId < b.fromUserId
          ? -1
          : 1
        : a.toUserId < b.toUserId
          ? -1
          : a.toUserId > b.toUserId
            ? 1
            : 0,
    )
}

/** debtor:creditor -> cents the debtor already owes that creditor. */
function existingDebt(debts: ReadonlyMap<string, number>, debtorId: string, creditorId: string): number {
  return debts.get(`${debtorId}:${creditorId}`) ?? 0
}

// Exact solver: find the maximum number of disjoint zero-sum subsets among
// `positions` via bitmask DP, then settle each subset greedily.
function exactPlan(positions: Position[], debts: ReadonlyMap<string, number>): Transfer[] {
  const n = positions.length
  const full = (1 << n) - 1

  // zeroSum[mask] = true iff the positions selected by `mask` sum to 0.
  const zeroSum = new Array<boolean>(1 << n)
  for (let mask = 0; mask <= full; mask++) {
    let s = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) s += positions[i].cents
    }
    zeroSum[mask] = s === 0
  }

  // best[mask] = max number of disjoint zero-sum subsets partitioning
  // exactly the members of `mask` (mask itself must be zero-sum, since the
  // full input is zero-sum and we only ever recurse on zero-sum remainders).
  // We compute it via: best[mask] = max over zero-sum submasks `sub` of
  // mask containing its lowest set bit, of 1 + best[mask \ sub].
  const best = new Array<number>(1 << n).fill(-1)
  const choice = new Array<number>(1 << n).fill(0)
  best[0] = 0

  // Process masks in increasing order of popcount isn't required; any order
  // where submasks are resolved before their supersets works. Iterating
  // mask ascending satisfies that since mask \ sub < mask whenever sub != 0.
  for (let mask = 1; mask <= full; mask++) {
    if (!zeroSum[mask]) continue
    const low = mask & -mask
    // Enumerate submasks of `mask` that contain `low` (the lowest set bit of
    // mask) and are themselves zero-sum, to avoid counting the same
    // partition multiple times.
    let sub = mask
    let bestHere = -1
    let bestSub = 0
    while (sub > 0) {
      if ((sub & low) === low && zeroSum[sub]) {
        const rest = mask ^ sub
        const restBest = rest === 0 ? 0 : best[rest]
        if (restBest >= 0 && 1 + restBest > bestHere) {
          bestHere = 1 + restBest
          bestSub = sub
        }
      }
      sub = (sub - 1) & mask
    }
    best[mask] = bestHere
    choice[mask] = bestSub
  }

  // Reconstruct the subsets partitioning `full`.
  const subsets: number[] = []
  let remaining = full
  while (remaining !== 0) {
    const sub = choice[remaining]
    subsets.push(sub)
    remaining ^= sub
  }

  const transfers: Transfer[] = []
  for (const sub of subsets) {
    const members: Position[] = []
    for (let i = 0; i < n; i++) {
      if (sub & (1 << i)) members.push(positions[i])
    }
    transfers.push(...settleGroupGreedy(members, debts))
  }
  return transfers
}

// Settle a single zero-sum group of positions with greedy
// largest-debtor-to-largest-creditor, preferring on-graph pairs on ties.
function settleGroupGreedy(members: Position[], debts: ReadonlyMap<string, number>): Transfer[] {
  const working = members.map((p) => ({ ...p }))
  const transfers: Transfer[] = []

  // Iteration cap: a group of m members never needs more than m-1 transfers.
  const maxIterations = working.length
  for (let iter = 0; iter < maxIterations; iter++) {
    const debtors = working.filter((p) => p.cents < 0)
    const creditors = working.filter((p) => p.cents > 0)
    if (debtors.length === 0 || creditors.length === 0) break

    const pair = pickPair(debtors, creditors, debts)
    if (!pair) break

    const amount = Math.min(-pair.debtor.cents, pair.creditor.cents)
    if (amount <= 0) break

    const direct = existingDebt(debts, pair.debtor.id, pair.creditor.id) >= amount
    transfers.push({ fromUserId: pair.debtor.id, toUserId: pair.creditor.id, amountCents: amount, direct })

    pair.debtor.cents += amount
    pair.creditor.cents -= amount
  }

  return transfers
}

interface Pair {
  debtor: Position
  creditor: Position
}

// Prefer a debtor/creditor pair that has an existing on-graph debt able to
// carry the full amount of one side (so the transfer is `direct: true`).
// Among several such pairs, or when none exists, fall back to
// largest-debtor-vs-largest-creditor, both sorted by id for determinism.
function pickPair(debtors: Position[], creditors: Position[], debts: ReadonlyMap<string, number>): Pair | null {
  const sortedDebtors = [...debtors].sort((a, b) => sortByMagnitudeThenId(a, b))
  const sortedCreditors = [...creditors].sort((a, b) => sortByMagnitudeThenId(a, b))

  for (const debtor of sortedDebtors) {
    for (const creditor of sortedCreditors) {
      const amount = Math.min(-debtor.cents, creditor.cents)
      if (amount <= 0) continue
      if (existingDebt(debts, debtor.id, creditor.id) >= amount) {
        return { debtor, creditor }
      }
    }
  }

  if (sortedDebtors.length === 0 || sortedCreditors.length === 0) return null
  return { debtor: sortedDebtors[0], creditor: sortedCreditors[0] }
}

function sortByMagnitudeThenId(a: Position, b: Position): number {
  const magA = Math.abs(a.cents)
  const magB = Math.abs(b.cents)
  if (magA !== magB) return magB - magA // largest magnitude first
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Greedy over the whole set (n > EXACT_LIMIT). Not exact, but every step
// fully zeros at least one position, so a group of m non-zero positions
// never needs more than m-1 transfers.
function greedyPlan(positions: Position[], debts: ReadonlyMap<string, number>): Transfer[] {
  return settleGroupGreedy(positions, debts)
}

/**
 * Turn `debtor:creditor -> net cents owed` edges into net positions
 * (debtor negative, creditor positive), so callers can feed balance rows
 * straight into minTransfers without computing positions themselves.
 */
export function netPositions(edgesCents: ReadonlyMap<string, number>): Map<string, number> {
  const positions = new Map<string, number>()
  for (const [key, cents] of edgesCents) {
    if (!Number.isInteger(cents)) {
      throw new Error(`netPositions: non-integer amount for "${key}": ${cents}`)
    }
    if (cents === 0) continue
    const sep = key.indexOf(':')
    if (sep < 0) {
      throw new Error(`netPositions: malformed edge key "${key}", expected "debtorId:creditorId"`)
    }
    const debtorId = key.slice(0, sep)
    const creditorId = key.slice(sep + 1)
    positions.set(debtorId, (positions.get(debtorId) ?? 0) - cents)
    positions.set(creditorId, (positions.get(creditorId) ?? 0) + cents)
  }
  return positions
}
