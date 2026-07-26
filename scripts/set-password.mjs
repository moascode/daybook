#!/usr/bin/env node
// Generate the SQL to set a user's Daybook password on D1.
//
//   node scripts/set-password.mjs <username>
//
// Why this exists: the app has no change-password endpoint, and at cutover the
// migrated hashes are bcrypt, which the Worker's PBKDF2 verifier cannot check
// (by design — they are different algorithms). Without this there is no way to
// give either account a working password on D1. This is manual step M6.
//
// The password is read from an interactive prompt with echo disabled. It is
// never passed as a command-line argument (argv is visible to `ps` and lands in
// shell history) and never written to disk — only the derived hash is printed.
//
// Output is a single UPDATE statement. Review it, then apply:
//
//   node scripts/set-password.mjs kakon > /tmp/pw.sql
//   npx wrangler d1 execute daybook --remote --file /tmp/pw.sql
//   rm /tmp/pw.sql
//
// The parameters below MUST match worker/crypto.ts. They are duplicated rather
// than imported because that module targets the Workers runtime; the algorithm
// is standard PBKDF2-HMAC-SHA256 and node:crypto.webcrypto is the same
// implementation, so the hashes are interchangeable.

import { webcrypto as crypto } from 'node:crypto'
import { createInterface } from 'node:readline'

// Keep in sync with PBKDF2_ITERATIONS in worker/crypto.ts.
const PBKDF2_ITERATIONS = 50_000
const KEY_LEN_BITS = 256
const SALT_BYTES = 16
const MIN_PASSWORD = 12 // matches MIN_PASSWORD in worker/routes/auth.ts

const username = process.argv[2]?.trim().toLowerCase()
if (!username) {
  console.error('usage: node scripts/set-password.mjs <username>')
  process.exit(1)
}

/** Prompt on stderr with echo off, so stdout stays a clean SQL stream. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    // Suppress echo: replace the output writer while the answer is typed.
    const onWrite = (chunk, encoding, callback) => {
      if (!rl.__answering) process.stderr.write(chunk, encoding)
      if (callback) callback()
    }
    rl.output.write = onWrite
    process.stderr.write(question)
    rl.__answering = true
    rl.question('', (answer) => {
      rl.__answering = false
      process.stderr.write('\n')
      rl.close()
      resolve(answer)
    })
    rl.on('error', reject)
  })
}

const password = await promptHidden(`New password for "${username}": `)
const confirm = await promptHidden('Confirm: ')

if (password !== confirm) {
  console.error('✘ passwords do not match — nothing written')
  process.exit(1)
}
if (password.length < MIN_PASSWORD) {
  console.error(`✘ password must be at least ${MIN_PASSWORD} characters`)
  process.exit(1)
}

// Advisory only — the app cannot measure entropy, and this is the control that
// the 50k iteration count depends on (see the comment block in worker/crypto.ts).
if (!/[^A-Za-z0-9]/.test(password) || password.length < 20) {
  console.error(
    `⚠ At ${PBKDF2_ITERATIONS.toLocaleString()} PBKDF2 iterations (1/12 of OWASP's 600,000, ` +
      `capped by the Workers free tier) the security of this account rests on the password's ` +
      `entropy, not on the KDF. A 24+ character password-manager-generated value is the ` +
      `assumption the deployment is designed around.\n`,
  )
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  'PBKDF2',
  false,
  ['deriveBits'],
)
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  key,
  KEY_LEN_BITS,
)

const hash = `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`

// The hash contains only base64 and '$' — no quoting hazard — but the username
// is escaped anyway rather than relying on that.
console.log(
  `UPDATE users SET password_hash = '${hash}' WHERE username = '${username.replace(/'/g, "''")}';`,
)
console.error(`✔ SQL written to stdout for user "${username}" (verify it matches 1 row)`)
