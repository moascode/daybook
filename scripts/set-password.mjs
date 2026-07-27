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
import { writeFileSync } from 'node:fs'

// Keep in sync with PBKDF2_ITERATIONS in worker/crypto.ts.
const PBKDF2_ITERATIONS = 50_000
const KEY_LEN_BITS = 256
const SALT_BYTES = 16
const MIN_PASSWORD = 12 // matches MIN_PASSWORD in worker/routes/auth.ts

const args = process.argv.slice(2)
const useStdin = args.includes('--stdin')
const outIdx = args.indexOf('--out')
const outFile = outIdx === -1 ? undefined : args[outIdx + 1]
const username = args.filter((a, i) => i !== outIdx && i !== outIdx + 1)[0]?.trim().toLowerCase()

if (!username || !useStdin || (outIdx !== -1 && !outFile)) {
  console.error('usage: <password source> | node scripts/set-password.mjs <username> --stdin --out <file.sql>')
  console.error('')
  console.error('  --stdin reads the password from stdin instead of prompting. Use it with')
  console.error('  the shell\'s own hidden read, which keeps the value out of history:')
  console.error('')
  console.error('    read -rs PW && printf %s \"$PW\" | \\')
  console.error('      node scripts/set-password.mjs kakon --stdin --out /tmp/pw.sql && unset PW')
  console.error('')
  console.error('  --out writes the file ONLY on success. Prefer it over `> file.sql`:')
  console.error('  shell redirection creates an empty file before this script runs, so a')
  console.error('  failure leaves a 0-byte file that wrangler will happily execute as')
  console.error('  "0 queries" — looking like success while changing nothing.')
  process.exit(1)
}

/** Read stdin to end, stripping exactly one trailing newline if present. */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')))
    process.stdin.on('error', reject)
  })
}

// Stdin only.
//
// This script used to prompt interactively with the terminal in raw mode to
// hide typing. That code caused two separate production failures: first it
// recursed into itself and died silently, then — after being rewritten — it
// stored a hash that did not match what the operator had typed, so a correct
// password was rejected at login. Terminal input handling is fiddly and, in a
// script run once per account, essentially untestable.
//
// `read -rs` in the shell already hides input, keeps it out of history, and is
// code nobody has to maintain. Deleting the prompt removes the whole class of
// bug rather than patching it a third time.
const password = await readStdin()
if (!password) {
  console.error('✘ no password on stdin')
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
const sql = `UPDATE users SET password_hash = '${hash}' WHERE username = '${username.replace(/'/g, "''")}';\n`

if (outFile) {
  writeFileSync(outFile, sql, { mode: 0o600 })
  console.error(`✔ wrote ${outFile} (${sql.length} bytes) for user "${username}"`)
  console.error(`  apply with: npx wrangler d1 execute daybook --remote --file ${outFile}`)
  console.error(`  expect "1 row written" — "0 rows written" means it matched no user.`)
  console.error(`  then: rm ${outFile}`)
} else {
  process.stdout.write(sql)
  console.error(`✔ SQL written to stdout for user "${username}"`)
}
