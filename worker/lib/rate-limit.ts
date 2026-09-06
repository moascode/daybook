// Per-user, per-key hourly rate limiting, stored as a JSON blob in the
// settings key/value table — the app owns no queue, KV namespace, or Durable
// Object today.
//
// Extracted from worker/routes/wallet.ts's `overAiRateLimit` (R18) so the
// capture endpoint can reuse it with its own ceiling. The mechanism is
// unchanged; only `max` and `windowMs` became parameters.
//
// ONE UNIT PER REQUEST, not per downstream call: a request may fan out to
// several chunks, but the cap exists to stop a runaway loop, and a caller who
// acted once should not find they have spent half their hour's budget because
// the batch was large.
//
// Atomic. The whole read-modify-write — window expiry, increment, and the
// fresh-window reset — happens inside one INSERT … ON CONFLICT … RETURNING,
// and a single SQLite statement cannot interleave with another. json_valid()
// guards the CASE so a corrupt row resets the window instead of throwing.
// Note the counter still increments on a rejected request; that is harmless
// (it is already over the cap) and the window start is preserved either way,
// so it self-heals on the hour rather than sliding forward forever.

export const HOUR_MS = 60 * 60 * 1000

export async function overRateLimit(
  db: D1Database,
  userId: string,
  key: string,
  max: number,
  windowMs: number = HOUR_MS,
): Promise<boolean> {
  const now = Date.now()
  const row = await db
    .prepare(
      `INSERT INTO settings (user_id, key, value)
       VALUES (?, ?, json_object('windowStart', ?, 'count', 1))
       ON CONFLICT (user_id, key) DO UPDATE SET value =
         CASE
           WHEN json_valid(settings.value)
            AND json_extract(settings.value, '$.windowStart') IS NOT NULL
            AND ? - json_extract(settings.value, '$.windowStart') <= ?
           THEN json_object(
             'windowStart', json_extract(settings.value, '$.windowStart'),
             'count', COALESCE(json_extract(settings.value, '$.count'), 0) + 1)
           ELSE json_object('windowStart', ?, 'count', 1)
         END
       RETURNING value`,
    )
    .bind(userId, key, now, now, windowMs, now)
    .first<{ value: string }>()

  const count = Number(JSON.parse(row?.value ?? '{}')?.count ?? 1)
  return count > max
}
