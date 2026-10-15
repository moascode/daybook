import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMonthLabel, gridDates, parseRange, statDates, stepAnchor } from './rangeMath'

test('parseRange defaults to week', () => {
  assert.equal(parseRange(null), 'week')
  assert.equal(parseRange('bogus'), 'week')
  assert.equal(parseRange('month'), 'month')
})

test('fortnight is 14 days from Monday; steps by 14', () => {
  const days = gridDates('2026-10-15', 'fortnight')
  assert.equal(days.length, 14)
  assert.equal(days[0], '2026-10-12')
  assert.equal(days[13], '2026-10-25')
  assert.equal(stepAnchor('2026-10-15', 'fortnight', 1), '2026-10-29')
})

test('month grid is Monday-start whole weeks; stats exclude neighbour days', () => {
  const grid = gridDates('2026-10-15', 'month')
  assert.equal(grid.length % 7, 0)
  assert.equal(grid[0], '2026-09-28')
  assert.equal(grid[grid.length - 1], '2026-11-01')
  const stats = statDates('2026-10-15', 'month')
  assert.equal(stats.length, 31)
  assert.equal(stats[0], '2026-10-01')
})

test('month step clamps to month start, label formats', () => {
  assert.equal(stepAnchor('2026-10-31', 'month', 1), '2026-11-01')
  assert.equal(stepAnchor('2026-01-31', 'month', -1), '2025-12-01')
  assert.equal(formatMonthLabel('2026-10-15'), 'October 2026')
})
