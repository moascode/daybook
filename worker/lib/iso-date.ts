// BUG-002: `Date.parse` (and the `new Date(string)` constructor) silently
// rolls an impossible calendar date over into the next valid one —
// 2026-02-30 becomes 2 March, 2026-04-31 becomes 1 May — instead of
// returning NaN. `ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(v))` in
// worker/routes/wallet.ts therefore accepted both and silently relocated the
// transaction to the rolled-over day.
//
// The fix is to round-trip through `Date.UTC` (which performs the same
// rollover) and reject anything whose re-serialised form doesn't match the
// input byte-for-byte. UTC, not local time, so the check can't drift with
// the Worker's own clock (see CLAUDE.md §3 "The suite runs on ONE clock").

const ISO_DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True only for a string shaped YYYY-MM-DD that names a real calendar date. */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_SHAPE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toISOString().slice(0, 10) === v
}
