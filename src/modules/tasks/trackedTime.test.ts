import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTrackedMinutes, formatElapsed, parseServerUtc } from './trackedTime'

test('formatTrackedMinutes', () => {
  assert.equal(formatTrackedMinutes(0), '0m')
  assert.equal(formatTrackedMinutes(45), '45m')
  assert.equal(formatTrackedMinutes(60), '1h')
  assert.equal(formatTrackedMinutes(72), '1h 12m')
  assert.equal(formatTrackedMinutes(120), '2h')
})

test('formatElapsed', () => {
  assert.equal(formatElapsed(0), '0:00')
  assert.equal(formatElapsed(65_000), '1:05')
  assert.equal(formatElapsed(3_725_000), '1:02:05')
  assert.equal(formatElapsed(-5), '0:00')
})

test('parseServerUtc treats the SQLite form as UTC', () => {
  assert.equal(parseServerUtc('2026-01-02 03:04:05'), Date.UTC(2026, 0, 2, 3, 4, 5))
  assert.ok(Number.isNaN(parseServerUtc('nope')))
})
