// docs/archive/auto-categorisation-plan.md §3.2. Collapses a bank-written merchant
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
const SEPARATOR_ALL = /\s{2,}|[-*/|]/g
const ENTITY_TAIL = /\s+(?:SDN\s+BHD|SDN|BHD|PLT|ENTERPRISE|TRADING|HOLDINGS|GROUP)\s*$/
const DIGIT_TAIL = /\s*\d{3,}\s*$/
const REF_TAIL = /\s+(?:REF|TRANSACTION\s+REF|MY\s+REF)\s*$/
const LOCATION_TAIL = /\s+(?:STATION|PLAZA|MALL|PAVILION)(?:\s+[A-Z]{2,})?\s*$/i

/** Trailing noise off, then the usability test. `null` = not a usable name. */
function trimTails(s: string): string | null {
  const out = s
    .replace(REF_TAIL, '')
    .replace(LOCATION_TAIL, '')
    .replace(ENTITY_TAIL, '')
    .replace(DIGIT_TAIL, '')
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .trim()
  if (out.length < 3 || /^\d+$/.test(out)) return null
  return out
}

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

  // Split on the first separator: the head is the merchant, the tail is the
  // outlet/location the bank appended.
  const head = trimTails(s.split(SEPARATOR)[0])
  if (head) return head

  // A head that is not usable on its own means the separator was INTERNAL to
  // the name, not an outlet suffix — "7-ELEVEN" splits to "7", which used to
  // canonicalise to null, so no history and no map entry could ever match one
  // of the most common merchants in the country. Fall back to the whole
  // string with separators normalised to spaces.
  return trimTails(s.replace(SEPARATOR_ALL, ' ').replace(/\s+/g, ' ').trim())
}

// ── Canonicalize merchant name for display ───────────
// ONE implementation, shared by CSV import (src/lib/csv.ts) and the bulk
// cleanup route.
// Strips bank-appended noise (card masks, dates, country codes, payment-rail
// prefixes, domains, entity types, trailing digits, outlet suffixes) to extract
// a clean merchant name. Used during CSV import when a single narrative column is
// split into merchant (canonical) + description (raw). Returns title-case for display.
// Pure string manipulation.

export function canonicalizeMerchantForDisplay(raw: string): string | null {
  // Person-to-person transfers share one prefix, so without a payee-specific
  // name they all collapsed into the same guess ("Transfer Fr A") and one
  // answer was memoised for every counterparty. Keep the counterparty only:
  // the direction is the row's own type, and the bank words it from its side.
  const TRANSFER_PREFIX = /^(?:TRANSFER\s+(?:FR|FROM|TO)\s+A\/C|MBB\s+CT-?|DUITNOW\s+QR)\s+/i
  const transferMatch = TRANSFER_PREFIX.exec(raw.trim())
  if (transferMatch) {
    return canonicalizeMerchantForDisplay(raw.trim().slice(transferMatch[0].length))
  }

  // Masked card/account tokens: digits mixed with a run of 4+ X's (e.g.
  // "4123XXXXXXXX8891"). Bounded by whitespace/string edges (lookaround, not
  // \b) because a digit run butts directly against the X run with no word
  // boundary between them — \b alone would never fire there.
  const MASKED_TOKEN = /(?<=^|\s)[\dXx]*[Xx]{4,}[\dXx]*(?=\s|$)/g
  const BULLET_MASK = /(?<=^|\s)[\d•*·]*[•*·]{3,}[\d•*·]*(?=\s|$)/g
  // Unmasked reference/card/account numbers — most Malaysian bank narratives
  // print the PAN or txn ref in full rather than masking it. A standalone
  // 6+ digit token is never part of a real merchant name.
  const DIGIT_TOKEN = /\b\d{6,}\b/g
  const DATE_TAIL = /\s\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/
  const COUNTRY = /\s+(?:MY|SG|US|CA|GB|AU|TH|ID|JP|HK|CN|IN|NL|DE|IE)\s*$/
  // Payment rail prefixes that appear at the start of bank narratives
  const RAIL_PREFIX = /^(?:POS\s+DEBIT|POS\s+PURCHASE|PURCHASE|DUITNOW|TRANSFER\s+(?:DEBIT|CREDIT)|MEPS|IBG|FPX)\s+/i
  const DOMAIN_TAIL = /\.(?:COM\.MY|COM|NET|CO|MY)\b.*$/i
  // Use multiple spaces or explicit separators, not single spaces (which appear
  // inside merchant names like "FAMILY MART" or "GIANT SUPERMARKET").
  const SEPARATOR = /\s{2,}|[-*/|]/
  const SEPARATOR_ALL = /\s{2,}|[-*/|]/g
  const ENTITY_TAIL = /\s+(?:SDN\s+BHD|SDN|BHD|PLT|ENTERPRISE|TRADING|HOLDINGS|GROUP)\s*$/i
  const DIGIT_TAIL = /\s*\d{3,}\s*$/
  // Reference/transaction indicators appended by the bank (stripped after
  // digit tokens are removed, so "REF 029385" becomes "REF  " → "REF")
  const REF_TAIL = /\s+(?:REF|TRANSACTION\s+REF|MY\s+REF)\s*$/i
  // Location/outlet indicators appended by the bank (descriptor + optional city code)
  // Matches "STATION KL", "PLAZA", "MALL PJ", etc.; stops at a common outlet descriptor
  const LOCATION_TAIL = /\s+(?:STATION|PLAZA|MALL|PAVILION)(?:\s+[A-Z]{2,})?\s*$/i

  function trimTails(s: string): string | null {
    const out = s
      .replace(REF_TAIL, '')
      .replace(LOCATION_TAIL, '')
      .replace(ENTITY_TAIL, '')
      .replace(DIGIT_TAIL, '')
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      .trim()
    if (out.length < 2) return null
    return out
  }

  function titleCase(s: string): string {
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return null
  s = s.replace(RAIL_PREFIX, '')
  s = s.replace(DATE_TAIL, '').replace(COUNTRY, '')
  // Strip masked and unmasked card/reference number tokens before splitting,
  // so a middle-of-string PAN never survives into the merchant head.
  s = s.replace(MASKED_TOKEN, ' ').replace(BULLET_MASK, ' ').replace(DIGIT_TOKEN, ' ')
  s = s.replace(DOMAIN_TAIL, '').replace(/[.']/g, '')
  s = s.replace(/\s+/g, ' ').trim()

  // Split on separators: the head is the merchant, the tail is the outlet/location.
  const head = trimTails(s.split(SEPARATOR)[0])
  if (head) return titleCase(head)

  // If the head is unusable, the separator was internal (e.g. "7-ELEVEN" splits to "7").
  // Fall back to the whole string with separators normalised to spaces.
  const fallback = trimTails(s.replace(SEPARATOR_ALL, ' ').replace(/\s+/g, ' ').trim())
  return fallback ? titleCase(fallback) : null
}

/**
 * Normalize a regex-derived merchant guess into a stable lookup key for the
 * `merchant_corrections` table and for case-insensitive history comparison.
 * Both the corrections lookup and the history-match step must use this same
 * normalization, or a trivial case/whitespace difference would cause a cache
 * miss that re-spends an AI call for something already resolved.
 */
export function correctionKey(guess: string): string {
  return guess.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Cross-source duplicate identity key: the same real transaction should
 * collapse to the same key whether its merchant text arrived as a raw bank
 * narrative (CSV import) or an AI-clean name (photo import) — canonicalMerchant()
 * already folds both shapes to the same bucket in the common case ("GRABFOOD MY
 * SDN BHD 041225" and "Grab Food" both reduce to "GRABFOOD"). Falls back to the
 * normalized raw merchant text when canonicalMerchant can't extract a usable
 * name (empty/all-digit merchant), rather than dropping merchant identity from
 * the key. Amount is compared in integer cents to avoid float-precision drift.
 */
export function buildDuplicateKey(date: string, amount: number, type: string, merchant: string): string {
  const cents = Math.round(amount * 100)
  const key = correctionKey(canonicalMerchant(merchant) ?? merchant)
  return `${date}|${cents}|${type}|${key}`
}
