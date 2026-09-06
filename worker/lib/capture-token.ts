// Capture tokens — the credential a non-browser client (an iOS Shortcuts
// automation, Claude, a future email worker) uses to create a pending capture.
// Spec: docs/v2/wallet/feature-capture-inbox.md §4.
//
// Deliberately NOT PBKDF2, and this is the one place reusing worker/crypto.ts
// would be cargo-culting. PBKDF2's 50k iterations exist to make dictionary
// attacks on low-entropy *human passwords* expensive. A 256-bit random token
// has no dictionary, so a single SHA-256 is correct and ~free on the CPU
// budget. Lookup is an indexed match on the digest, so no constant-time
// compare is needed either — the comparison happens inside SQLite's index,
// not in JS over a secret.

export const TOKEN_PREFIX = 'dbk_cap_'

/** The only scope that exists today. Read scopes are deliberately out of scope
 *  (owner, 2026-09-06) — see the spec's D-B. */
export const SCOPE_CAPTURE_WRITE = 'capture:write'

/** Per-token hourly ceiling. Far above real spending, far below abuse. */
export const CAPTURE_RATE_LIMIT_MAX = 60

/** Settings-key prefix for the per-token counter. Must stay in
 *  INTERNAL_KEY_PREFIXES (worker/routes/settings.ts) or a user could reset
 *  their own token's limit through the generic settings PUT. */
export const CAPTURE_RATE_LIMIT_PREFIX = 'capture_rate_limit_'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh token: `dbk_cap_` + 43 base64url chars of 256-bit randomness. */
export function mintToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return TOKEN_PREFIX + base64url(bytes)
}

/** SHA-256 hex. What is stored and what is looked up by — the plaintext token
 *  is never persisted, so a database read cannot recover a working credential. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The `Authorization: Bearer <token>` value, or null. Header only — never a
 *  query string, which would leak the token into Cloudflare's request logs. */
export function bearerFrom(header: string | undefined | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1] : null
}
