// Port of server/lib.ts to D1. Three differences from the Node original, all
// forced by the driver rather than chosen:
//
//   1. Everything that touches the database is async.
//   2. **D1 has no named parameters.** better-sqlite3 accepts `@key` bound from
//      an object; D1's `.bind()` is positional only. updateRow() therefore
//      builds an ordered argument list instead of a params object — the one
//      non-mechanical change in this file.
//   3. `.get()` → `await .first()`, which returns `null` (not `undefined`) for
//      no match; callers get `undefined` so the existing call sites are unchanged.
//
// The pure functions (todayStr, splitEqually, normalizeBind) are byte-identical
// in behaviour to server/lib.ts — keep the two in sync until Phase 7 retires the
// server copy.

/**
 * Build and run a dynamic UPDATE from a camelCase→column whitelist.
 * Only keys present in `body` are updated. Bumps `updated_at` unless disabled.
 * Returns the updated row (snake_case), or undefined if the id was not found.
 *
 * `table` and column names come from our own constants (never user input), so
 * interpolating them is safe. Values are always bound, never interpolated.
 */
export async function updateRow<T = Record<string, unknown>>(
  db: D1Database,
  table: string,
  id: string,
  userId: string,
  columnMap: Record<string, string>,
  body: Record<string, unknown>,
  opts: { touchUpdatedAt?: boolean } = {},
): Promise<T | undefined> {
  const row = await updateRowStmt(db, table, id, userId, columnMap, body, opts).first<T>()
  return row ?? undefined
}

/**
 * The prepared statement behind updateRow(), for callers that must commit the
 * update **together with** other writes.
 *
 * `batch()` is the only atomic unit D1 offers, and it takes statements rather
 * than promises — so anything that has to land in the same transaction as an
 * update has to be able to get at the statement instead of an executed result.
 * PATCH /transactions needs exactly this: rescaled split rows and the amount
 * change must commit together, or the splits stop summing to the transaction.
 *
 * When no column in `columnMap` is present in `body` this is a plain SELECT, so
 * the "nothing to update" case still returns the current row.
 */
export function updateRowStmt(
  db: D1Database,
  table: string,
  id: string,
  userId: string,
  columnMap: Record<string, string>,
  body: Record<string, unknown>,
  opts: { touchUpdatedAt?: boolean } = {},
): D1PreparedStatement {
  const sets: string[] = []
  // Bind order must match the order placeholders appear in the final SQL:
  // every SET value first, then the two WHERE values.
  const values: unknown[] = []

  for (const [key, col] of Object.entries(columnMap)) {
    if (key in body) {
      sets.push(`${col} = ?`)
      values.push(normalizeBind(body[key]))
    }
  }

  // Scope by user_id so one user can never update another's rows.
  const where = 'WHERE id = ? AND user_id = ?'

  if (opts.touchUpdatedAt !== false) {
    // No placeholder — datetime('now') is evaluated by SQLite, not bound.
    sets.push(`updated_at = datetime('now')`)
  }

  if (sets.length === 0) {
    return db.prepare(`SELECT * FROM ${table} ${where}`).bind(id, userId)
  }

  return db
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} ${where} RETURNING *`)
    .bind(...values, id, userId)
}

/**
 * A row id in the same shape the schema's column default produces
 * (`lower(hex(randomblob(16)))` — 32 lowercase hex characters).
 *
 * Needed wherever a batch inserts a parent and a child together: `batch()` runs
 * statements independently, so a child cannot read the parent's `RETURNING id`.
 * Generating the id up front lets both statements be prepared before either
 * runs, which is what makes the pair atomic.
 */
export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The app's business timezone.
 *
 * On the Mac, server/lib.ts todayStr() used the host's local clock, which is
 * Malaysian time — that is what B-11 means by "the user's today". A Worker's
 * clock is **always UTC**, so porting that code literally would silently shift
 * the date boundary by 8 hours: between 00:00 and 08:00 MYT every server-dated
 * row would be stamped with yesterday. Pinning the zone preserves the original
 * intent instead of inheriting the edge's timezone by accident.
 */
const TZ = 'Asia/Kuala_Lumpur'

/** en-CA formats as YYYY-MM-DD, which is the shape the schema stores. */
const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Today's calendar date (YYYY-MM-DD) in the business timezone — NOT UTC.
 * Settlements and other server-dated rows use this so they land on the user's
 * "today" rather than drifting a day in +8 timezones (B-11).
 */
export function todayStr(): string {
  return dateFmt.format(new Date())
}

/**
 * Convert a SQLite `datetime('now')` value (always UTC, 'YYYY-MM-DD HH:MM:SS')
 * to a calendar date in the business timezone.
 *
 * Needed to compare a stored timestamp against todayStr(). Slicing the first 10
 * characters of the raw value compares a UTC date against an MYT date, which
 * disagree for the first 8 hours of every MYT day.
 */
export function businessDateOf(sqlUtcDatetime: string): string {
  // SQLite emits a space separator and no zone; make it explicit UTC so the
  // engine does not parse it as local time.
  const iso = `${sqlUtcDatetime.replace(' ', 'T')}Z`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return sqlUtcDatetime.slice(0, 10)
  return dateFmt.format(parsed)
}

/** D1 binds numbers/strings/null/ArrayBuffer — coerce the rest. */
export function normalizeBind(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined) return null
  return v
}

/**
 * §5.9: the one equal-split implementation. Splits `amount` into n cent-exact
 * shares; index 0 is the payer/owner, who absorbs the rounding remainder
 * (owner-absorbs rule, §2.1 owner decision). Mirrored in src/lib/utils.ts —
 * keep the two in sync.
 */
export function splitEqually(amount: number, n: number): number[] {
  if (n <= 0) return []
  // B-09: work in integer cents so a cleanly divisible amount splits exactly
  // (RM8.20 ÷ 4 = 2.05 each). Index 0 (owner) absorbs the leftover cents.
  const cents = Math.round(amount * 100)
  const base = Math.floor(cents / n)
  const remainder = cents - base * n
  return [(base + remainder) / 100, ...Array<number>(n - 1).fill(base / 100)]
}

/**
 * True if `id` references a row in `table` owned by `userId`. Null/undefined ids
 * count as valid (optional references). `table` is always a hardcoded constant.
 *
 * ⚠️ One network round trip per call. Fine for a single write; **never call this
 * in a loop over request rows** — see ownedIdSet() below.
 */
export async function userOwns(
  db: D1Database,
  table: string,
  id: unknown,
  userId: string,
): Promise<boolean> {
  if (id === null || id === undefined) return true
  const row = await db
    .prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<{ ok: number }>()
  return !!row
}

/**
 * Guard cross-tenant foreign-key references: rejects writes where any referenced
 * account/category belongs to another user. Returns true when every ref is owned
 * (or absent). Without this, a user could attach their rows to another user's
 * account/category and, via ON DELETE CASCADE, delete or mutate that user's data.
 *
 * Sequential by necessity (each ref may target a different table), but the ref
 * list is fixed-length per write — it does not grow with request size.
 */
export async function ownsAllRefs(
  db: D1Database,
  userId: string,
  refs: Array<[string, unknown]>,
): Promise<boolean> {
  for (const [table, id] of refs) {
    if (!(await userOwns(db, table, id, userId))) return false
  }
  return true
}

/**
 * Batched counterpart to userOwns(): every id in `table` owned by `userId`,
 * as a Set for in-memory membership checks.
 *
 * This exists because of the finding in docs/option-2-spike-findings.md §S2:
 * the CSV import route calls userOwns()/ownsAllRefs() **per row**, which is free
 * under better-sqlite3's in-process driver and 2–3 network round trips per row
 * under D1 — 1,000–1,500 awaited queries for a 500-row import. Any route that
 * validates references for a list of items must read its ownership sets once
 * with this and then check against them, instead of querying inside the loop.
 *
 * `table` is always a hardcoded constant, never user input.
 */
export async function ownedIdSet(
  db: D1Database,
  table: string,
  userId: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string }>()
  return new Set(results.map((r) => r.id))
}
