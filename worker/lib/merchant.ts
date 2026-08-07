// docs/auto-categorisation-plan.md §3.2. Collapses a bank-written merchant
// string to a stable matching key, so "MCDONALDS-MY TOWN00368 KUALA LUMPUR"
// and "MCDONALDS-PAVILION KL" fold to the same bucket. Pure, no I/O — used by
// the suggestion route (grouping both the request and the user's own history)
// and by scripts/merchant-map-gaps.mjs.
//
// Order matters: step 7 (split on separator) must run after 2-6 (mask/date/
// country/rail/domain stripping), or the split keeps a head that still carries
// a date or domain suffix.

const CARD_MASK = /[•*·]{3,}.*$|\bx{4,}\b.*$/i
const DATE_TAIL = /\s\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/
const COUNTRY = /\s+(?:MY|SG|US|CA|GB|AU|TH|ID|JP|HK|CN|IN|NL|DE|IE)\s*$/
const RAIL_PREFIX =
  /^(?:DUITNOW\s+QR|DUITNOW|TRANSFER\s+(?:DEBIT|CREDIT)|MEPS\s+PAYMENT\s+FROM|MEPS|IBG|FPX|POS\s+DEBIT)\s+/
const DOMAIN_TAIL = /\.(?:COM\.MY|COM|NET|CO|MY)\b.*$/
const SEPARATOR = /\s{2,}|[-*/|]/
const ENTITY_TAIL = /\s+(?:SDN\s+BHD|SDN|BHD|PLT|ENTERPRISE|TRADING|HOLDINGS|GROUP)\s*$/
const DIGIT_TAIL = /\s*\d{3,}\s*$/

/**
 * Collapse a bank-written merchant string to a stable matching key.
 *
 * `null` means "no usable name" — the caller offers no suggestion rather than
 * guessing on garbage input (empty string, all-digits reference number, …).
 */
export function canonicalMerchant(raw: string): string | null {
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  if (!s) return null
  s = s.replace(CARD_MASK, '').replace(DATE_TAIL, '').replace(COUNTRY, '')
  s = s.replace(RAIL_PREFIX, '')
  s = s.replace(DOMAIN_TAIL, '').replace(/[.']/g, '')
  s = s.split(SEPARATOR)[0]
  s = s.replace(ENTITY_TAIL, '').replace(DIGIT_TAIL, '')
  s = s.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').trim()
  if (s.length < 3 || /^\d+$/.test(s)) return null
  return s
}
