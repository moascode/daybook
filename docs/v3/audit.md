# Where the PWA stands today

Measured 2026-09-07 against `main` and against the live deployment. Every claim
below is something checked, not assumed.

---

## 1. What already works

- `public/manifest.json` — `display: standalone`, `start_url: /`,
  `theme_color`, `background_color`. Served in production as
  `application/json`.
- `index.html` links the manifest, and sets
  `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style`.
- A service worker exists (`public/sw.js`) and is registered on load
  (`src/main.tsx:6-12`), with registration failure swallowed deliberately — the
  app works without it.
- **The app installs to the iOS home screen today** and runs full-screen with no
  Safari chrome. Nothing in P1–P5 is required to get that.
- Safe-area insets are already handled where it matters — the Wallet and import
  action bars use `env(safe-area-inset-bottom)`.

---

## 2. Defect: the offline fallback cannot ever work

`public/sw.js` catches a failed navigation and answers with `caches.match('/')`:

```js
if (event.request.mode === 'navigate') {
  event.respondWith(fetch(event.request).catch(() => caches.match('/')))
}
```

**Nothing in the file ever writes to that cache.** There are zero calls to
`caches.open`, `cache.add`, `cache.addAll` or `cache.put` — the `install`
handler only calls `skipWaiting()`. So `caches.match('/')` resolves to
`undefined`, `respondWith(undefined)` fails, and going offline produces a
browser error page rather than the graceful fallback the code appears to
implement.

The file's own comment claims *"Network-first for navigation, cache-first for
assets"*. The second half does not exist — the `fetch` handler ignores every
request whose `mode` is not `navigate`.

This is a **rule 13 failure**: the app degrades invisibly, and the code reads as
though someone had already handled it. Fixed in [P2](release-plan.md#p2).

---

## 3. Defect: iOS has no icon to use

`index.html` declares one icon:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

`manifest.json` lists the same SVG as its only entry. There is **no
`apple-touch-icon`, and no PNG anywhere in `public/`**.

iOS does not accept SVG for home screen icons. With no `apple-touch-icon` it
falls back to a screenshot of the page, so an installed Daybook shows a blurry
white rectangle instead of a mark. Fixed in [P1](release-plan.md#p1).

---

## 4. Inconsistency: two different theme colours

| Source | Value |
|---|---|
| `index.html:8` | `#10a37a` |
| `manifest.json` | `#1D9E75` |

`index.html` carries a pre-paint script that swaps `theme-color` by theme
(CLAUDE.md §18 rule 5), so the static value is only the starting point — but the
manifest's colour and the light-theme colour should be the same one, and the
brand green in CLAUDE.md §6 is `#1D9E75`. One of the two is wrong. Resolved in
[P1](release-plan.md#p1).

---

## 5. First load is one 1.25 MB chunk

`npm run build`, 2026-09-07:

```
dist/assets/index-*.css     121.54 kB │ gzip:  21.72 kB
dist/assets/index-*.js    1,251.02 kB │ gzip: 355.20 kB
```

One JavaScript chunk for the entire app — Wallet, Tasks, Trips, Day, Settings,
Recharts, PapaParse, the lot. There is no route-level splitting, and the build
says so itself:

```
(!) Some chunks are larger than 500 kB after minification.
```

377 kB gzipped before a single pixel renders. On a phone over mobile data —
which is exactly where an installed PWA gets opened — that is the difference
between "app" and "website". Addressed in [P3](release-plan.md#p3).

---

## 6. The white splash is fixable — but not the way it was tried

CLAUDE.md §18 rule 6 records a decision that `manifest.json`'s
`background_color` **stays `#ffffff`** and must not be "fixed" again. That
reasoning is correct and still stands: the manifest spec gives it a single
colour with no media-query form, and the OS caches the manifest at install time.

**But `background_color` is not the only mechanism.**
`<link rel="apple-touch-startup-image">` accepts a `media` attribute, and that
attribute accepts `prefers-color-scheme` — so iOS can be given a dark splash and
a light one and pick between them.

That does not contradict the §18 decision; it sits outside its scope. The rule
is about the manifest, and it should say so explicitly rather than reading as
"the white splash is unfixable". Proposed in [P5](release-plan.md#p5), which is
deliberately gated on owner sign-off because it touches a documented
"do not do this again".

---

## 7. Untested surface

There is no Playwright coverage of the manifest, the service worker, or the
installed-app presentation. Nothing in the 81 spec files asserts that the
manifest is served, that the SW registers, or that offline behaves. Each release
below adds the coverage for what it touches.
