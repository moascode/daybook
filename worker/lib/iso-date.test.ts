// Unit tests for the pure isValidIsoDate round-trip guard (BUG-002).
//
// NOTE ON RUNNER: this repo has no unit-test runner configured (only
// Playwright e2e — see docs/reference/testing.md). Per CLAUDE.md §2, an
// unlisted package (vitest/jest) is never installed without asking, so this
// file uses Node's built-in `node:test` + `node:assert/strict`, exercised
// through the already-present `tsx` devDependency:
//
//   npx tsx --test worker/lib/iso-date.test.ts
//
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidIsoDate } from './iso-date'

test('accepts well-formed, real calendar dates', () => {
  assert.equal(isValidIsoDate('2026-01-15'), true)
  assert.equal(isValidIsoDate('2026-12-31'), true)
  assert.equal(isValidIsoDate('2024-02-29'), true) // leap year
  assert.equal(isValidIsoDate('2000-02-29'), true) // leap year (div by 400)
})

test('rejects impossible calendar dates that Date.parse rolls over', () => {
  assert.equal(isValidIsoDate('2026-02-30'), false) // rolls to 2 Mar
  assert.equal(isValidIsoDate('2026-04-31'), false) // rolls to 1 May
  assert.equal(isValidIsoDate('2025-02-29'), false) // not a leap year
  assert.equal(isValidIsoDate('1900-02-29'), false) // not a leap year (div by 100, not 400)
})

test('rejects out-of-range month/day components', () => {
  assert.equal(isValidIsoDate('2026-13-01'), false)
  assert.equal(isValidIsoDate('2026-00-10'), false)
  assert.equal(isValidIsoDate('2026-01-00'), false)
})

test('rejects malformed shapes and non-strings', () => {
  assert.equal(isValidIsoDate('2026-1-5'), false)
  assert.equal(isValidIsoDate(''), false)
  assert.equal(isValidIsoDate(null), false)
  assert.equal(isValidIsoDate(20260115), false)
  assert.equal(isValidIsoDate('2026-02-30T00:00:00Z'), false)
})
