// Password hashing for the Workers runtime.
//
// Replaces bcrypt, which is a native Node addon and cannot run on Workers.
// PBKDF2-HMAC-SHA256 comes from the runtime's own Web Crypto — no dependency.
//
// ─── The iteration count is a constrained choice, not a default ───
//
// docs/option-2-spike-findings.md S1 measured the free tier's CPU ceiling by
// deploying and bisecting: 100,000 iterations succeeded 15/15, 105,000 failed
// 15/15. The cliff is deterministic (PBKDF2 is fixed work) and the failure mode
// is a hard HTTP 500 — an over-budget login simply breaks, it does not degrade.
//
// 100k consumes ~98% of the budget doing nothing else, and a real login also
// does a D1 user lookup, a session insert, cookie signing and JSON work. 50,000
// is the safe operating point: half the budget for hashing, half for the rest.
//
// **50,000 is 1/12 of OWASP's recommended 600,000.** That is only acceptable
// under the assumption S1 spells out — that every account uses a long, randomly
// generated password, so password entropy dominates and no iteration count is
// reachable by brute force. If any account uses a human-memorable password, this
// is a genuine weakness, because the whole defence rests on entropy the KDF is
// no longer providing. See MIN_PASSWORD in routes/auth.ts.
//
// Raising this later is safe and cheap: the stored format records the iteration
// count it was created with, so old hashes keep verifying and are transparently
// upgraded on next login (needsRehash). Moving to Workers Paid is a one-line
// change here plus a redeploy — nothing needs migrating.
export const PBKDF2_ITERATIONS = 50_000

const KEY_LEN_BITS = 256
const SALT_BYTES = 16

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_LEN_BITS,
  )
  return new Uint8Array(bits)
}

/** Length-independent, data-independent comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Hash a password. Returns `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`.
 *
 * The iteration count is stored in the string deliberately: it makes the cost
 * parameter a property of each hash rather than of the codebase, so
 * PBKDF2_ITERATIONS can change without a migration or a forced reset.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false — never throws — for malformed input, so a corrupt or
 * foreign-format row cannot 500 the login route. **bcrypt hashes from the Node
 * server return false here**: they are a different algorithm and cannot be
 * verified, which is why both accounts need new passwords at cutover (M6).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = Number(parts[1])
  // Guard the iteration count read out of the database: a corrupted or hostile
  // value could otherwise be used to burn the whole CPU budget on one request.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200_000) return false

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(parts[2])
    expected = fromBase64(parts[3])
  } catch {
    return false
  }

  const actual = await derive(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

/**
 * True when `stored` was created with a different cost than we now use, so the
 * login route can re-hash with the current parameters while it legitimately has
 * the plaintext. This is what makes raising PBKDF2_ITERATIONS a no-drama change.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return true
  return Number(parts[1]) !== PBKDF2_ITERATIONS
}
