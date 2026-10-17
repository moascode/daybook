import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { normalizeBind, updateRow, userOwns } from '../lib.ts'
import { canWriteAccount, coGroupUserIds } from '../lib/sharing.ts'

// Transaction rules — a caller's own ordered list of auto-categorise/
// auto-tag/auto-split rules (migration 0033_account_last4_rules.sql /
// 0032_ on the server). Evaluation against incoming/review-table rows is
// client-side (src/lib/rules.ts's matchRule) — this module is the CRUD
// surface. Mounted behind requireAuth like every other wallet-adjacent route
// module (worker/index.ts).
export const rules = new Hono<AppEnv>()

interface RuleRow {
  id: string
  user_id: string
  name: string
  position: number
  enabled: number
  match_account_id: string | null
  match_category_id: string | null
  match_merchant: string
  set_category_id: string | null
  add_tags: string
  split_user_id: string | null
  split_percent: number | null
  created_at: string
  updated_at: string
}

const RULE_COLS: Record<string, string> = {
  name: 'name',
  enabled: 'enabled',
  matchAccountId: 'match_account_id',
  matchCategoryId: 'match_category_id',
  matchMerchant: 'match_merchant',
  setCategoryId: 'set_category_id',
  addTags: 'add_tags',
  splitUserId: 'split_user_id',
  splitPercent: 'split_percent',
}

/** Body reader shared by every write route here (mirrors wallet.ts's `body`). */
const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

/** Normalise addTags: 1-10 strings, each 1-40 chars after trim. null = invalid
 *  shape (caller distinguishes "absent" from "invalid" itself via `has`). */
function cleanRuleTags(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length === 0 || values.length > 10) return null
  const out: string[] = []
  for (const v of values) {
    if (typeof v !== 'string') return null
    const t = v.trim()
    if (t.length === 0 || t.length > 40) return null
    out.push(t)
  }
  return out
}

/** Parses the stored `add_tags` JSON column back into a string array. */
function parseRuleTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/**
 * Field-level validation only — shape and type of whatever is PRESENT in `b`.
 * `partial` (PATCH) skips a field entirely when absent; POST (`partial =
 * false`) still only checks fields that are given, since every field is
 * optional at the column level (the condition/action requirement is checked
 * separately, against the merged result — see `conditionsActionsError`).
 */
function ruleFieldsError(b: Record<string, unknown>, partial: boolean): string | null {
  const has = (k: string) => k in b && b[k] !== undefined

  if (!partial || has('name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name || name.length > 80) return 'name must be 1-80 characters'
  }
  if (has('matchMerchant') && b.matchMerchant !== null) {
    if (typeof b.matchMerchant !== 'string' || b.matchMerchant.trim().length > 100) {
      return 'matchMerchant must be at most 100 characters'
    }
  }
  if (has('addTags') && b.addTags !== null) {
    if (cleanRuleTags(b.addTags) === null) {
      return 'addTags must be an array of 1-10 strings, each 1-40 characters'
    }
  }
  if (has('splitPercent') && b.splitPercent !== null) {
    const n = typeof b.splitPercent === 'number' || typeof b.splitPercent === 'string' ? Number(b.splitPercent) : NaN
    if (!Number.isFinite(n) || n <= 0 || n >= 100) {
      return 'splitPercent must be greater than 0 and less than 100'
    }
  }
  return null
}

/** Shape the condition/action/split-pair checks run against — always the
 *  MERGED result (existing row + this write), never just the fields being
 *  changed, so a PATCH that clears a rule's only condition is still caught. */
interface MergedRule {
  matchAccountId: string | null
  matchCategoryId: string | null
  matchMerchant: string
  setCategoryId: string | null
  addTags: string[]
  splitUserId: string | null
  splitPercent: number | null
}

function conditionsActionsError(m: MergedRule): string | null {
  const hasCondition = !!m.matchAccountId || !!m.matchCategoryId || m.matchMerchant.trim().length > 0
  if (!hasCondition) {
    return 'a rule needs at least one condition: account, category, or merchant'
  }
  const hasSplit = m.splitUserId != null && m.splitPercent != null
  const hasAction = !!m.setCategoryId || m.addTags.length > 0 || hasSplit
  if (!hasAction) {
    return 'a rule needs at least one action: set a category, add a tag, or split'
  }
  if ((m.splitUserId != null) !== (m.splitPercent != null)) {
    return 'splitUserId and splitPercent must be set together'
  }
  return null
}

/** Cross-row reference checks: account the caller can write to, categories
 *  the caller can see (categories have no sharing — "visible" = owned), and a
 *  split recipient who is a co-group member other than the caller. Reruns
 *  only for fields actually present in `b` (PATCH leaves an untouched,
 *  already-validated existing value alone). */
async function ruleReferencesError(
  db: D1Database,
  userId: string,
  b: Record<string, unknown>,
): Promise<string | null> {
  const has = (k: string) => k in b && b[k] !== undefined

  if (has('matchAccountId') && b.matchAccountId != null) {
    if (!(await canWriteAccount(db, userId, String(b.matchAccountId)))) {
      return 'matchAccountId must be an account you can write to'
    }
  }
  if (has('matchCategoryId') && b.matchCategoryId != null) {
    if (!(await userOwns(db, 'categories', b.matchCategoryId, userId))) {
      return 'matchCategoryId must be a category you can see'
    }
  }
  if (has('setCategoryId') && b.setCategoryId != null) {
    if (!(await userOwns(db, 'categories', b.setCategoryId, userId))) {
      return 'setCategoryId must be a category you can see'
    }
  }
  if (has('splitUserId') && b.splitUserId != null) {
    const allowed = new Set(await coGroupUserIds(db, userId))
    if (String(b.splitUserId) === userId || !allowed.has(String(b.splitUserId))) {
      return 'splitUserId must be a co-group member other than yourself'
    }
  }
  return null
}

rules.get('/rules', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM transaction_rules WHERE user_id = ? ORDER BY position ASC, created_at ASC',
  )
    .bind(c.get('userId'))
    .all<RuleRow>()
  return c.json(results)
})

rules.post('/rules', async (c) => {
  const userId = c.get('userId')
  const b = await body(c)

  const fieldErr = ruleFieldsError(b, false)
  if (fieldErr) return c.json({ error: fieldErr }, 400)
  const refErr = await ruleReferencesError(c.env.DB, userId, b)
  if (refErr) return c.json({ error: refErr }, 400)

  const addTags = b.addTags != null ? (cleanRuleTags(b.addTags) ?? []) : []
  const merged: MergedRule = {
    matchAccountId: b.matchAccountId != null ? String(b.matchAccountId) : null,
    matchCategoryId: b.matchCategoryId != null ? String(b.matchCategoryId) : null,
    matchMerchant: typeof b.matchMerchant === 'string' ? b.matchMerchant.trim() : '',
    setCategoryId: b.setCategoryId != null ? String(b.setCategoryId) : null,
    addTags,
    splitUserId: b.splitUserId != null ? String(b.splitUserId) : null,
    splitPercent: b.splitPercent != null ? Number(b.splitPercent) : null,
  }
  const mergeErr = conditionsActionsError(merged)
  if (mergeErr) return c.json({ error: mergeErr }, 400)

  const nextPosition = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM transaction_rules WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ next: number }>()

  const row = await c.env.DB.prepare(
    `INSERT INTO transaction_rules
       (id, user_id, name, position, enabled, match_account_id, match_category_id, match_merchant,
        set_category_id, add_tags, split_user_id, split_percent, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     RETURNING *`,
  )
    // userId, name, position, enabled, matchAccountId, matchCategoryId, matchMerchant,
    // setCategoryId, addTags, splitUserId, splitPercent
    .bind(
      userId,
      (b.name as string).trim(),
      nextPosition?.next ?? 0,
      normalizeBind(b.enabled ?? true),
      merged.matchAccountId,
      merged.matchCategoryId,
      merged.matchMerchant,
      merged.setCategoryId,
      JSON.stringify(merged.addTags),
      merged.splitUserId,
      merged.splitPercent,
    )
    .first()

  return c.json(row, 201)
})

rules.patch('/rules/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const b = await body(c)

  const existing = await c.env.DB.prepare('SELECT * FROM transaction_rules WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<RuleRow>()
  if (!existing) return c.json({ error: 'rule not found' }, 404)

  const fieldErr = ruleFieldsError(b, true)
  if (fieldErr) return c.json({ error: fieldErr }, 400)
  const refErr = await ruleReferencesError(c.env.DB, userId, b)
  if (refErr) return c.json({ error: refErr }, 400)

  const has = (k: string) => k in b && b[k] !== undefined
  const merged: MergedRule = {
    matchAccountId: has('matchAccountId')
      ? b.matchAccountId != null ? String(b.matchAccountId) : null
      : existing.match_account_id,
    matchCategoryId: has('matchCategoryId')
      ? b.matchCategoryId != null ? String(b.matchCategoryId) : null
      : existing.match_category_id,
    matchMerchant: has('matchMerchant')
      ? typeof b.matchMerchant === 'string' ? b.matchMerchant.trim() : ''
      : existing.match_merchant,
    setCategoryId: has('setCategoryId')
      ? b.setCategoryId != null ? String(b.setCategoryId) : null
      : existing.set_category_id,
    addTags: has('addTags') ? (b.addTags != null ? cleanRuleTags(b.addTags) ?? [] : []) : parseRuleTags(existing.add_tags),
    splitUserId: has('splitUserId')
      ? b.splitUserId != null ? String(b.splitUserId) : null
      : existing.split_user_id,
    splitPercent: has('splitPercent')
      ? b.splitPercent != null ? Number(b.splitPercent) : null
      : existing.split_percent,
  }
  const mergeErr = conditionsActionsError(merged)
  if (mergeErr) return c.json({ error: mergeErr }, 400)

  // `enabled` has no dedicated shape check above — normalizeBind only coerces
  // an actual boolean to 0/1, so any other truthy value (a string, a number)
  // would otherwise bind as-is into the INTEGER column.
  if (has('enabled') && typeof b.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400)
  }

  // updateRow() binds whatever is in `b` directly, one column per key in
  // RULE_COLS — it never sees `merged`. Without writing the validated/merged
  // values back here, a caller sending `matchMerchant: null` to mean "clear
  // the condition" (rather than '') bound NULL straight into match_merchant's
  // NOT NULL column and 500'd on every such edit. Every field that needed
  // trimming/merging goes back into `b` now, not just addTags.
  if (has('name')) b.name = (b.name as string).trim()
  if (has('matchAccountId')) b.matchAccountId = merged.matchAccountId
  if (has('matchCategoryId')) b.matchCategoryId = merged.matchCategoryId
  if (has('matchMerchant')) b.matchMerchant = merged.matchMerchant
  if (has('setCategoryId')) b.setCategoryId = merged.setCategoryId
  if (has('addTags')) b.addTags = JSON.stringify(merged.addTags)
  if (has('splitUserId')) b.splitUserId = merged.splitUserId
  if (has('splitPercent')) b.splitPercent = merged.splitPercent
  if (has('enabled')) b.enabled = normalizeBind(b.enabled)

  const row = await updateRow<RuleRow>(c.env.DB, 'transaction_rules', id, userId, RULE_COLS, b)
  if (!row) return c.json({ error: 'rule not found' }, 404)
  return c.json(row)
})

rules.delete('/rules/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM transaction_rules WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.body(null, 204)
})
