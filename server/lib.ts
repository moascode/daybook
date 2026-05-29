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

/** better-sqlite3 only binds numbers/strings/bigints/buffers/null — coerce the rest. */
export function normalizeBind(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined) return null
  return v
}
