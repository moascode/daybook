import { newId, normalizeBind } from '../lib.ts'
import { buildDuplicateKey } from './merchant.ts'

/**
 * THE write path into `transactions`. Every caller goes through here — manual
 * create, CSV import, photo import, the recurring processor, and (R18)
 * accepting a capture from the inbox.
 *
 * Keeping it a single function is what makes `duplicate_key` universal: cross-
 * source duplicate detection (docs/v2/wallet/duplicate-detection.md) depends on
 * every row having a normalized fingerprint, and a second INSERT written
 * somewhere else would silently opt its rows out of it.
 *
 * Returns a prepared statement rather than executing it, so callers can run it
 * directly or fold it into a batch() — the recurring processor and the capture
 * accept both need the latter.
 *
 * `id` is optional: pass one when the caller needs to reference the new row in
 * the SAME batch (accepting a capture has to write the id back onto the pending
 * row, and a batch cannot read a prior statement's RETURNING).
 */
export function insertTransactionStmt(
  db: D1Database,
  b: Record<string, unknown>,
  userId: string,
  id: string = newId(),
) {
  const amount = Number(b.amount)
  const duplicateKey = buildDuplicateKey(String(b.date ?? ''), amount, String(b.type ?? ''), String(b.merchant ?? ''))
  return db
    .prepare(
      `INSERT INTO transactions
         (id, user_id, account_id, destination_account_id, date, merchant, description,
          amount, type, category_id, tag, import_hash, duplicate_key, created_at, updated_at)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       RETURNING *`,
    )
    // id, userId, accountId, destinationAccountId, date, merchant, description,
    // amount, type, categoryId, tag, importHash, duplicateKey
    .bind(
      id,
      userId,
      b.accountId,
      b.destinationAccountId ?? null,
      b.date,
      b.merchant ?? '',
      b.description ?? '',
      normalizeBind(b.amount),
      b.type,
      b.categoryId ?? null,
      Array.isArray(b.tag) ? JSON.stringify(b.tag) : (b.tag ?? '[]'),
      b.importHash ?? '',
      duplicateKey,
    )
}
