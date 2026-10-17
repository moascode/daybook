// Pure, zero-dependency helper split out of captures.ts so it can be unit
// tested with tsx --test without pulling in captures.ts's `@/` aliased
// imports (api.ts, wallet.types) — tsx's tsconfig-paths resolution doesn't
// apply to files run outside the Vite build, same reason every other
// *.test.ts in this repo sticks to relative imports.

/**
 * Extracts a last4 from the END of a raw card/account string — but only a
 * STANDALONE 4-digit token (a maximal run of digits exactly 4 long), not any
 * trailing substring of a longer run. "Visa 9876" -> "9876"; "12345" -> null
 * (its last 4 digits are part of a 5-digit run, not a standalone token).
 *
 * A trailing token that looks like a year (19xx/20xx — usually an expiry,
 * e.g. "Visa 4321 exp 2027") is treated as unreliable: if an earlier
 * standalone 4-digit token exists, that one is preferred. Otherwise the
 * year-shaped token is still accepted — some real card last4s do look like a
 * year, and there's nothing better to fall back to.
 */
export function extractLast4(raw: string): string | null {
  const groups = raw.split(/\D+/).filter(Boolean)
  if (groups.length === 0) return null
  const trailing = groups[groups.length - 1]
  if (trailing.length !== 4) return null
  if (!/^(19|20)\d{2}$/.test(trailing)) return trailing
  for (let i = groups.length - 2; i >= 0; i--) {
    if (groups[i].length === 4) return groups[i]
  }
  return trailing
}
