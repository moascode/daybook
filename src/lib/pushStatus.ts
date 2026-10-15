import { api } from '@/lib/api'

/**
 * Will a push reach THIS browser? True only when the server has push
 * configured, the browser supports it and this install's subscription is
 * known to the server — the same three checks the Settings toggle makes
 * (modules/settings/PushNotifications.tsx).
 *
 * Any failure to find out resolves to `false`: callers use this to decide how
 * carefully to word a promise ("you'll get a push"), so "can't tell" must
 * read as "no".
 */
export async function isPushActiveHere(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const cfg = await api.get<{ enabled: boolean }>('/notifications/config')
    if (!cfg.enabled) return false
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    const { subscribed } = await api.get<{ subscribed: boolean }>(
      `/notifications/subscription?endpoint=${encodeURIComponent(sub.endpoint)}`,
    )
    return subscribed
  } catch {
    // Reported by the caller's more cautious wording, not swallowed: see above.
    return false
  }
}
