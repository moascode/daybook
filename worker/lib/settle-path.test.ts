// Unit tests for the pure routeTransfer function (worker/lib/settle-path.ts).
// Runner: node:test via tsx, same as min-transfers.test.ts and
// parseTaskComposerInput.test.ts — see those files for why (CLAUDE.md §2, no
// unlisted test runner).
//
//   npx tsx --test worker/lib/settle-path.test.ts
//
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeTransfer } from './settle-path'

test('A->B->C single path carries the full amount', () => {
  const edges = new Map([
    ['a:b', 4000],
    ['b:c', 4000],
  ])
  const routed = routeTransfer(edges, 'a', 'c', 4000)
  assert.deepEqual(routed, [{ path: ['a', 'b', 'c'], amountCents: 4000 }])
})

test('two parallel paths are needed to carry the full amount', () => {
  // a->c directly has no capacity (would be a direct 1-hop transfer and is
  // excluded here); a can reach c via b1 (cap 3000) and via b2 (cap 2000).
  const edges = new Map([
    ['a:b1', 3000],
    ['b1:c', 3000],
    ['a:b2', 2000],
    ['b2:c', 2000],
  ])
  const routed = routeTransfer(edges, 'a', 'c', 5000)
  assert.equal(routed.length, 2)
  const total = routed.reduce((sum, r) => sum + r.amountCents, 0)
  assert.equal(total, 5000)
  // Deterministic: b1 sorts before b2, and BFS visits in sorted order, so the
  // larger-capacity path through b1 is found first.
  assert.deepEqual(routed[0], { path: ['a', 'b1', 'c'], amountCents: 3000 })
  assert.deepEqual(routed[1], { path: ['a', 'b2', 'c'], amountCents: 2000 })
})

test('insufficient capacity throws', () => {
  const edges = new Map([
    ['a:b', 1000],
    ['b:c', 1000],
  ])
  assert.throws(
    () => routeTransfer(edges, 'a', 'c', 2000),
    /cannot be routed/,
  )
})

test('direct 1-hop transfer throws, regardless of remaining capacity', () => {
  const edges = new Map([['a:c', 5000]])
  assert.throws(
    () => routeTransfer(edges, 'a', 'c', 5000),
    /direct, one-hop debt/,
  )
})

test('longer chain A->B->C->D routes end to end', () => {
  const edges = new Map([
    ['a:b', 1000],
    ['b:c', 1000],
    ['c:d', 1000],
  ])
  const routed = routeTransfer(edges, 'a', 'd', 1000)
  assert.deepEqual(routed, [{ path: ['a', 'b', 'c', 'd'], amountCents: 1000 }])
})

test('deterministic: equal inputs produce an equal route', () => {
  const edges = new Map([
    ['a:z', 0], // zero-capacity edge present in the map must be ignored
    ['a:b', 1500],
    ['b:c', 1500],
    ['a:m', 1500],
    ['m:c', 1500],
  ])
  const r1 = routeTransfer(edges, 'a', 'c', 1500)
  const r2 = routeTransfer(new Map(edges), 'a', 'c', 1500)
  assert.deepEqual(r1, r2)
  // 'b' sorts before 'm', so the b-path is preferred.
  assert.deepEqual(r1, [{ path: ['a', 'b', 'c'], amountCents: 1500 }])
})

test('rejects a non-positive or non-integer amount', () => {
  const edges = new Map([
    ['a:b', 100],
    ['b:c', 100],
  ])
  assert.throws(() => routeTransfer(edges, 'a', 'c', 0))
  assert.throws(() => routeTransfer(edges, 'a', 'c', -10))
  assert.throws(() => routeTransfer(edges, 'a', 'c', 1.5))
})
