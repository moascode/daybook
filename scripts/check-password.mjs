#!/usr/bin/env node
// Check whether a password matches the hash stored in D1 for a user, using the
// EXACT verification logic worker/crypto.ts uses.
//
//   read -rs PW && printf %s "$PW" | node scripts/check-password.mjs kakon --stdin
//   node scripts/check-password.mjs kakon --stdin --local
//
// Why this exists: "the stored hash looks right but login fails" has two very
// different causes — the hash does not match the password you think you set, or
// the hash is fine and something in the login path is broken. Guessing between
// them wastes time. This answers it directly, and the password never leaves your
// machine: only the derived comparison result is printed.
//
// Reads the hash via `wrangler d1 execute`, so it needs no app credentials.

import { execFileSync } from 'node:child_process'
import { webcrypto as crypto } from 'node:crypto'

const args = process.argv.slice(2)
const username = args.find((a) => !a.startsWith('--'))
const local = args.includes('--local')

if (!username || !args.includes('--stdin')) {
  console.error('usage: printf %s "$PW" | node scripts/check-password.mjs <username> --stdin [--local]')
  process.exit(1)
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')))
    process.stdin.on('error', reject)
  })
}

const password = await readStdin()
if (!password) {
  console.error('✘ no password on stdin')
  process.exit(1)
}

const raw = execFileSync(
  'npx',
  [
    'wrangler', 'd1', 'execute', 'daybook',
    local ? '--local' : '--remote',
    '--json',
    '--command',
    `SELECT password_hash FROM users WHERE username = '${username.replace(/'/g, "''")}'`,
  ],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
)
const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results
if (rows.length === 0) {
  console.error(`✘ no user named "${username}"`)
  process.exit(1)
}
const stored = rows[0].password_hash

// ── verbatim port of worker/crypto.ts verifyPassword ──
const parts = stored.split('$')
if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
  console.log(`✘ stored hash is NOT pbkdf2 (starts "${stored.slice(0, 7)}")`)
  console.log('  → the password was never set on this backend; the Worker rejects every login.')
  process.exit(2)
}
const iterations = Number(parts[1])
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))
const salt = fromB64(parts[2])
const expected = fromB64(parts[3])

const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
)
const bits = new Uint8Array(
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  ),
)

let diff = bits.length === expected.length ? 0 : 1
for (let i = 0; i < Math.min(bits.length, expected.length); i++) diff |= bits[i] ^ expected[i]

console.log(`user        : ${username}`)
console.log(`stored hash : pbkdf2, ${iterations.toLocaleString()} iterations`)
console.log(`password    : ${diff === 0 ? '✔ MATCHES the stored hash' : '✘ does NOT match the stored hash'}`)
console.log('')
console.log(
  diff === 0
    ? '→ The hash is correct, so login should work. If it does not, the problem is\n' +
      '  in the login request itself, not the stored password.'
    : '→ Whatever was captured when the password was set differs from what you just\n' +
      '  typed. Re-set it with:  ... | node scripts/set-password.mjs ' + username + ' --stdin --out /tmp/pw.sql',
)
process.exit(diff === 0 ? 0 : 3)
