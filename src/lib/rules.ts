import type { Category, Transaction, TransactionRule, TransactionType } from '../types/wallet.types'

type RuleRow = Record<string, unknown>

/** Parses the stored `add_tags` JSON column back into a string array. */
function parseRuleTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Maps a raw snake_case row from GET/POST/PATCH /rules onto the camelCase shape used client-side. */
export function mapRule(r: RuleRow): TransactionRule {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    position: Number(r.position ?? 0),
    enabled: Number(r.enabled ?? 0) === 1,
    matchAccountId: r.match_account_id ? String(r.match_account_id) : null,
    matchCategoryId: r.match_category_id ? String(r.match_category_id) : null,
    matchMerchant: String(r.match_merchant ?? ''),
    matchDescription: String(r.match_description ?? ''),
    matchTags: parseRuleTags(r.match_tags),
    setCategoryId: r.set_category_id ? String(r.set_category_id) : null,
    addTags: parseRuleTags(r.add_tags),
    splitUserId: r.split_user_id ? String(r.split_user_id) : null,
    splitPercent: r.split_percent != null ? Number(r.split_percent) : null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  }
}

export interface MatchContext {
  accountId: string | null
  /** The row's CURRENT category — not what the rule might set. */
  categoryId: string | null
  merchant: string
  description: string
  tags: string[]
}

const contains = (haystack: string, needle: string) =>
  !needle.trim() || haystack.toLowerCase().includes(needle.trim().toLowerCase())

/** True when every *set* condition on `rule` matches `ctx` (AND across conditions; tags match ANY). */
function ruleMatches(rule: TransactionRule, ctx: MatchContext): boolean {
  if (rule.matchAccountId && rule.matchAccountId !== ctx.accountId) return false
  if (rule.matchCategoryId && rule.matchCategoryId !== ctx.categoryId) return false
  if (!contains(ctx.merchant, rule.matchMerchant)) return false
  if (!contains(ctx.description, rule.matchDescription)) return false
  if (rule.matchTags.length > 0) {
    const have = new Set(ctx.tags.map((t) => t.toLowerCase()))
    if (!rule.matchTags.some((t) => have.has(t.toLowerCase()))) return false
  }
  return true
}

/**
 * The first enabled rule (by `position`) whose every *set* condition matches
 * `ctx`. A rule with no conditions at all cannot exist (server-validated), so
 * every rule here has at least one check in `ruleMatches` actually run.
 */
export function matchRule(rules: TransactionRule[], ctx: MatchContext): TransactionRule | null {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position)
  return enabled.find((rule) => ruleMatches(rule, ctx)) ?? null
}

/**
 * Splits `amount` into [payer, partner] by `partnerPercent`, rounded to
 * cents with the rounding remainder folded into the payer's share so the two
 * always sum to exactly `amount` (never off by a cent either direction).
 */
export function splitShares(amount: number, partnerPercent: number): [number, number] {
  const partnerRaw = (amount * partnerPercent) / 100
  const partner = Math.round(partnerRaw * 100) / 100
  const payer = Math.round((amount - partner) * 100) / 100
  return [payer, partner]
}

/**
 * Body for `POST /transactions/:id/split` from a rule's split action. 100%
 * is split mode 'none' (the partner owes it all, no payer row) — 'custom'
 * rejects a zero share for the payer.
 */
export function ruleSplitRequest(amount: number, partnerId: string, partnerPercent: number, note: string) {
  if (partnerPercent >= 100) return { recipientId: partnerId, splitMode: 'none', note }
  return { recipientId: partnerId, splitMode: 'custom', shareAmounts: splitShares(amount, partnerPercent), note }
}

export interface RuleChanges {
  categoryId?: string
  /** The full new tag list (existing + the rule's missing ones). */
  tags?: string[]
  split?: { userId: string; percent: number }
}

/**
 * Only what `rule`'s actions would actually change on a transaction — `{}`
 * means nothing to do. Mirrors the import chip: a category is set only when
 * it fits the direction, a split only on an expense, and never on one that is
 * already split (re-splitting replaces its shares).
 */
export function ruleChanges(
  rule: TransactionRule,
  t: { type: TransactionType; categoryId: string | null; tags: string[]; alreadySplit: boolean },
  categories: Category[],
): RuleChanges {
  const out: RuleChanges = {}
  const cat = categories.find((c) => c.id === rule.setCategoryId)
  if (cat && cat.id !== t.categoryId && (cat.type === 'both' || cat.type === t.type)) out.categoryId = cat.id
  const newTags = rule.addTags.filter((tag) => !t.tags.includes(tag))
  if (newTags.length > 0 && t.type !== 'transfer') out.tags = [...t.tags, ...newTags]
  if (!t.alreadySplit && t.type === 'expense' && rule.splitUserId && rule.splitPercent != null) {
    out.split = { userId: rule.splitUserId, percent: rule.splitPercent }
  }
  return out
}

/** Past transactions `rule` matches (ignoring enabled/position) that it would change. */
export function planRuleBackfill(rule: TransactionRule, transactions: Transaction[], categories: Category[]) {
  return transactions
    .filter((t) => t.type !== 'transfer' && matchRule([{ ...rule, enabled: true }], t))
    .map((t) => ({ transaction: t, changes: ruleChanges(rule, { ...t, alreadySplit: !!t.hasSplits }, categories) }))
    .filter((p) => Object.keys(p.changes).length > 0)
}
