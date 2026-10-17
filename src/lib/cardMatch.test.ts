// Runner: node:test via tsx (see rules.test.ts for why). Run with:
//   npx tsx --test src/lib/cardMatch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractLast4 } from './cardMatch'

test('a simple trailing 4-digit token resolves', () => {
  assert.equal(extractLast4('Visa 9876'), '9876')
})

test('a 5-digit trailing run is NOT a standalone 4-digit token', () => {
  assert.equal(extractLast4('Card 12345'), null)
})

test('no digits at all', () => {
  assert.equal(extractLast4('Visa Classic'), null)
})

test('a trailing token elsewhere in the middle, not at the end, does not count', () => {
  assert.equal(extractLast4('4321 Exp 03/25'), null)
})

test('a year-shaped trailing token is accepted when nothing earlier exists', () => {
  assert.equal(extractLast4('Mastercard 1964'), '1964')
  assert.equal(extractLast4('Card 2027'), '2027')
})

test('a year-shaped trailing token defers to an earlier standalone 4-digit token', () => {
  assert.equal(extractLast4('Visa 4321 exp 2027'), '4321')
})

test('the nearest earlier standalone token is used when several exist', () => {
  assert.equal(extractLast4('Visa 1111 2222 exp 2027'), '2222')
})

test('leading/trailing whitespace around the trailing token is fine', () => {
  assert.equal(extractLast4('Visa 9876  '), '9876')
})

test('a non-year 4-digit trailing token wins even with an earlier one present', () => {
  assert.equal(extractLast4('Visa 1111 9876'), '9876')
})
