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
const outIdx = args.indexOf('--out')
const outFile = outIdx === -1 ? undefined : args[outIdx + 1]
const username = args.filter((a, i) => i !== outIdx && i !== outIdx + 1)[0]?.trim().toLowerCase()

if (!username || (outIdx !== -1 && !outFile)) {
  console.error('usage: node scripts/set-password.mjs <username> --out <file.sql>')
  console.error('')
  console.error('  --out writes the file ONLY on success. Prefer it over `> file.sql`:')
  console.error('  shell redirection creates an empty file before this script runs, so a')
  console.error('  failure leaves a 0-byte file that wrangler will happily execute as')
  console.error('  "0 queries" — looking like success while changing nothing.')
  process.exit(1)
}

/**
 * Prompt on stderr with the input hidden, so stdout stays a clean SQL stream.
 *
 * Uses raw mode rather than readline. An earlier version passed
 * `output: process.stderr` to readline and then reassigned `rl.output.write` to
 * suppress echo — but `rl.output` IS `process.stderr`, so that replaced
 * stderr's own writer with a function that called `process.stderr.write`,
 * recursing into itself. It blew the stack on the first character AND broke the
 * stream the crash would have been reported on, so the script died silently and
 * produced an empty file.
 *
 * Raw mode does not echo, which is the property we actually want, without
 * monkey-patching a global stream.
 */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin

    if (!stdin.isTTY) {
      reject(new Error('no TTY available — run this in an interactive terminal'))
      return
    }

    process.stderr.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let buf = ''
    const done = (fn, arg) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stderr.write('\n')
      fn(arg)
    }

    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(resolve, buf)
        if (ch === '\u0003') {
          // Ctrl-C: leave the terminal usable before exiting.
          stdin.setRawMode(false)
          process.stderr.write('\n')
          process.exit(130)
        }
        if (ch === '\u0004') return done(resolve, buf) // Ctrl-D
        if (ch === '\u007f' || ch === '\b') {
          buf = buf.slice(0, -1)
          continue
        }
        // Ignore other control characters (arrow keys arrive as escape sequences).
        if (ch >= ' ') buf += ch
      }
    }

    stdin.on('data', onData)
  })
}

let password, confirm
try {
  password = await promptHidden(`New password for "${username}": `)
  confirm = await promptHidden('Confirm: ')
} catch (err) {
  console.error(`✘ ${err.message}`)
  process.exit(1)
}

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
