# Daybook v3 — the PWA quality track

Daybook already installs to the iPhone home screen and runs full-screen. This
folder plans the work that makes it feel like an app people chose rather than a
website they bookmarked — and fixes the two things that are quietly broken.

**Scope:** five releases, `P1`–`P5`. Small, independent, none of them touching
money math, the ledger, or the API's existing contracts.

| Doc | What it covers |
|---|---|
| [audit.md](audit.md) | Measured current state — what's live, what's missing, what's defective, with evidence |
| [release-plan.md](release-plan.md) | `P1`–`P5`: what each ships and when it's done |
| [splash-generation.md](splash-generation.md) | How the iOS launch images are made, and how to add a device |
| [push-setup.md](push-setup.md) | The one-time VAPID secret setup, and what arrives when |

---

## Why `P`, not `R`

`docs/v2/` numbers its releases `R1`–`R18`, and CLAUDE.md §13 already records a
session that shipped an unrelated "R4" and confused the status board for weeks.
This track uses a **different letter on purpose** so the two can never be
mistaken for each other in a commit message or a PR title.

## Why there is no Tag column

Because every previous roadmap's tag column became fiction. `docs/v2/`'s still
assigns `v3.2.0` to R8, a tag that was cut against entirely different work
months ago, and CLAUDE.md §13 has had to warn about this drift four separate
times.

**Tags are assigned when a release is cut, from `git tag`, and nowhere else:**

```
git for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:short)' refs/tags
```

The status board below tracks *state*, not version numbers it cannot know.

---

## Status board

Update the row when a release merges.

| Release | Scope | Status |
|---|---|---|
| P1 | Install quality — touch icon, manifest, iOS input/feel details | ✅ merged |
| P2 | Offline honesty — make the service worker actually work, and say so when it can't | ✅ merged |
| P3 | First load — code-split the 1.25 MB single bundle | ✅ merged — entry 1,251 kB → 390 kB (355 → 125 kB gz) |
| P4 | Push notifications — six digests, two daily slots | ✅ merged — **needs [two secrets set](push-setup.md)** before it does anything |
| P5 | Themed splash screens | ✅ merged — see [splash-generation.md](splash-generation.md) |

---

## Out of scope, permanently

Listed so no future session proposes them as "quick wins". **These are not
possible in a PWA on iOS at any effort level** — each needs a native app, which
is a separate decision recorded below.

| Capability | Why not |
|---|---|
| A Shortcuts action shipped by the app (App Intents) | Native-only. The Apple Wallet automation stays hand-built. |
| Home screen widgets | WidgetKit is native-only. |
| Face ID app lock | No web API gates app launch behind biometrics. |
| Retrying a failed capture | Safari implements no Background Sync — and the capture never reaches the PWA anyway, since Shortcuts makes that HTTP call itself. |

**Siri is NOT on this list.** Any Shortcut can be run by name — *"Hey Siri, log
expense"* works today with no native code. What native App Intents would add is
*parsing* ("log twenty ringgit lunch" understood in one breath) rather than Siri
prompting field by field. Worth knowing before anyone cites Siri as a reason to
go native.

## The native-app decision, and how to settle it

A native companion app (App Intents + offline capture queue + widget + Face ID)
was scoped at roughly 3–5 sessions plus **$99/year** for the Apple Developer
Program. It was **deferred, not rejected**, on 2026-09-07.

It should be decided by measurement, not preference. After R18's capture has run
for **three to four weeks**, two numbers answer it:

1. **How often does a capture silently fail?** Every payment made without signal
   is lost with no notification — that is the one recurring cost a PWA cannot
   fix. Twice a month is survivable; twice a week is not.
2. **Does the Apple trigger fire reliably at all?** If it doesn't, a native
   wrapper around an unreliable signal buys nothing.

Until those numbers exist, everything in this folder is the cheaper path to most
of the same value.

---

## Ground rules

1. **Rule 12 still applies.** Branch, PR, no direct commits to `main`.
2. **Rule 11 still applies.** Anything with observable behaviour ships its
   Playwright spec. Service-worker and manifest behaviour is testable — see each
   release's "Done when".
3. **Rule 13 above all.** Two of these releases exist *because* the app
   currently fails silently. Do not add a third.
4. **No new dependency without asking.** Push needs VAPID signing; check whether
   Web Crypto covers it before proposing a library (CLAUDE.md §4).
