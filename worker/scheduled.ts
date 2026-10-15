import type { Env } from './types.ts'
import { todayStr, businessMinuteStr } from './lib.ts'
import { notificationsFor, type Slot } from './lib/notifications.ts'
import { sendPush } from './lib/webpush.ts'

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

  const subject = env.VAPID_SUBJECT || 'mailto:daybook@moascode.dev'
  const today = todayStr()

  const { results: subs } = await env.DB.prepare(
    `SELECT id, user_id, endpoint FROM push_subscriptions WHERE expired_at IS NULL`,
  ).all<{ id: string; user_id: string; endpoint: string }>()
  if (subs.length === 0) return

  const byUser = new Map<string, { id: string; endpoint: string }[]>()
  for (const s of subs) {
    const list = byUser.get(s.user_id) ?? []
    list.push({ id: s.id, endpoint: s.endpoint })
    byUser.set(s.user_id, list)
  }

  for (const [userId, endpoints] of byUser) {
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

    await pushToSubscriptions(env, endpoints, { subject, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY })
  }
}

interface LiveSub {
  id: string
  endpoint: string
}

/**
 * Send one payload-less push to each of a user's live subscriptions and keep
 * their bookkeeping honest: a 404/410 retires the subscription, a success
 * stamps `last_sent_at`, anything else is logged and left for the next try.
 * Shared by the digest and the reminder cron so the two cannot drift.
 */
async function pushToSubscriptions(
  env: Env,
  subs: LiveSub[],
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<number> {
  let delivered = 0
  for (const { id, endpoint } of subs) {
    const res = await sendPush(endpoint, vapid.subject, vapid.publicKey, vapid.privateKey)
    if (res.gone) {
      await env.DB.prepare(`UPDATE push_subscriptions SET expired_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run()
    } else if (res.ok) {
      delivered++
      await env.DB.prepare(`UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run()
    } else {
      // Transient: leave it alone and let the next slot try again.
      console.error('push failed', endpoint, res.status)
    }
  }
  return delivered
}

export interface ReminderRun {
  /** Reminders whose time had come and which were still open. */
  due: number
  /** Of those, how many this run claimed (the rest had already been sent). */
  claimed: number
  /** Pushes the push service accepted. */
  pushed: number
}

/**
 * The reminder sweep (FEAT-055), run every 15 minutes.
 *
 * A task's `remind_at` ('YYYY-MM-DDTHH:MM', business time) has passed, the
 * task is still open, and its date is no older than yesterday — a reminder
 * that old was missed, and announcing it now would be noise, not help.
 * `push_sent_log` (kind `reminder:<task id>`, dated by the reminder's own day)
 * makes each reminder fire at most once even if the cron overlaps or retries.
 * The recipient is the assignee when there is one, else the owner. `now` is a
 * business-time minute string, for tests.
 */
export async function runReminders(env: Env, now: string = businessMinuteStr()): Promise<ReminderRun> {
  const run: ReminderRun = { due: 0, claimed: 0, pushed: 0 }
  const yesterday = new Date(`${now.slice(0, 10)}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const earliest = `${yesterday.toISOString().slice(0, 10)}T00:00`

  const { results: due } = await env.DB.prepare(
    `SELECT id, COALESCE(assignee_id, user_id) AS recipient, substr(remind_at, 1, 10) AS day
       FROM tasks
      WHERE is_completed = 0 AND remind_at IS NOT NULL AND remind_at <= ? AND remind_at >= ?`,
  )
    .bind(now, earliest)
    .all<{ id: string; recipient: string; day: string }>()
  run.due = due.length

  const publicKey = env.VAPID_PUBLIC_KEY
  const privateKey = env.VAPID_PRIVATE_KEY
  const subject = env.VAPID_SUBJECT || 'mailto:daybook@moascode.dev'

  for (const { id, recipient, day } of due) {
    const claim = await env.DB.prepare(
      `INSERT INTO push_sent_log (user_id, kind, sent_on) VALUES (?, ?, ?)
       ON CONFLICT (user_id, kind, sent_on) DO NOTHING`,
    )
      .bind(recipient, `reminder:${id}`, day)
      .run()
    if (claim.meta.changes === 0) continue
    run.claimed++
    if (!publicKey || !privateKey) continue

    const { results: subs } = await env.DB.prepare(
      `SELECT id, endpoint FROM push_subscriptions WHERE user_id = ? AND expired_at IS NULL`,
    )
      .bind(recipient)
      .all<LiveSub>()
    run.pushed += await pushToSubscriptions(env, subs, { subject, publicKey, privateKey })
  }
  return run
}
