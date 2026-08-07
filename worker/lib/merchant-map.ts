// docs/auto-categorisation-plan.md §3.4. Cold-start fallback consulted only
// when Stage 2 (the user's own history) has no suggestion for a canonical
// name — covers the first two visits to a merchant, before history exists.
//
// Keys are already-canonical (uppercase, no punctuation, no entity suffix —
// see worker/lib/merchant.ts). Values are seed expense category *names*,
// resolved against the caller's own categories by name in the route handler
// (categories are per-user rows referenced by id, not by this map). Scoped to
// the ten seed expense categories — nothing else is guaranteed to exist for a
// given user (docs/auto-categorisation-plan.md G5).
//
// Growing the map: npm run merchant-map:gaps -- export.csv (§3.4). It runs via
// tsx, not plain node — it imports this module directly.

export type SeedCategoryName =
  | 'Food & Drink'
  | 'Transport'
  | 'Shopping'
  | 'Bills & Utilities'
  | 'Personal Care'
  | 'Health'
  | 'Entertainment'
  | 'Travel'

export const MERCHANT_MAP: Record<string, SeedCategoryName> = {
  // ── Food & Drink ─────────────────────────────────────
  MCDONALDS: 'Food & Drink',
  KFC: 'Food & Drink',
  'PIZZA HUT': 'Food & Drink',
  DOMINOS: 'Food & Drink',
  'BURGER KING': 'Food & Drink',
  SUBWAY: 'Food & Drink',
  'TEXAS CHICKEN': 'Food & Drink',
  MARRYBROWN: 'Food & Drink',
  NANDOS: 'Food & Drink',
  'KENNY ROGERS': 'Food & Drink',
  'SUSHI KING': 'Food & Drink',
  SUKISHI: 'Food & Drink',
  'SECRET RECIPE': 'Food & Drink',
  PAPPARICH: 'Food & Drink',
  OLDTOWN: 'Food & Drink',
  STARBUCKS: 'Food & Drink',
  CBTL: 'Food & Drink',
  'COFFEE BEAN': 'Food & Drink',
  'ZUS COFFEE': 'Food & Drink',
  'GIGI COFFEE': 'Food & Drink',
  TEALIVE: 'Food & Drink',
  CHATIME: 'Food & Drink',
  DUNKIN: 'Food & Drink',
  'KRISPY KREME': 'Food & Drink',
  'BASKIN ROBBINS': 'Food & Drink',
  LLAOLLAO: 'Food & Drink',
  GRABFOOD: 'Food & Drink',
  FOODPANDA: 'Food & Drink',

  // ── Transport ────────────────────────────────────────
  PETRONAS: 'Transport',
  SHELL: 'Transport',
  PETRON: 'Transport',
  CALTEX: 'Transport',
  BHPETROL: 'Transport',
  BHP: 'Transport',
  'TOUCH N GO': 'Transport',
  TNG: 'Transport',
  GRAB: 'Transport',
  MYTEKSI: 'Transport',
  'RAPID KL': 'Transport',
  KTMB: 'Transport',
  PLUS: 'Transport',
  'SMART TAG': 'Transport',

  // ── Shopping ─────────────────────────────────────────
  SHOPEE: 'Shopping',
  LAZADA: 'Shopping',
  ZALORA: 'Shopping',
  AMAZON: 'Shopping',
  TEMU: 'Shopping',
  AEON: 'Shopping',
  'AEON BIG': 'Shopping',
  LOTUSS: 'Shopping',
  TESCO: 'Shopping',
  GIANT: 'Shopping',
  MYDIN: 'Shopping',
  NSK: 'Shopping',
  '99 SPEEDMART': 'Shopping',
  ECONSAVE: 'Shopping',
  'JAYA GROCER': 'Shopping',
  'VILLAGE GROCER': 'Shopping',
  'COLD STORAGE': 'Shopping',
  'KK SUPERMART': 'Shopping',
  FAMILYMART: 'Shopping',
  MYNEWS: 'Shopping',
  '7 ELEVEN': 'Shopping',
  IKEA: 'Shopping',
  'MR DIY': 'Shopping',
  DAISO: 'Shopping',
  UNIQLO: 'Shopping',

  // ── Bills & Utilities ────────────────────────────────
  'TENAGA NASIONAL': 'Bills & Utilities',
  TNB: 'Bills & Utilities',
  'INDAH WATER': 'Bills & Utilities',
  IWK: 'Bills & Utilities',
  SYABAS: 'Bills & Utilities',
  'AIR SELANGOR': 'Bills & Utilities',
  'PENGURUSAN AIR': 'Bills & Utilities',
  UNIFI: 'Bills & Utilities',
  TM: 'Bills & Utilities',
  TELEKOM: 'Bills & Utilities',
  MAXIS: 'Bills & Utilities',
  CELCOM: 'Bills & Utilities',
  CELCOMDIGI: 'Bills & Utilities',
  DIGI: 'Bills & Utilities',
  UMOBILE: 'Bills & Utilities',
  ASTRO: 'Bills & Utilities',
  'TIME DOTCOM': 'Bills & Utilities',

  // ── Personal Care ────────────────────────────────────
  WATSONS: 'Personal Care',
  GUARDIAN: 'Personal Care',
  'CARING PHARMACY': 'Personal Care',
  ALPRO: 'Personal Care',
  'BIG PHARMACY': 'Personal Care',
  SASA: 'Personal Care',
  'BODY SHOP': 'Personal Care',

  // ── Health ───────────────────────────────────────────
  'SUNWAY MEDICAL': 'Health',
  PANTAI: 'Health',
  GLENEAGLES: 'Health',
  KPJ: 'Health',
  'PRINCE COURT': 'Health',
  'BP HEALTHCARE': 'Health',
  QUALITAS: 'Health',

  // ── Entertainment ────────────────────────────────────
  NETFLIX: 'Entertainment',
  SPOTIFY: 'Entertainment',
  DISNEY: 'Entertainment',
  VIU: 'Entertainment',
  TGV: 'Entertainment',
  GSC: 'Entertainment',
  MBO: 'Entertainment',
  STEAM: 'Entertainment',
  PLAYSTATION: 'Entertainment',
  NINTENDO: 'Entertainment',

  // ── Travel ───────────────────────────────────────────
  AIRASIA: 'Travel',
  'MALAYSIA AIRLINES': 'Travel',
  'BATIK AIR': 'Travel',
  FIREFLY: 'Travel',
  AGODA: 'Travel',
  BOOKING: 'Travel',
  AIRBNB: 'Travel',
  TRIP: 'Travel',
  KLOOK: 'Travel',
  TRAVELOKA: 'Travel',
}

// Keys that are ordinary English words as well as merchants: matched only when
// they are the WHOLE canonical name, never as a prefix. "PLUS" is the highway
// operator and "TRIP"/"BOOKING" are the travel sites (trip.com and booking.com
// both canonicalise to a bare word once DOMAIN_TAIL is stripped) — but a
// prefix match would also claim "PLUS SIZE STORE" or "BOOKING FEE".
const EXACT_ONLY = new Set(['PLUS', 'TRIP', 'BOOKING'])

/**
 * Look up a canonical merchant name by progressively shorter word-boundary
 * prefixes, longest first (at most 4 lookups). Word-boundary matching is what
 * keeps GRAB (Transport) from capturing GRABFOOD or GRABPAY — those are single
 * tokens, not "GRAB" + a space.
 */
export function builtinCategory(canonical: string): SeedCategoryName | null {
  const words = canonical.split(' ')
  for (let n = Math.min(words.length, 4); n > 0; n--) {
    const key = words.slice(0, n).join(' ')
    if (n < words.length && EXACT_ONLY.has(key)) continue
    const hit = MERCHANT_MAP[key]
    if (hit) return hit
  }
  return null
}
