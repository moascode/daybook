# Regenerating the iOS launch images

`public/splash/` holds 16 PNGs — a light and a dark launch screen for each of
eight iPhone sizes. They are referenced by `<link rel="apple-touch-startup-image">`
in `index.html` (v3 P5).

## Why they exist at all

`manifest.json`'s `background_color` takes one colour, has no media-query form,
and the OS caches it at install time — so it cannot follow the theme, and
CLAUDE.md §18 rule 6 correctly says not to try. `apple-touch-startup-image` is a
separate mechanism whose `media` attribute *does* accept `prefers-color-scheme`,
which is how the dark-theme white flash is actually fixed.

**A device matching no tag simply gets no splash and falls back to
`background_color`.** Adding sizes is additive; it can never break a phone that
isn't listed.

## The recipe

Each image is a flat theme background with the Daybook mark centred at 26% of
the short edge. Same path as the app icon, so they cannot drift apart.

| Theme | Background | Mark |
|---|---|---|
| light | `#ffffff` | `#10a37a` |
| dark | `#0d1117` | `#4fc79b` |

Sizes, as CSS points × device-pixel-ratio (the `media` attribute matches on
points, the PNG must be the pixel size):

| CSS | DPR | Pixels | Slug |
|---|---|---|---|
| 375×667 | 2 | 750×1334 | `iphone-se` |
| 375×812 | 3 | 1125×2436 | `iphone-x` |
| 390×844 | 3 | 1170×2532 | `iphone-13` |
| 393×852 | 3 | 1179×2556 | `iphone-15` |
| 402×874 | 3 | 1206×2622 | `iphone-16-pro` |
| 428×926 | 3 | 1284×2778 | `iphone-14-plus` |
| 430×932 | 3 | 1290×2796 | `iphone-15-pro-max` |
| 440×956 | 3 | 1320×2868 | `iphone-16-pro-max` |

## Adding a device

1. Add its CSS size, DPR and a slug to the table above.
2. Render the SVG below at the pixel size, once per theme, and save as
   `public/splash/splash-<slug>-<theme>.png`.
3. Add the two `<link>` tags to `index.html`, matching the existing pattern.
4. `e2e/81-pwa-install.spec.ts` will fail if a size has only one theme, or if
   any referenced file 404s.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <rect width="{W}" height="{H}" fill="{BG}"/>
  <g transform="translate({(W-S)/2} {(H-S)/2}) scale({S/512})">
    <path fill="{MARK}" fill-rule="evenodd" d="M156 128h96c70.7 0 128 57.3 128 128s-57.3 128-128 128h-96a22 22 0 0 1-22-22V150a22 22 0 0 1 22-22Zm54 68v120h42a60 60 0 0 0 0-120h-42Z"/>
    <rect x="134" y="404" width="140" height="20" rx="10" fill="{MARK}" opacity=".45"/>
    <rect x="134" y="88" width="90" height="20" rx="10" fill="{MARK}" opacity=".45"/>
  </g>
</svg>
```

where `S = round(min(W, H) * 0.26)`.

## A note on weight

The set is ~1.1 MB in the repo. That is the honest cost of covering eight
devices at 3× density, and it buys a cosmetic fix — P5 is ranked last in the
track for exactly that reason. At runtime a phone fetches **one** of them, only
at launch, so the cost is repository and deploy size rather than anything a user
waits for. `public/splash/` is deliberately outside the service worker's asset
cache pattern.
