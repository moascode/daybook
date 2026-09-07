# Turning push notifications on

Push (v3 P4) is **inert until two secrets exist**. Without them
`/api/notifications/config` reports `enabled: false`, the Settings section
hides itself, and the scheduled digest returns immediately. A deploy without
them is degraded, never broken — which is why this shipped before the secrets
were set.

## One-time setup

The VAPID private key must never be committed, and I cannot set it for you:
`wrangler secret put` needs Cloudflare credentials that only you and CI hold.

Generate a keypair and set both secrets — this pipes the private key straight
from generation into Wrangler, so it is never written to disk or shown:

```bash
node -e "
const { webcrypto: c } = require('crypto');
(async () => {
  const b64 = b => Buffer.from(b).toString('base64url');
  const kp = await c.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
  const pub = b64(await c.subtle.exportKey('raw', kp.publicKey));
  const priv = b64(await c.subtle.exportKey('pkcs8', kp.privateKey));
  console.log(JSON.stringify({ pub, priv }));
})();
" > /tmp/vapid.json

node -e "process.stdout.write(require('/tmp/vapid.json').priv)" | npx wrangler secret put VAPID_PRIVATE_KEY
node -e "process.stdout.write(require('/tmp/vapid.json').pub)"  | npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_SUBJECT   # paste: mailto:you@example.com

rm /tmp/vapid.json
```

Then redeploy (any tag, or `npm run deploy:worker`) and the Settings section
appears.

**Rotating the keypair unsubscribes everyone.** A subscription is bound to the
public key it was created with, so every browser has to turn notifications on
again. Only rotate if the private key leaks.

## What arrives, and when

Two Cron Triggers in `wrangler.toml`, in UTC — `08:10` and `21:10`
Asia/Kuala_Lumpur:

| Slot | Cron | Sends |
|---|---|---|
| Morning | `10 0 * * *` | capture silence · splits raised against you · captures waiting · a budget at ≥90% · tasks due or overdue |
| Evening | `10 13 * * *` | what you spent today |

**At most one push per user per slot per day**, enforced by `push_sent_log`'s
primary key rather than by the scheduler behaving — a cron that fires twice
cannot notify twice. **Nothing to say means nothing sent**: a digest that
arrives every morning regardless is one you learn to swipe away, and that costs
the alerts that matter.

## Why the pushes carry no payload

An encrypted payload means implementing RFC 8291 by hand — ECDH, HKDF,
aes128gcm — because `web-push` is Node-only and does not run on Workers. A
payload-less push needs one ECDSA signature, which Web Crypto does natively, so
**no dependency was added.**

The service worker fetches the text from `/api/notifications/pending` when the
push arrives. It costs one round trip and buys something worth having: the
numbers are computed at *display* time, so a count can never be stale by the
time you read it.

## On iOS

Web Push works on iOS 16.4+ **only for a PWA installed to the home screen**.
Safari in a tab reports `PushManager` as missing, and the Settings section says
so rather than offering a button that cannot work.

Permission is requested on the button press, never on page load. A prompt
sprung on arrival is the fastest route to a permanent "Denied", and iOS does not
ask again after that.
