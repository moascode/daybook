import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { notificationsFor } from '../lib/notifications.ts'

// Cookie-authenticated, mounted on protectedApi. The service worker's fetch is
// same-origin, so it carries the session cookie and reads this exactly as the
// page would.
export const notifications = new Hono<AppEnv>()

/** Whether push is available at all — the client hides the toggle without it. */
notifications.get('/notifications/config', (c) =>
  c.json({
    // Presence only. The public key is not a secret (the browser needs it to
    // subscribe), but there is no reason to hand it out before it is asked for.
    enabled: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
    publicKey: c.env.VAPID_PUBLIC_KEY ?? '',
  }),
)

/**
 * What the service worker should say. Read live at display time rather than
 * baked into the push, so a count can never be stale by the time it is read —
 * which is the upside of sending payload-less pushes.
 */
notifications.get('/notifications/pending', async (c) =>
  c.json({ notifications: await notificationsFor(c.env.DB, c.get('userId')) }),
)

notifications.post('/notifications/subscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint.trim() : ''
  if (!endpoint || !/^https:\/\//.test(endpoint)) {
    return c.json({ error: 'a push endpoint is required' }, 400)
  }
  const keys = (b.keys ?? {}) as Record<string, unknown>

  // The endpoint is unique per browser install, so re-subscribing the same
  // browser updates its row instead of accumulating duplicates. Re-subscribing
  // also clears expired_at: the browser has just told us it is alive again.
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, expired_at = NULL`,
  )
    .bind(
      c.get('userId'),
      endpoint,
      typeof keys.p256dh === 'string' ? keys.p256dh : '',
      typeof keys.auth === 'string' ? keys.auth : '',
    )
    .run()

  return c.json({ ok: true }, 201)
})

notifications.post('/notifications/unsubscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : ''
  if (!endpoint) return c.json({ error: 'a push endpoint is required' }, 400)

  // Scoped by user: one account must not be able to delete another's
  // subscription by guessing an endpoint.
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(c.get('userId'), endpoint)
    .run()
  return c.json({ ok: true })
})

/** Whether THIS browser is subscribed, so the toggle can show its real state. */
notifications.get('/notifications/subscription', async (c) => {
  const endpoint = c.req.query('endpoint') ?? ''
  if (!endpoint) return c.json({ subscribed: false })
  const row = await c.env.DB.prepare(
    'SELECT 1 AS ok FROM push_subscriptions WHERE user_id = ? AND endpoint = ? AND expired_at IS NULL',
  )
    .bind(c.get('userId'), endpoint)
    .first<{ ok: number }>()
  return c.json({ subscribed: Boolean(row) })
})
