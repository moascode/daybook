// Unit tests for the pure minTransfers / netPositions functions.
//
// Runner: this repo has no unit-test runner configured (only Playwright
// e2e — see docs/reference/testing.md). Per CLAUDE.md §2, an unlisted
// package (vitest/jest) is never installed without asking, so this file
// uses Node's built-in `node:test` + `node:assert/strict`, exercised
// through the already-present `tsx` devDependency, same as
// src/modules/tasks/composer/parseTaskComposerInput.test.ts:
//
//   npx tsx --test worker/lib/min-transfers.test.ts
//
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minTransfers, netPositions, type Transfer } from './min-transfers'

function sumTransfersByPerson(positions: Map<string, number>, transfers: Transfer[]): Map<string, number> {
  const result = new Map(positions)
  for (const t of transfers) {
    result.set(t.fromUserId, (result.get(t.fromUserId) ?? 0) + t.amountCents)
    result.set(t.toUserId, (result.get(t.toUserId) ?? 0) - t.amountCents)
  }
  return result
}

test('empty positions map returns no transfers', () => {
  assert.deepEqual(minTransfers(new Map()), [])
})

test('all-zero positions returns no transfers', () => {
  const positions = new Map([
    ['a', 0],
    ['b', 0],
  ])
  assert.deepEqual(minTransfers(positions), [])
})

test('two people == bilateral net, direct when the existing debt covers it', () => {
  const positions = new Map([
    ['a', -100],
    ['b', 100],
  ])
  const existingDebt = new Map([['a:b', 100]])
  const plan = minTransfers(positions, existingDebt)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0], { fromUserId: 'a', toUserId: 'b', amountCents: 100, direct: true })
})

test('two people with no existing-debt map is non-direct', () => {
  const positions = new Map([
    ['a', -100],
    ['b', 100],
  ])
  const plan = minTransfers(positions)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0], { fromUserId: 'a', toUserId: 'b', amountCents: 100, direct: false })
})

test('A owes B, B owes C by the same amount: B nets to zero and the chain collapses to one A->C transfer', () => {
  // A owes B 40, B owes C 40. B's net position is 0 (owed 40, owes 40) and
  // drops out entirely; the plan is a single off-graph A->C transfer.
  const positions = netPositions(
    new Map([
      ['a:b', 4000],
      ['b:c', 4000],
    ]),
  )
  const existingDebt = new Map([
    ['a:b', 4000],
    ['b:c', 4000],
  ])
  const plan = minTransfers(positions, existingDebt)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0], { fromUserId: 'a', toUserId: 'c', amountCents: 4000, direct: false })
})

test('a cycle of equal amounts (A->B->C->A) nets everyone to zero: no transfers', () => {
  const positions = netPositions(
    new Map([
      ['a:b', 5000],
      ['b:c', 5000],
      ['c:a', 5000],
    ]),
  )
  assert.deepEqual(minTransfers(positions), [])
})

test('four people as two independent zero-sum pairs settle in 2 transfers, not 3', () => {
  const positions = new Map([
    ['a', -30],
    ['b', 30],
    ['c', -20],
    ['d', 20],
  ])
  const plan = minTransfers(positions)
  assert.equal(plan.length, 2)
  const byFrom = new Map(plan.map((t) => [t.fromUserId, t]))
  assert.equal(byFrom.get('a')?.toUserId, 'b')
  assert.equal(byFrom.get('a')?.amountCents, 30)
  assert.equal(byFrom.get('c')?.toUserId, 'd')
  assert.equal(byFrom.get('c')?.amountCents, 20)
})

test('positions that do not sum to zero throw', () => {
  const positions = new Map([
    ['a', -100],
    ['b', 50],
  ])
  assert.throws(() => minTransfers(positions), /sum to 0/)
})

test('a non-integer position throws', () => {
  const positions = new Map([
    ['a', -100.5],
    ['b', 100.5],
  ])
  assert.throws(() => minTransfers(positions), /non-integer/)
})

test('a non-integer existing-debt value throws', () => {
  const positions = new Map([
    ['a', -100],
    ['b', 100],
  ])
  const existingDebt = new Map([['a:b', 99.9]])
  assert.throws(() => minTransfers(positions, existingDebt), /non-integer/)
})

test('tie-break: the on-graph pairing is preferred over plain magnitude ordering', () => {
  // A owes 100, B owes 100, both to C (owed 200). Magnitude-only greedy
  // (ties broken by id) would pair A with C first; because B already owes
  // C 100 on the existing debt graph, that pairing is preferred so B->C
  // comes out direct even though A sorts first alphabetically and the two
  // debtors have equal magnitude.
  const positions = new Map([
    ['a', -100],
    ['b', -100],
    ['c', 200],
  ])
  const existingDebt = new Map([['b:c', 100]])
  const plan = minTransfers(positions, existingDebt)
  assert.equal(plan.length, 2)
  const bToC = plan.find((t) => t.fromUserId === 'b' && t.toUserId === 'c')
  const aToC = plan.find((t) => t.fromUserId === 'a' && t.toUserId === 'c')
  assert.ok(bToC, 'expected a b->c transfer')
  assert.ok(aToC, 'expected an a->c transfer')
  assert.equal(bToC?.direct, true)
  assert.equal(aToC?.direct, false)
})

test('n=13 uses the greedy path and stays at or below n-1 = 12 transfers', () => {
  const positions = new Map<string, number>()
  let total = 0
  for (let i = 1; i <= 12; i++) {
    const id = `p${String(i).padStart(2, '0')}`
    positions.set(id, i * 100)
    total += i * 100
  }
  positions.set('p13', -total)
  const plan = minTransfers(positions)
  assert.ok(plan.length <= 12, `expected <= 12 transfers, got ${plan.length}`)
  const final = sumTransfersByPerson(positions, plan)
  for (const [, cents] of final) assert.equal(cents, 0)
})

test('netPositions turns debtor:creditor edges into net positions', () => {
  const edges = new Map([
    ['a:b', 10000],
    ['b:c', 4000],
  ])
  const positions = netPositions(edges)
  assert.equal(positions.get('a'), -10000)
  assert.equal(positions.get('b'), 6000) // +10000 (from a) - 4000 (to c)
  assert.equal(positions.get('c'), 4000)
})

test('netPositions round-trips a simple single-edge case back to the same positions', () => {
  const original = new Map([
    ['a', -10000],
    ['b', 10000],
  ])
  const edges = new Map([['a:b', 10000]])
  assert.deepEqual(netPositions(edges), original)
})

test('netPositions throws on a malformed key', () => {
  assert.throws(() => netPositions(new Map([['no-colon-here', 100]])), /malformed edge key/)
})

// --- Property test -----------------------------------------------------
//
// Tiny deterministic PRNG (LCG) — no Math.random, so a failure is always
// reproducible from the printed seed.
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state / 0x100000000
  }
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

// Independent, deliberately simpler greedy baseline (no on-graph tie-break,
// no bitmask DP) used only to bound the exact path's output size in the
// property test below.
function pureGreedyCount(positionsCents: ReadonlyMap<string, number>): number {
  const working = [...positionsCents.entries()].filter(([, c]) => c !== 0).map(([id, cents]) => ({ id, cents }))
  let count = 0
  for (let iter = 0; iter < working.length; iter++) {
    const debtor = working.find((p) => p.cents < 0)
    const creditor = working.find((p) => p.cents > 0)
    if (!debtor || !creditor) break
    const amount = Math.min(-debtor.cents, creditor.cents)
    if (amount <= 0) break
    debtor.cents += amount
    creditor.cents -= amount
    count++
  }
  return count
}

function randomZeroSumPositions(rng: () => number, n: number): Map<string, number> {
  const ids = Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, '0')}`)
  const positions = new Map<string, number>()
  let sum = 0
  for (let i = 0; i < n - 1; i++) {
    const cents = randomInt(rng, -5000, 5000)
    positions.set(ids[i], cents)
    sum += cents
  }
  positions.set(ids[n - 1], -sum)
  return positions
}

test('property: random zero-sum position sets always zero out, with positive amounts, <= n-1 transfers, and no worse than pure greedy', () => {
  const seed = 42
  const rng = makeRng(seed)
  const trials = 200

  for (let t = 0; t < trials; t++) {
    const n = randomInt(rng, 2, 10)
    const positions = randomZeroSumPositions(rng, n)
    const nonZeroCount = [...positions.values()].filter((c) => c !== 0).length
    if (nonZeroCount === 0) continue // all zero this trial; nothing to assert beyond the dedicated test above

    const plan = minTransfers(positions)

    for (const transfer of plan) {
      assert.ok(transfer.amountCents > 0, `trial ${t} seed ${seed}: non-positive transfer amount`)
    }
    assert.ok(
      plan.length <= nonZeroCount - 1,
      `trial ${t} seed ${seed}: ${plan.length} transfers exceeds n-1=${nonZeroCount - 1}`,
    )

    const final = sumTransfersByPerson(positions, plan)
    for (const [id, cents] of final) {
      assert.equal(cents, 0, `trial ${t} seed ${seed}: position "${id}" did not zero out (got ${cents})`)
    }

    const greedyCount = pureGreedyCount(positions)
    assert.ok(
      plan.length <= greedyCount,
      `trial ${t} seed ${seed}: exact plan (${plan.length}) worse than pure greedy (${greedyCount})`,
    )
  }
})
