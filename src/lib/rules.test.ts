// Runner: node:test via tsx, matching the other pure-function tests in this
// repo (CLAUDE.md §2 — no vitest/jest without asking). Run with:
//   npx tsx --test src/lib/rules.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRule, splitShares, mapRule, ruleSplitRequest } from './rules'
import type { TransactionRule } from '../types/wallet.types'

function rule(overrides: Partial<TransactionRule>): TransactionRule {
  return {
    id: 'r1',
    name: 'Rule',
    position: 0,
    enabled: true,
    matchAccountId: null,
    matchCategoryId: null,
    matchMerchant: '',
    matchDescription: '',
    matchTags: [],
    setCategoryId: null,
    addTags: [],
    splitUserId: null,
    splitPercent: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

test('matchRule: no rules matches nothing', () => {
  assert.equal(matchRule([], { accountId: 'a1', categoryId: null, merchant: 'Tesco', description: '', tags: [] }), null)
})

test('matchRule: a disabled rule is skipped', () => {
  const r = rule({ matchMerchant: 'tesco', enabled: false })
  assert.equal(matchRule([r], { accountId: null, categoryId: null, merchant: 'Tesco Extra', description: '', tags: [] }), null)
})

test('matchRule: merchant match is case-insensitive substring', () => {
  const r = rule({ matchMerchant: 'tesco' })
  const hit = matchRule([r], { accountId: null, categoryId: null, merchant: 'TESCO EXTRA KL', description: '', tags: [] })
  assert.equal(hit?.id, 'r1')
})

test('matchRule: account condition must match exactly', () => {
  const r = rule({ matchAccountId: 'acc-1' })
  assert.equal(matchRule([r], { accountId: 'acc-2', categoryId: null, merchant: '', description: '', tags: [] }), null)
  assert.equal(matchRule([r], { accountId: 'acc-1', categoryId: null, merchant: '', description: '', tags: [] })?.id, 'r1')
})

test('matchRule: category condition checks the row\'s CURRENT category', () => {
  const r = rule({ matchCategoryId: 'cat-1' })
  assert.equal(matchRule([r], { accountId: null, categoryId: 'cat-2', merchant: '', description: '', tags: [] }), null)
  assert.equal(matchRule([r], { accountId: null, categoryId: 'cat-1', merchant: '', description: '', tags: [] })?.id, 'r1')
})

test('matchRule: every set condition on a rule must match (AND, not OR)', () => {
  const r = rule({ matchAccountId: 'acc-1', matchMerchant: 'tesco' })
  assert.equal(matchRule([r], { accountId: 'acc-1', categoryId: null, merchant: 'Starbucks', description: '', tags: [] }), null)
  assert.equal(matchRule([r], { accountId: 'acc-1', categoryId: null, merchant: 'Tesco', description: '', tags: [] })?.id, 'r1')
})

test('matchRule: first enabled match wins, by position', () => {
  const r1 = rule({ id: 'first', position: 0, matchMerchant: 'tesco' })
  const r2 = rule({ id: 'second', position: 1, matchMerchant: 'tesco' })
  assert.equal(matchRule([r2, r1], { accountId: null, categoryId: null, merchant: 'Tesco', description: '', tags: [] })?.id, 'first')
})

const ctx = (over: Partial<Parameters<typeof matchRule>[1]>) =>
  ({ accountId: null, categoryId: null, merchant: '', description: '', tags: [], ...over })

test('matchRule: description match is case-insensitive substring', () => {
  const r = rule({ matchDescription: '3523' })
  assert.equal(matchRule([r], ctx({ description: 'CARD •••• •••• •••• 3523 KL' }))?.id, 'r1')
  assert.equal(matchRule([r], ctx({ description: 'CARD •••• 9999' })), null)
})

test('matchRule: tags match if ANY rule tag is present, case-insensitively', () => {
  const r = rule({ matchTags: ['freya', 'baby'] })
  assert.equal(matchRule([r], ctx({ tags: ['Baby'] }))?.id, 'r1')
  assert.equal(matchRule([r], ctx({ tags: ['groceries'] })), null)
  assert.equal(matchRule([r], ctx({ tags: [] })), null)
})

test('matchRule: category AND tag must both match', () => {
  const r = rule({ matchCategoryId: 'health', matchTags: ['tumpa'] })
  assert.equal(matchRule([r], ctx({ categoryId: 'health', tags: ['tumpa'] }))?.id, 'r1')
  assert.equal(matchRule([r], ctx({ categoryId: 'health', tags: [] })), null)
  assert.equal(matchRule([r], ctx({ categoryId: 'food', tags: ['tumpa'] })), null)
})

test('ruleSplitRequest: 100% is split mode none, otherwise custom shares', () => {
  assert.deepEqual(ruleSplitRequest(50, 'u2', 100, 'n'), { recipientId: 'u2', splitMode: 'none', note: 'n' })
  assert.deepEqual(ruleSplitRequest(100, 'u2', 40, 'n'), { recipientId: 'u2', splitMode: 'custom', shareAmounts: [60, 40], note: 'n' })
})

test('splitShares: sums to the exact amount, remainder to the payer', () => {
  const [payer, partner] = splitShares(100, 33.33)
  assert.equal(Math.round((payer + partner) * 100) / 100, 100)
  assert.equal(partner, 33.33)
  assert.equal(payer, 66.67)
})

test('splitShares: handles a rounding-heavy percent without drifting off-cent', () => {
  const [payer, partner] = splitShares(10.1, 30)
  assert.equal(Math.round((payer + partner) * 1000) / 1000, 10.1)
})

test('mapRule: parses a raw snake_case row', () => {
  const r = mapRule({
    id: 'id1',
    name: 'Groceries',
    position: 2,
    enabled: 1,
    match_account_id: 'acc-1',
    match_category_id: null,
    match_merchant: 'tesco',
    match_description: '3523',
    match_tags: '["freya"]',
    set_category_id: 'cat-1',
    add_tags: '["household","groceries"]',
    split_user_id: 'u2',
    split_percent: 30,
    created_at: 'now',
    updated_at: 'now',
  })
  assert.equal(r.enabled, true)
  assert.deepEqual(r.addTags, ['household', 'groceries'])
  assert.equal(r.splitPercent, 30)
  assert.equal(r.matchDescription, '3523')
  assert.deepEqual(r.matchTags, ['freya'])
})
