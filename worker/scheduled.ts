import type { Env } from './types.ts'
import { todayStr } from './lib.ts'
import { notificationsFor, type Slot } from './lib/notifications.ts'
import { pushToUser } from './lib/pushToUser.ts'

/**
 * The scheduled digest (v3 P4).
 *
 * Sends a payload-less push to every live subscription of every user who has
 * something worth hearing about. The service worker then fetches the text
 * itself — see worker/lib/webpush.ts for why there is no payload.
 *
 * Three properties this has to hold, all of them about not being annoying or
 * wrong:
 *
 *  1. AT MOST ONE PUSH PER USER PER SLOT PER DAY. `push_sent_log`'s primary key
 *     enforces it, so a cron that fires twice (a retry, an overlapping
 *     schedule) cannot notify twice.
 *  2. NOTHING TO SAY MEANS NOTHING SENT. A digest that arrives every morning
 *     regardless is one you learn to ignore, which costs the alerts that matter.
 *  3. A DEAD SUBSCRIPTION IS RETIRED, NOT RETRIED. 404/410 from the push
 *     service means the browser threw it away; it is marked expired and never
 *     tried again.
 */
export async function runDigest(env: Env, slot: Slot): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return

  const today = todayStr()

  const { results: subs } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM push_subscriptions WHERE expired_at IS NULL`,
  ).all<{ user_id: string }>()

  for (const { user_id: userId } of subs) {
    let pending
    try {
      pending = await notificationsFor(env.DB, userId, slot)
    } catch (err) {
      // One user's failing query must not stop every other user's digest.
      console.error('digest: could not compute notifications', userId, err)
      continue
    }
    if (pending.length === 0) continue

    // Property 1. INSERT … ON CONFLICT DO NOTHING is the whole guard: if the
    // row is already there this slot already ran today, and `changes` says so
    // without a separate read.
    const claim = await env.DB.prepare(
      `INSERT INTO push_sent_log (user_id, kind, sent_on) VALUES (?, ?, ?)
       ON CONFLICT (user_id, kind, sent_on) DO NOTHING`,
    )
      .bind(userId, slot, today)
      .run()
    if (claim.meta.changes === 0) continue

    await pushToUser(env, userId)
  }
}
