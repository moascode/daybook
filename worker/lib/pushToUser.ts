import type { Env } from '../types.ts'
import { sendPush } from './webpush.ts'

/**
 * Sends a payload-less push to every live subscription of one user and
 * retires the dead ones (404/410), exactly as the scheduled digest always has.
 * Shared by runDigest and the task nudge so the two cannot drift.
 *
 * Returns how many devices the push service accepted. 0 covers "no VAPID keys
 * configured", "no subscriptions" and "every attempt failed" — callers that
 * report delivery to a human must treat 0 as "not pushed", never as success.
 */
export async function pushToUser(env: Env, userId: string): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0
  const subject = env.VAPID_SUBJECT || 'mailto:daybook@moascode.dev'

  const { results: subs } = await env.DB.prepare(
    `SELECT id, endpoint FROM push_subscriptions WHERE user_id = ? AND expired_at IS NULL`,
  )
    .bind(userId)
    .all<{ id: string; endpoint: string }>()

  let delivered = 0
  for (const { id, endpoint } of subs) {
    const res = await sendPush(endpoint, subject, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
    if (res.gone) {
      await env.DB.prepare(`UPDATE push_subscriptions SET expired_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run()
    } else if (res.ok) {
      delivered += 1
      await env.DB.prepare(`UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run()
    } else {
      // Transient: leave it alone and let the next send try again.
      console.error('push failed', endpoint, res.status)
    }
  }
  return delivered
}
