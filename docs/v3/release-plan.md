# v3 release plan — P1 to P5

Five releases. Each is independently shippable and leaves the app in a state you
can use. Ordered by value per unit of effort, except P5 which is blocked.

Read with [audit.md](audit.md), which is the evidence every item here rests on.

**No tag column, deliberately** — see [README.md](README.md#why-there-is-no-tag-column).

```
P1 install quality ──┐
P2 offline honesty ──┼── independent, any order
P3 first load ───────┘
P4 push  ← wants P2 merged first (both touch sw.js)
P5 splash  ← blocked on sign-off
```

---

## P1 · Install quality {#p1}

**Goal.** An installed Daybook looks and behaves like an app on the home screen
and in the hand.

**Ships**

1. **`apple-touch-icon`** — a 180×180 PNG in `public/`, plus the `<link>` in
   `index.html`. Without it iOS uses a screenshot of the page (audit §3).
2. **PNG icons in the manifest** at 192 and 512, `purpose: "any maskable"`. The
   current SVG-only entry is unusable by iOS and marginal on Android.
3. **One theme colour.** Reconcile `index.html:8` (`#10a37a`) with
   `manifest.json` (`#1D9E75`) against CLAUDE.md §6's brand green, and make the
   pre-paint script's light value the same constant (audit §4).
4. **Stop iOS zooming on input focus** — any `input`/`select`/`textarea` under
   16px triggers an involuntary viewport zoom on tap. Audit the form primitives
   and raise the mobile font-size where needed.
5. **`viewport-fit=cover`** plus safe-area padding on the app shell, not just
   the two action bars that already handle it.
6. **Tap polish** — `-webkit-tap-highlight-color`, `-webkit-touch-callout` off
   on controls (not on text), `overscroll-behavior` on scroll containers.

**Done when** the icon on the home screen is the Daybook mark; tapping any
amount or date field does not zoom the page; and a spec asserts the manifest and
the touch icon are served with the right content types.

**Risk.** Low. Items 4–6 are CSS on shared primitives, so the existing suite is
the safety net — run it, don't just eyeball.

---

## P2 · Offline honesty {#p2}

**Goal.** The service worker does what its own comment already claims, and when
the app genuinely cannot work, it says so.

**Ships**

1. **Precache the shell on install** so the navigation fallback has something to
   fall back to. Today it resolves `undefined` and the page just fails
   (audit §2).
2. **Cache-first for hashed assets.** Vite emits content-hashed filenames, so
   they are safe to cache indefinitely — a new build produces new names. This is
   the half the comment promises and the code omits.
3. **An honest offline state.** A banner when the app is offline, and a real
   message on any write attempted without a connection. Rule 13: right now a
   failed navigation and a broken app render identically.
4. **A cache version bump path** so a stale shell can never outlive a deploy.

**Done when** aeroplane mode shows the app shell with an offline banner rather
than a browser error; a write while offline reports why it failed; and a
Playwright spec covers both with an intercepted-network run.

**Risk.** Medium — a service worker that caches too eagerly can serve a stale
app after a deploy, which on a money app means stale balances. Keep API
responses **out** of the cache entirely: shell and assets only, never `/api/*`.

---

## P3 · First load {#p3}

**Goal.** Open the app on mobile data without waiting for 355 kB of gzipped
JavaScript that has nothing to do with the page being opened.

**Ships**

1. **Route-level `React.lazy`** in `src/router.tsx` — Wallet, Tasks, Trips, Day
   and Settings become separate chunks.
2. **Split the heavy libraries out of the entry chunk** — Recharts (dashboard
   and reports only) and PapaParse (CSV import only) should not be in the
   payload of someone opening `/tasks`.
3. **A loading state for a lazily-loaded route** that matches the app's existing
   loading treatment, not a bare spinner.

**Done when** the entry chunk is meaningfully under the current 1,251 kB, no
route regresses, and the full suite is green — this touches every route's mount,
so the suite is the acceptance criterion, not a size number alone.

**Risk.** Medium. Lazy boundaries change mount timing, which is exactly the kind
of thing 81 specs full of `waitFor` will find. Expect to fix a handful.

---

## P4 · Push notifications {#p4}

**Goal.** Daybook can tell you something happened without you opening it.

Web Push works on iOS 16.4+ **for a PWA installed to the home screen** — so P1's
install quality is worth having first, and the feature must degrade silently to
nothing on a browser that has not granted permission.

**Ships**

1. **Subscription storage** — a `push_subscriptions` table (user_id, endpoint,
   keys, created_at, last_seen_at), additive migration in both trees.
2. **VAPID signing in the Worker.** Check Web Crypto covers ES256 before
   proposing a dependency (CLAUDE.md §4 — ask first).
3. **A `push` handler in `sw.js`** plus `notificationclick` that opens the right
   route.
4. **A permission prompt that is asked for, never sprung** — a Settings toggle,
   not a prompt on page load.
5. **The first three notifications**, all of which already have their data:
   - **captures waiting** — the inbox count
   - **the silence alert** — "no capture received in N days", currently a line
     you have to remember to go and look at
   - **a split claim raised against you** — `PendingClaimsBadge` already knows

**Done when** a subscription survives a reload, a notification opens the right
page, revoking permission stops delivery cleanly, and no notification is ever
sent to a user who did not opt in.

**Risk.** Medium-high, and the highest in this folder. Push is easy to get
wrong in ways that are invisible in development: an expired subscription that is
never cleaned up, a notification sent to the wrong user, a permission prompt
that fires on load and gets permanently denied. Treat a 410 from the push
service as "delete this subscription", not as an error to log.

---

## P5 · Themed splash screens {#p5}

> ⛔ **Blocked: needs owner sign-off before any work starts.**

**Goal.** Launching the installed app on the dark theme stops flashing a white
screen.

**Why this is gated.** CLAUDE.md §18 rule 6 explicitly says the white splash
cannot follow the theme and must not be "fixed" again. **That decision is
correct about what it actually covers** — `manifest.json`'s `background_color`
takes one colour, has no media-query form, and is cached by the OS at install.

`<link rel="apple-touch-startup-image">` is a different mechanism and accepts a
`media` attribute, including `prefers-color-scheme`. So the outcome §18 rules
out *is* reachable, by a route §18 was not written about.

**The ask:** confirm you want this, and I will update §18 to state its own scope
precisely — so the next person reads "the manifest colour cannot follow the
theme" rather than "the splash cannot".

**Ships (if approved)**

1. Light and dark startup images at the iPhone sizes that matter, generated by a
   script from the existing mark rather than hand-exported.
2. `<link rel="apple-touch-startup-image">` tags with `media` on both
   dimensions and colour scheme.
3. A §18 amendment recording the distinction and why the original rule stands
   for the manifest.

**Risk.** Low technically, but it is a documented reversal — the value is
cosmetic and the cost is a rule that has to stay accurate afterwards. Worth
saying plainly: this is the least valuable item here, and it is last for that
reason.

---

## Estimating

Relative, in the same idiom as `docs/v2/release-plan.md` — you set the calendar.

| Release | Size | Dominated by |
|---|---|---|
| P1 | S | icon generation and auditing form primitives for the 16px rule |
| P2 | M | getting caching correct without ever serving a stale ledger |
| P3 | M | fixing the specs that lazy mounting will disturb |
| P4 | L | VAPID, subscription lifecycle, and not spamming anyone |
| P5 | S | image generation; blocked on a decision, not on effort |
