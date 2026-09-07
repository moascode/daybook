// Web Push, VAPID-signed and deliberately PAYLOAD-LESS (v3 P4).
//
// A push message may carry an encrypted payload, but doing so means
// implementing RFC 8291 — ECDH against the subscription's key, HKDF, and
// aes128gcm — by hand, because the usual libraries (web-push) are Node-only and
// do not run on Workers. A payload-less push needs none of it: just a
// VAPID-signed request, which is one ECDSA signature Web Crypto does natively.
//
// The cost is one extra round trip: the service worker's `push` handler fetches
// what to say from /api/notifications/pending. Since the SW is same-origin, its
// fetch carries the session cookie, so the content is authenticated the same
// way every other read is — and, usefully, notification text can never be stale
// or wrong, because it is computed at display time rather than at send time.
//
// No dependency. The owner pre-approved adding one if Web Crypto fell short; it
// did not.

const VAPID_TTL_SECONDS = 12 * 60 * 60

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/**
 * Imports the VAPID private key. It is stored as a base64url PKCS#8 blob in a
 * Worker secret — never in wrangler.toml, and never in the repo.
 */
async function importPrivateKey(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    b64urlDecode(pkcs8B64) as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/**
 * The VAPID Authorization header for one push service origin.
 *
 * The JWT is scoped to the push service's ORIGIN, not to the endpoint, so it
 * can be reused across every subscription on the same service — which is why
 * this is built once per origin per send rather than once per subscription.
 */
async function vapidHeader(
  audience: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + VAPID_TTL_SECONDS,
        sub: subject,
      }),
    ),
  )
  const signingInput = new TextEncoder().encode(`${header}.${claims}`)
  const key = await importPrivateKey(privateKeyB64)
  // Web Crypto returns ECDSA signatures as raw r||s, which is exactly what
  // JWS ES256 wants — no DER unwrapping needed.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput as unknown as ArrayBuffer)
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKeyB64}`
}

export interface PushResult {
  endpoint: string
  ok: boolean
  /** True when the push service says this subscription is permanently gone. */
  gone: boolean
  status: number
}

/**
 * Sends one payload-less push. Never throws: a dead subscription is an expected
 * outcome, not an error, and one failure must not abort a batch.
 */
export async function sendPush(
  endpoint: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<PushResult> {
  try {
    const audience = new URL(endpoint).origin
    const authorization = await vapidHeader(audience, subject, publicKeyB64, privateKeyB64)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        TTL: '86400',
        // No body, so the push service must be told the length is zero
        // explicitly; some reject a bodyless POST without it.
        'Content-Length': '0',
      },
    })
    // 404/410 mean the browser threw the subscription away — unsubscribed,
    // uninstalled, or storage cleared. Retrying is pointless forever.
    return { endpoint, ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status }
  } catch {
    return { endpoint, ok: false, gone: false, status: 0 }
  }
}
