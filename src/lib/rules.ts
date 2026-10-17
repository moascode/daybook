import type { TransactionRule } from '../types/wallet.types'

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
}

/**
 * The first enabled rule (by `position`) whose every *set* condition matches
 * `ctx`. A rule with no conditions at all cannot exist (server-validated), so
 * every rule here has at least one of the three checks below actually run.
 */
export function matchRule(rules: TransactionRule[], ctx: MatchContext): TransactionRule | null {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position)
  const merchant = ctx.merchant.trim().toLowerCase()

  for (const rule of enabled) {
    if (rule.matchAccountId && rule.matchAccountId !== ctx.accountId) continue
    if (rule.matchCategoryId && rule.matchCategoryId !== ctx.categoryId) continue
    if (rule.matchMerchant.trim()) {
      const needle = rule.matchMerchant.trim().toLowerCase()
      if (!merchant.includes(needle)) continue
    }
    return rule
  }
  return null
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
