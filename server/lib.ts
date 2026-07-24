import type { DB } from './db.ts'

/**
 * Build and run a dynamic UPDATE from a camelCase→column whitelist.
 * Only keys present in `body` are updated. Bumps `updated_at` unless disabled.
 * Returns the updated row (snake_case), or undefined if the id was not found.
 *
 * `table` and column names come from our own constants (never user input), so
 * interpolating them is safe.
 */
export function updateRow<T = Record<string, unknown>>(
  db: DB,
  table: string,
  id: string,
  userId: string,
  columnMap: Record<string, string>,
  body: Record<string, unknown>,
  opts: { touchUpdatedAt?: boolean } = {},
): T | undefined {
  const sets: string[] = []
  const params: Record<string, unknown> = { id, userId }

  for (const [key, col] of Object.entries(columnMap)) {
    if (key in body) {
      sets.push(`${col} = @${key}`)
      params[key] = normalizeBind(body[key])
    }
  }

  // Scope by user_id so one user can never update another's rows.
  const where = 'WHERE id = @id AND user_id = @userId'

  if (opts.touchUpdatedAt !== false) {
    sets.push(`updated_at = datetime('now')`)
  }

  if (sets.length === 0) {
    return db.prepare(`SELECT * FROM ${table} ${where}`).get(params) as T | undefined
  }

  return db
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} ${where} RETURNING *`)
    .get(params) as T | undefined
}

/**
 * Local calendar date (YYYY-MM-DD), matching the client's todayISO() — NOT UTC.
 * Settlements and other server-dated rows use this so they land on the user's
 * "today" rather than drifting a day in +8 timezones (B-11).
 */
export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** better-sqlite3 only binds numbers/strings/bigints/buffers/null — coerce the rest. */
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
  const base = Math.floor((amount / n) * 100) / 100
  const remainder = Math.round((amount - base * n) * 100) / 100
  return [Math.round((base + remainder) * 100) / 100, ...Array<number>(n - 1).fill(base)]
}

/**
 * True if `id` references a row in `table` owned by `userId`. Null/undefined ids
 * count as valid (optional references). `table` is always a hardcoded constant.
 */
export function userOwns(db: DB, table: string, id: unknown, userId: string): boolean {
  if (id === null || id === undefined) return true
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)
}

/**
 * Guard cross-tenant foreign-key references: rejects writes where any referenced
 * account/category belongs to another user. Returns true when every ref is owned
 * (or absent). Without this, a user could attach their rows to another user's
 * account/category and, via ON DELETE CASCADE, delete or mutate that user's data.
 */
export function ownsAllRefs(db: DB, userId: string, refs: Array<[string, unknown]>): boolean {
  return refs.every(([table, id]) => userOwns(db, table, id, userId))
}
