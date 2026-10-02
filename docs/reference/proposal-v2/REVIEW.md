# Daybook redesign — review + v2

Reviewed `proposal/theme.css`, `dashboard.html`, `transactions.html`, `accounts.html`
rendered at 1440px and 390px, light and dark.

---

## What was already right

Worth keeping, because most redesigns get these wrong:

- **Shared stylesheet, not copy-pasted styles.** One `theme.css` linked by every page. Correct instinct.
- **Semantic token names** (`--fg-muted`, `--surface-sunken`) rather than `--gray-3`.
- **Space-separated RGB channels** so `rgb(var(--x) / .5)` works — the right way to do this.
- **Real mobile thinking**: off-canvas drawer, tables collapsing to cards via `data-label`. Most mockups just let tables overflow.
- **Genuinely good content ideas**: "Committed vs. discretionary", "Budget pace" with a where-you-should-be notch, "Week rhythm". These are insight-led, not chart-led — they answer a question instead of plotting a number. All of them survived into v2.

---

## What was holding it back

### 1. The brand ramp has a hue break in the middle of it

```
--c-brand-400: #4ADE83   hue 142°   (Tailwind green)
--c-brand-500: #1D9E75   hue 161°   (a teal spliced in)
--c-brand-600: #16A35E   hue 151°   (Tailwind green)
```

500 is not on the same ramp as its neighbours. The hero gradient runs 700 → 500 → 400,
so it crosses the seam and turns slightly muddy in the middle. Any surface that mixes
brand steps inherits it.

### 2. Contrast fails in places that carry meaning

| Pair | Ratio | Verdict |
|---|---|---|
| `--fg-faint` #9CA3AF on white — used for `.card-subtitle`, `.txn-sub`, `.week-day` | **2.54** | fails AA badly |
| `--fg-subtle` #6B7280 on white — used at 11.5px | 4.83 | passes, barely |
| White on `--c-brand-500` — the **primary button** | **3.39** | fails AA for 13px text |

The primary action in a money app should not be the least legible thing on the screen.

### 3. Half-pixel type and an ad-hoc spatial scale

Font sizes ran 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15… — 10 sizes in a 200-line
component sheet, several at half-pixels that land on a subpixel boundary and render soft.
Spacing used 9, 10, 13, 14, 16, 18, 26; radii used 8, 9, 10, 12, 14, 16, 20. None of that
is a system, so nothing lines up on a grid and every new component invents its own numbers.

### 4. No tabular numerals anywhere

Every column of money used proportional figures, so `$1,046` and `$3,194` don't align on the
decimal in the stat row, and neither do the table columns. This is the single most visible
"not a real finance product" tell.

### 5. Card soup — nine identical containers, no hierarchy

Every block had the same radius, border, shadow and padding, so the eye got no ranking.
The two loudest things on the page (green gradient hero, indigo gradient card) sat side by
side in unrelated hues and fought each other, while the actual answer to "am I OK this
month?" was a 40px number competing with three buttons inside the same box.

### 6. The chart was not honest

- `preserveAspectRatio="none"` stretched the SVG horizontally, so stroke widths distorted and the curve's slope was decorative rather than real.
- No axes at all — no dates, no dollar scale. An unlabelled rising line is a mood, not a measurement.
- The tooltip was pinned at `left:47%` while its data point sat at 60% — it pointed at nothing.
- "Week rhythm" was seven blue swatches with no values and no legend; you can see *that* Saturday is darker, not by how much.

### 7. Duplicated surfaces and mixed currencies

The dashboard carried a full transactions table *with its own search, filter and date-range
controls* — a complete second copy of the Transactions page, which means two places to
maintain and two places that can disagree. The hero also said "€340 ahead" on a page where
everything else was in dollars.

### 8. Dark mode inverted every ramp

`--c-brand-50` becoming the *darkest* green in dark mode works until one component wants
"a light green fill" in both themes and gets the opposite. It also means shadows do all the
elevation work — and shadows are nearly invisible on a dark canvas, so cards flattened out.

### 9. Accessibility was largely absent

Clickable elements were `div`s with `onclick` — not focusable, not keyboard-operable, no
role. There were no `:focus-visible` styles anywhere in the sheet, no `aria-label` on
icon-only buttons, no chart description. Nothing announces itself to a screen reader.

### 10. Mobile was a reflow, not a design

8,400px of scroll. One transaction became a five-line stacked card, so four transactions ate
four screens. The account card stayed a fixed 250px and floated alone. Primary actions sat at
the top of the page, out of thumb reach, with no bottom navigation and no FAB.

---

## What v2 changes

**System**

- One continuous emerald ramp, no hue break. A **two-layer token model**: raw ramps (primitives) → semantic roles (`--pos`, `--neg`, `--warn`, `--accent`, `--surface`). Components only ever touch semantics, so dark mode is a re-map of roles, not an inversion of ramps.
- Type scale: 11 / 12 / 13 / 14 / 16 / 20 / 26 / 34 / 44 — integers only. Space on a strict 4pt grid. Three radii.
- `font-variant-numeric: tabular-nums` on every money value.
- Elevation is **border-first**, shadow second — so cards keep their edges in dark mode.
- Every foreground/background pair now passes WCAG AA (verified programmatically; worst case 4.61:1, and `--fg-faint` at 3.78 is restricted to icons and decoration).

**Hierarchy**

- The gradient hero is gone. Net worth is now simply the largest number on the page on a plain surface, with a sparkline — quieter and more confident. The one remaining coloured surface is the featured account card, which earns it by being the thing you check most.
- The primary button is ink-black, not green. Green is reserved for "money moved in the right direction", so it always means one thing.
- Two-column layout with a right rail (account · bills · shared · merchants) so the columns balance and the page ends where the content ends.

**Honesty**

- The spend-pace chart has real axes (day 1–31, $0–$6k), correct aspect ratio, a "today" rule, and a tooltip anchored to its actual data point. The numbers agree with the drawing: $3,226 actual vs $2,688 usual = **$538 above pace**, projecting to $6,096. (The old copy said "$210 ahead" over a curve that showed something else.)
- Week rhythm is a real column chart with values and an average line.
- Every chart carries an `aria-label` describing what it says in words.

**Product**

- The dashboard's duplicated transactions table is now a compact five-row "Recent activity" with a link out. Filtering lives in exactly one place.
- Transactions gained visible, individually removable filter chips instead of a bare `Filters (2)` count, day-group headers with day net totals, and a range summary that reads off the filtered set.
- Accounts gained composition breakdown, per-account 30-day sparklines, credit utilisation, and a 12-month net-worth chart. The redundant "All accounts" table below the cards was dropped.

**Mobile**

- Bottom tab bar + FAB for "add transaction" — the two things you do on a phone are thumb-reachable.
- Transactions are two-line rows with the amount right-aligned, not five-line stacked cards.
- Same page is now ~2,400px instead of 8,400px.

**Accessibility**

- Real `<button>` / `<a>` elements, `aria-label` on every icon-only control, `aria-selected` on segmented controls, one consistent `:focus-visible` ring, `prefers-reduced-motion` honoured.

---

## Worth doing next

1. **Density toggle.** Comfortable / compact row heights — power users with 500 transactions a month will want compact.
2. **Empty, loading and error states.** `.skel` and `.empty` are in the sheet but no page demonstrates them. First-run with zero accounts is the most important screen you haven't designed.
3. **Command palette.** ⌘K is drawn in the topbar but does nothing. For a keyboard-driven app this is the cheapest big win.
4. **Category colour assignment.** Six semantic hues won't cover 30 categories — decide now whether colour is per-category (needs a generated palette) or per-*type* (income/committed/discretionary), because it changes the token model.
5. **Numbers formatting rules.** Decide on `−$84.20` vs `-$84.20` vs `($84.20)`, and whether cents are shown in summaries. v2 uses a true minus sign (−, U+2212) which aligns better in tabular figures.

---

# v3 — applying your feedback

## The structural change: Daybook is a shell, Wallet is a module

Your note that Daybook is a day ledger with Tasks *and* Wallet reframed the navigation. The
sidebar now has three tiers instead of one flat list:

1. **Daybook** — the product.
2. **Module switcher** — a control under the wordmark showing the current module (Wallet, "Money
   module") with a dropdown listing Tasks (`6 due`), Wallet (`$48,206`) and *Add a module*. Each
   module carries its own live summary, so switching is informed rather than blind.
3. **Module nav** — Overview / Transactions / Accounts / Shared, then Plan.

**Import CSV is out of the sidebar.** It was module-specific data plumbing sitting at the same
level as primary navigation. It now lives in two places that make sense: as an `Import CSV`
button on the Transactions page (where you'd actually be when importing), and as
*Import & export data* in the profile menu.

**Profile → settings, two levels.** Clicking the profile row at the bottom opens a menu with
Profile and Household, then a Settings block that separates **Preferences (All modules)** from
**Wallet settings (Module)** and **Tasks settings (Module)** — the exact split you asked for,
labelled so the scope is never ambiguous. Appearance and Sign out sit below.

**One global search.** The topbar field is now `Search Daybook…` with an *All modules* scope chip
you can narrow — it searches transactions, tasks, accounts, notes. You were right to flag the two
boxes: they were identical and read as a bug. The list-level one is now visibly a *different
control* — sunken fill, funnel icon, placeholder `Filter these 128 transactions…`, labelled for
screen readers as "Filter transactions in this list". Same page, two jobs, and now they look it.

## Overview

- **Net worth is back as its own card**, with `Add transaction` and `Settle up` (badged `2`) on it — as in the original. Import CSV is *not* there; it isn't a daily action.
- The Joint checking card keeps its treatment and gained a balance sparkline, an overflow menu, and "$7,232.30 safe to spend after $2,180 of bills" — the number you actually want from a checking account.
- **Order is now:** net worth + account → **Coming up | Budget pace** → **Spend pace | Week rhythm** → **Where it goes | Top merchants** → **Recent activity | Shared**. Commitments read together, then pace, then analysis, then detail.
- **Where it goes is a donut** with the month total in the centre and a direct-labelled legend carrying amount *and* share. Slices are sorted largest-first with "Everything else" last. Categories were split out (Rent & bills, Transport) so no single slice swallows the chart.
- **Top merchants gained the Month / Year toggle**, plus a one-line read of what the data means (most *frequent* vs most *expensive* merchant are different — that's the insight).
- Week rhythm now sits next to Spend pace at 1/3 width and states the daily average in words.

## Transactions

- **In / Out / Net are three separate cards again**, each with its own icon, matching the original's structure.
- **Day headers fixed.** The day total was floating unaligned; it now sits in a grid that shares the transaction row's column template, so `Day net −$90.60` lands exactly above the amount column. Weekday and date are split by weight (`**Today** · Sun 17 Aug`) so the scannable part is the bold part.
- Filter chips, quick sort, hover row actions and the label-under-merchant-name pattern are unchanged — you liked them.

## Accounts

Unchanged apart from inheriting the new shell.

## Still open

- **Tasks module screens.** The switcher implies them; they don't exist yet. Worth designing the Tasks Overview next, because it will test whether the shell really holds two different content shapes.
- **A unified "day" view.** The strongest idea in "day ledger" is a single timeline where a completed task and a coffee purchase sit on the same date. Neither module owns that screen — it's arguably the real home page of Daybook.
- **Cross-module search results.** The scope chip promises grouped results (Transactions / Tasks / Accounts); the results panel itself still needs designing.

---

# v4 — hero restored, Overview rebuilt on one grid

**The hero is back.** Same shape as the original — greeting line, `TOTAL NET WORTH` label, big figure,
delta chip, actions — but on the corrected emerald ramp (700 → 600 → 400), so there's no hue seam in
the middle of the gradient. `Add transaction` is now a solid white button rather than another glass
one, so the primary action is unmistakable; `Settle up` stays glass and carries its `2` badge.
Import CSV is still not here — it isn't a daily action. Money in / out / kept moved *into* the hero
as a strip below a hairline rule, which removes a whole row from the page.

**The spacing problem was structural, not cosmetic.** Every row was its own independent grid with a
`32px` section margin on top of a `16px` gap, so vertical rhythm changed depending on which row you
were between, and columns in different rows didn't line up with each other. The page is now a single
12-column grid (`.dash`) with one `20px` gap and `align-items: stretch` — so cards in the same row
are always exactly the same height, and every card edge in the page lands on the same column lines.

Layout:

```
A   hero (8)                    joint checking (4)
B   coming up (4)   budget pace (4)   shared (4)
C   spend pace (12)
D   where it goes (7)           week rhythm (5)
E   recent activity (8)         top merchants (4)
```

- **Spend pace is full width** at a 280px chart height — it was the most information-dense thing on the page and had the least room. It now gets the whole row, with the legend moved up beside the headline and a `today` label on the axis.
- **Week rhythm gets 5 columns instead of 4**, and the bars are bottom-anchored with `margin-top: auto`, so they sit on the card's baseline instead of floating in a cramped box.
- **Shared moved up into row B** with Coming up and Budget pace — three short list cards of matching height, which fills what used to be a ragged half-empty row.
- Cards that end in a summary line (`Total due`, `Net position`, `2 over pace`) push that line to the bottom with `margin-top: auto`, so the footers align across the row no matter how many items each card holds.

Breakpoints collapse 12 → 6 → 1 column at 1080px and 680px.

---

# v5 — Facebook-style app bar; module dropdown removed

You were right that a dropdown was the wrong control: modules are a fixed set the user can't add
to, and a dropdown implies otherwise. The whole shell changed to match the pattern you pointed at.

**The app bar now spans the full width, above the sidebar**, in three zones:

- **Left** — Daybook mark + a pill search field. Position matches the reference; it's still the one global search across all modules.
- **Centre** — the modules, as icon-only tabs: **Day**, **Tasks** (badged `6`), **Wallet**. Name appears as a tooltip on hover, and the active one gets a 3px accent underline flush to the bar's bottom edge. No dropdown, no "add a module" — the set is what it is, and the bar states it permanently instead of hiding it one click deep.
- **Right** — circular buttons: quick add, notifications (badged `3`), then the avatar with the small caret.

**The sidebar is now module-scoped only.** It opens with a "Wallet / Household ledger" header and
holds just that module's navigation. Which module you're in is answered by the bar; what's *inside*
it is answered by the sidebar. Those were previously the same control fighting itself.

**The account menu follows the reference structure**, and this is where the per-module settings
problem finally resolves cleanly:

- A raised card at the top: you (`moascode` / View your profile), then the ledgers you can switch between — **Household** (3 members, ticked as active) and **Personal** — then a full-width *See all ledgers* button. Same shape as the profiles list in your screenshot, but carrying something Daybook actually needs.
- Below it, the flat list with circular icon bubbles: **Settings & privacy** ›, **Help & support** ›, **Display & accessibility** ›, **Report a problem** (⌘B), **Log out**, and a small legal/version footer.
- **Settings & privacy pushes to a second pane** (with a back arrow, like the reference). That pane is split: global first — Preferences, Privacy & data, Household — then a `MODULE SETTINGS` group listing Wallet, Tasks and Day, each with a one-line description of what lives inside. Global vs per-module, one level deep, no extra nav item.

On mobile the module tabs collapse (the hamburger drawer takes over) and quick-add drops out of the
bar since the FAB already covers it, leaving logo · search · notifications · avatar.

---

# v6 — three fixes

**Actions moved to the page header.** `Settle up` and `Add transaction` sat inside the hero
competing with the figure for the same baseline, which is why it read as cramped. They're now in the
page header at top right, after the Month / Year toggle — `Add transaction` as the ink primary,
`Settle up` secondary with its `2` badge. That does two things: the hero becomes purely a statement
of position rather than a control panel, and the primary action now sits in the same place on every
page (Transactions already had it there).

With the buttons gone, the hero was re-laid-out as **two columns**: the greeting and net worth on the
left, and Money in / out / Kept stacked to the right of a hairline rule. It fills the hero's width
properly instead of leaving a dead right half, and it's one row shorter than the old bottom strip.

**Day totals lost their label.** `Day net −$90.60` is now just `−$90.60`, set in a soft overlay pill
(`surface-sunk`) sitting on the amount column — and it turns green on a positive day. No label to
read, so the eye lands on the number, which is the whole point of a day total. Weekday stays bold,
date stays muted.

**The search box no longer grows a box inside itself.** Two causes: the `All modules` scope chip
rendered as a second pill inside the field, and the input carried the global `:focus-visible` ring
*in addition* to the wrapper's focus style — so focusing drew a rounded rectangle inside a rounded
rectangle. The chip is gone (scope belongs in the results dropdown, not the resting state), and the
input's own ring is suppressed inside `.search` and `.filter-field` — the wrapper owns the focus
affordance.

In its place, focusing the field now animates: it grows from 268px to 420px, scales up ~2%, swaps to
a solid surface and lifts onto the `--e3` shadow, while the magnifier tints to the accent colour.
240ms on the shared easing curve. It reads as the field opening up to receive input rather than
something appearing inside it.

---

# v7 — proportions and a motion layer

**Where it goes / Week rhythm are 6 and 6.** The donut had a column it wasn't using and the bar chart
was squeezed into 5. Even halves gave the bars ~40% more width; the column gap went up to 12px, the
value and day labels up to 12px, and the corner radius grew a touch so the bars read as objects
rather than slivers.

**Transactions summary cards are three lines, not four.** The icon moved up onto the label's line as a
26px rounded bubble — `[icon] Money in` / `$6,420.00` / `3 deposits · +4.2% vs July` — and the padding
now matches the Accounts summary card at 20px, so the two pages' top rows have the same weight. Cards
align on their top edge rather than centring their content, so the three labels sit on one line
regardless of how long each footnote is.

**Motion is now a system, not a one-off.** Three durations on the one easing curve
(`cubic-bezier(.2,.7,.3,1)`), applied by intent rather than per component:

- **120ms** — colour and opacity: hovers on nav items, rows, chips, table rows, menu items.
- **200ms** — size, elevation, position: button lift on hover and press-down on active, circular bar buttons scaling to 1.06 / 0.94, module-tab icons rising 2px, menu bubbles growing, popovers popping in from their corner, the settings pane sliding across.
- **280ms** — things that grow: the search field, progress and budget bars animating to their value, the active module tab's underline wiping in from 20% width.

Charts respond to the pointer now too. Hovering a week-rhythm bar lifts it 3px, brings it to full
opacity and darkens its labels. Hovering a donut segment fades the other six to 50% and thickens the
hovered one from 22 to 27 — so the legend row and the slice highlight together. Transaction rows tilt
their category icon slightly, pull the amount 2px left, and slide the action buttons in from the right
instead of blinking on. The page content itself rises 6px on load.

All of it sits under the existing `prefers-reduced-motion` block, so it collapses to nothing for
anyone who's asked for that. Tell me where it's too much — the likely candidates are the row icon
tilt and the page-load rise.

**v7.1 —** the sparkline on the Overview's Joint checking card was decoration standing in for data
that card doesn't otherwise show, so it's gone. (The ones on the Accounts page stay — that grid is
explicitly labelled "Balance and 30-day trend", so there they carry the point of the section.)
Losing it took ~60px off the card, and the hero came down to match: padding tightened to 20/24, the
greeting dropped to 16px, and the gap above the figure closed by a step. The whole first row is
about 70px shorter and both cards still land on the same baseline.

---

# v8 — the rest of the Wallet

Two fixes first: **budget rows** now take the same hover wash as every other row, with the
where-you-should-be marker coming to full opacity on hover, and the **net-worth bars on Accounts**
respond to the pointer — hovering one drops the other eleven to 35% so a single month reads clearly.
Both were the only interactive surfaces still sitting outside the motion layer.

Five new pages, all on the same 12-column grid and the same components. The rule I followed: every
card either answers a question or proposes an action — no card exists just to display a number that
already appears elsewhere.

**Shared.** Balances read against a centre line, so who owes whom is a direction, not a minus sign.
The card that earns its place is **Settle up**: it computes the minimum set of transfers that clears
the whole household — three, here — instead of making everyone pay everyone. Below that, shared
activity shows total *and* your share on every row, since those are different numbers and people
confuse them. **Split rules** makes the automatic behaviour visible and flags that the income shares
are five months stale.

**Budgets.** One line at the top carries the whole month: 55% through the time, 81% through the
money, with the marker showing where you should be. **Suggestions** is the page's reason to exist —
move $60 from Transport (which has run at 45% for three months) to Dining out, raise Groceries to
what you actually spend, create the Sport budget you never made. Each is one click. Underneath, the
per-category table, then six months of budget-vs-actual and a ranking of where overspend actually
comes from — 86% of it is two categories.

**Goals.** Progress rings rather than bars, because a goal is a whole thing you're filling rather
than a rate. Each goal states its funding rate and its honest ETA, including the one that's **paused**
and the one that's **behind** and needs $520/mo but gets $300. The trajectory chart draws the target
as a line you can see yourself reaching, and Next milestones closes with the actual insight:
finishing Japan in October frees $140/mo, which is what puts the House deposit back on schedule.

**Recurring.** The month calendar is the centrepiece — every recurring charge on the day it lands,
colour-coded by kind, so clustering is visible (two charges on the 22nd, the day before payday
clears). **Worth a look** surfaces the three things this data is uniquely able to notice: Netflix
went up $3 without notice, Adobe hasn't been used since April at $59.99/mo, and those two charges
collide. The list carries annual cost next to monthly, because $59.99 and $719.88 feel very
different.

**Reports.** Four numbers, then income vs spending as paired columns where the gap *is* the savings
— with the sentence that matters underneath: income up 6.1%, spending up 11.4%, gap closes in about
26 months. **What changed** is a diverging bar chart against your own 12-month average rather than
against last month, which is noisier. Category trends give each category a 12-month sparkline beside
its average and its change, so a 168% jump in Clothes is visibly a spike rather than a trend.

All five work in dark mode and collapse to a single column on mobile.

---

# v9 — settle individually, and two cards on a diet

**Shared** now settles at three levels. Each person in Balances gets a **Settle** button that appears
on hover (always visible on touch), each of the three suggested transfers has its own **Settle**, and
**Mark all as settled** still clears the lot. The subtitle changed to say so: "Or settle them one at
a time".

**Budgets** and **Goals** summary cards were tall because they were half empty — the neighbouring
card was setting the row height and the primary card stretched to match. Fixed from both ends rather
than by shrinking one card and leaving a hole:

- *Budgets* — Suggestions became compact one-line rows with the action button on the right instead of
  underneath, which cut ~120px. The summary card gained a closing line that turns the projection into
  an instruction ("$34 a day instead of $46 brings it in exactly on budget"), the headline figure
  dropped a step to 26px since the bar is the real story, and the bar itself went 12px → 10px.
  Row height 356 → **333px**, and neither card has dead space now.
- *Goals* — the four colour tags became four two-column rows carrying saved *and* monthly rate
  (`Emergency fund · $12,400 · $400/mo`), which is the number you actually need when deciding where
  the next $200 goes. The "This month" card's footer note collapsed into the same compact
  action-row pattern. Row height 350 → **332px**.

Same trick is available anywhere else this shows up: fill the primary card with something useful
before shrinking it, and compact the secondary card's rows rather than deleting content.

---

# v10 — stop matching mismatched cards

v9 was wrong and the fix was the wrong shape. Padding a short card with filler to match a tall
neighbour just moves the empty space to the other card, which is what happened: Budgets ended up
with a full left card and a hollow Suggestions column. The problem was never the height of one card
— it was pairing two cards whose natural heights differ by 100px+ and forcing them level.

The rule now: **a summary belongs in a short full-width band, not in a half-width card with a
partner.** A `c12` card has nothing to match, so it can be exactly as tall as its content.

- **Budgets** — the month summary is a `c12` band: figure on the left, three stats to the right of a
  hairline, pace bar full width beneath. **216px**, no slack. Suggestions moved down beside the
  6-month chart, where its natural height genuinely matches (**375 / 375**), and gained a fourth item
  plus the overspend insight that used to live in a separate card — which is now deleted, since it
  and the chart said overlapping things.
- **Goals** — same band treatment, and "This month" folded into it as three stats. The four goal rows
  now sit across the full width instead of wrapping in a cramped two-column grid. Then the four goal
  cards (identical by construction), then chart and milestones at **403 / 403**.
- **Shared** — the per-person Settle button broke the card's right edge: it took a column the total
  row didn't have, so amounts stopped lining up with `+$53.00`. The footer is now the same grid as the
  rows, so the amount column runs straight down and Settle has its own lane. Buttons are always
  visible and quiet rather than appearing on hover — a settle action shouldn't be hidden. On mobile
  they drop out entirely, since the Settle up card directly below offers the same three actions with
  room to breathe.

---

# v11 — Tasks

The Settle buttons are out of Balances; settling lives only in the Settle up card, where the three
transfers each have their own button. Balances is back to three columns with the total aligned under
the amounts.

**The Tasks module** is now real: two pages sharing the Wallet's shell, tokens, motion and grid, with
its own sidebar (Today · Upcoming · All tasks · Assigned to me, then Lists, then Review) and its own
bottom tabs on mobile. The Tasks tab in the app bar is now live from every Wallet page.

**Today** opens with the same band pattern as the Wallet summaries: 3 of 9 done with a progress bar,
then overdue / assigned / finished-this-week, then a seven-day load strip that makes today's problem
visible — **Sunday is 9 tasks and Saturday is 1**. Quick add sits directly above the list and accepts
natural syntax (`pay rent tomorrow 9am #household !high`). The list groups Overdue / Today / Done
today, with the overdue header offering to reschedule both in one click and the done group collapsible.

Rows carry what you actually need to triage: list colour, subtask progress (`2 of 4`), recurrence,
assignee, and a due column that turns red when late and amber when it's tight. Priority shows as the
checkbox's border colour rather than another badge — the thing you click is the thing that's urgent.

The right rail is where the two modules meet. **Up next** mixes tasks with Wallet events ("Rent leaves
the account · tomorrow · from Wallet"). Task rows carry Wallet chips — `Wallet · $1,800 due tomorrow`,
`Saves $59.99/mo` on the cancelled Adobe seat, `Wallet goal · 88% funded` on planning the Japan trip.
That cross-referencing is the whole argument for one app instead of two.

**Worth knowing** is the Tasks equivalent of Budgets' Suggestions, and reads off your own history:
mornings finish 78% of the time and evenings 41% (three of today's six are evening); "Book the dentist"
has moved four times, and tasks moved 3+ times rarely get done; Sunday is nine and Saturday is one.
Each offers the fix rather than just the observation.

**All tasks** mirrors the Transactions page — four stat cards, a filter field distinct from global
search, removable filter chips, date-grouped rows including a *No due date* group of 18 with a
"Schedule these" action. Below, twelve weeks of completions and an age breakdown that says the
uncomfortable thing out loud: **14 open tasks are older than three months**, and all but two are
parked in Someday.

Still to design: Upcoming (a week/agenda view), the Lists board, Habits, and the cross-module **Day**
timeline — which is now the only tab in the bar without a home.

---

# v12 — Tasks, complete

Seven pages now, all wired into the sidebar and the mobile tabs.

**Upcoming** is a seven-column week board — the one place in either module where the layout is a
canvas rather than a list, because planning is spatial. Cards carry a list-coloured left edge, day
headers count their load, and the empty days show a dashed *Add*. The point of the view is visible
without reading anything: Wednesday has 7 and Saturday has 1. Below it, the 18 tasks **waiting for a
date** with per-row Schedule, and a *Balance the week* card proposing two specific moves that bring
Wednesday to 5 and Saturday to 2.

**Assigned to me** treats delegation as a two-way ledger. Waiting-on-you groups by who asked; the
rail shows what you handed out, flagging two that have **gone quiet** — both assigned without a date,
which is the actual cause. The band carries turnaround times per person (Jordan 1.1 days, Priya 3.8),
which is the sort of thing a household ledger can know and a task app usually can't.

**Household** is the template for any list view: progress, recurring count, Wallet linkage and members
in the band; tasks grouped into Bills & admin / Chores / Done this week; and a rail with the list's
settings, its activity feed, and a 90-day split of who actually completes things (you 41, Jordan 36,
Priya 23).

**Completed** opens with a year-long heatmap, one square per day. Then recent completions grouped by
day, a breakdown of what you finish by list, and **time to finish** — which lands the uncomfortable
finding: Work takes 0.8 days, Someday takes 94. Someday is a graveyard, not a backlog.

**Habits** gives each habit a completion ring, a 28-day dot grid (green kept, red missed, grey
not-due), a current streak and a personal best. The weekday chart shows Friday is the only day under
70%, and the note explains why: Friday is the second-heaviest task day, so habits are being squeezed
out rather than forgotten. "No spend day" is the Wallet-linked habit sitting at 48% against a target
of three a week.

Everything left is outside Tasks: the **Day** timeline that merges both modules, and the Wallet's
own Reports/Budgets overlap I flagged earlier.

---

# v13 — the composer

The primary action was a button in the top-right corner competing with a segmented control. It is
now the first thing on the page and the largest interactive element on it: a **composer**, sitting
directly under the page title and above everything else.

Shape follows the reference you pointed at — avatar, a full-width rounded field, and a row of typed
shortcuts beneath a hairline:

- **Wallet** — `Add a transaction — try "coffee 4.20 cash"`, then Expense · Income · Transfer · Split · Import CSV.
- **Tasks** — `Add a task — try "pay rent tomorrow 9am #household !high"`, then Task · Reminder · Habit · Assign · Checklist.

The placeholder teaches the natural-language syntax rather than describing the field, which is the
one trick that makes a single input beat a form. Each shortcut icon carries its semantic colour —
Expense red, Income green, Transfer blue — so the row is scannable before you read it.

Focusing it uses the same language as the app-bar search: the pill lifts to a solid surface, scales
~1%, gains a shadow, and the whole card takes an accent ring. Pressing **N** anywhere on the page
jumps into it. The send button is the ink circle at the right, so the commit action is unmistakable.

Because the composer *is* the primary action, the duplicate `Add transaction` / `Add task` buttons
came out of the page headers — the header now carries only scope controls (Month/Year, Week/Fortnight)
and secondary actions. It appears on all twelve working pages of both modules and is deliberately
absent from the three read-only ones — Reports, Completed, Habits — where there is nothing to add.

On mobile the shortcut row scrolls horizontally, the field drops to 44px, and the ⌘-hint hides; the
FAB still covers quick-add from anywhere in the page.

---

# v14 — Day

The third tab finally has a home. The question it had to answer first was *why it exists*,
because Tasks/Today and Wallet/Overview already cover "what must I do" and "how's the month
going". Day is neither. **Day is the only page in Daybook addressed by a date rather than by
"now"** — and that single property is what the whole design hangs off.

## The four decisions

**1. One spine, both modules.** A vertical timeline with a time gutter, where a completed task,
a coffee purchase, a transfer and a note are all just entries at a time. Tasks put a `.tcheck`
on the spine; money puts a coloured dot. That's the entire visual grammar, and it's the argument
for one app instead of two: 09:41 Whole Foods −$86.40 and 09:48 "Log the Whole Foods receipt"
sit seven minutes apart, and the task carries a chip saying it matched the purchase.

**2. Solid means it happened, hollow means it's planned.** One rule, applied to every dot and
every checkbox, split by a `now` rule across the page at 14:32. Above it the page is a *record*;
below it, a *plan*. Amounts below are set in subtle rather than ink so a scheduled −$18.99 never
reads as money already gone. This also makes past dates and future dates coherent for free: a
day in the archive is entirely solid, a day next week is entirely hollow, and only today is both.

**3. Two figures, deliberately equal.** The band opens with `3 of 9` and `−$138.90` at the same
type size, separated by a hairline. Neither module gets to be the headline — the moment one is
bigger, Day becomes a skin over the other one. To their right: money in, moved to savings, still
to happen.

**4. The hour ribbon.** A 06:00–24:00 track under the band with one mark per entry, coloured by
kind and hollow if it hasn't happened. It states the *shape* of the day before you read a word:
everything clusters 07:00–14:00, then nothing until three tasks and two charges after 18:00.
No other page in Daybook has a device for "when in the day", because no other page is a day.

## Day's own action: Close the day

Every module needed a reason to be opened daily. Wallet's is checking a balance, Tasks' is
ticking things off. Day's is **closing it** — a card that turns the loose ends into three
one-click decisions (6 tasks won't get done → move them; Shell $48.30 needs a category →
accept Transport, as with the last six; write a line about today), then one ink button.
That's the ritual that makes Day the landing tab rather than a read-only summary.

## The rest of the page

- **Composer** takes both syntaxes — `coffee 4.20 cash` *or* `call the plumber 3pm` — with
  Expense · Task · Note · Habit · Transfer beneath. It is the only input in the product that
  writes to either module depending on what you type, which is the second argument for Day
  being where you land.
- **Notes** are first-class timeline entries in a sunken block with a left rule. Without them
  "day ledger" is just a merged feed; with them it's a journal you can search.
- **Against your usual Sunday** is the insight only a day-grained store can produce: 9 tasks vs
  a usual 4, $139 spent by 14:30 vs a usual $62, 3 finished vs a usual 5 — each as a pair of
  bars, yours over the average.
- **On this day** shows the same date a year back, and lands the point: the boiler has come up
  in your notes four times in twelve months.
- **The August grid** at the bottom makes Day the app's history — dots for what happened, the
  day's net underneath, click any square. Past days are solid, future days muted.

Layout on the same 12-column grid: band (12) → timeline (8) + rail (4) → month (12). The rail
is a `stack`, so it ends where its content ends rather than stretching to match a timeline that
is naturally twice its height — the v10 rule, applied by not pairing them in the first place.

## Sidebar

Today · This week · Calendar · Notes, then a **Show on the timeline** group of four toggles
(Tasks & habits / Money / Scheduled & bills / Notes) — Day is a merge, so what it merges has to
be a visible control, not a settings page. Then Review: Weekly review, On this day.

## New in theme.css

`.datenav`, `.dayfigs`/`.dayfig`, `.ribbon`, `.tlist`/`.tl` and its parts, `.tl-note`,
`.tl-now`, `.cmp`. Two follow-up fixes worth noting: timeline rows carrying both an amount and
hover actions were wrapping onto a second grid line, so amount and actions now have named
columns and the action lane is reserved; and the two day figures stack with a top rule instead
of a dangling left border below 680px.

## Still open

- **This week / Calendar / Weekly review** — the three sidebar items Day promises and doesn't
  yet draw. Weekly review is the interesting one: it's Close the day at a week's scale.
- **A past day and a future day** as their own mockups, to prove the solid/hollow rule holds at
  the extremes.
- **Cross-module search results** — still unbuilt, and Day's entry row is now the obvious
  component for rendering a mixed result list.

---

# v15 — Trips

The brainstorm in `travel-module-plan.md` left one question unanswered and called it the
biggest architectural fork: is a trip a fourth module, or a lens over the three that exist?
It's a fourth module. Everything below follows from that choice and from one property of a
trip that nothing else in Daybook has.

## The property the module is built on

Day is addressed by a date. Tasks is addressed by what must happen. Wallet is addressed by
money. **A trip is the only object in Daybook that ends.**

A budget renews on the 1st. A goal is open-ended. A habit recurs forever. A trip has nine days
and then it is over, which changes what every familiar component has to say:

- A budget bar becomes a **burn-down**. Not "you're 68% through the month" but "$1,151.53 is
  what's left and there is no more coming."
- "Are you on track" stops being an extrapolation. Days 4–9 already have an itinerary with
  costs on it, so the honest answer is *addition*, not forecasting: **what you have written
  down for the rest of the trip costs $1,550.76 and you have $1,151.53.** Every travel app
  guesses at this. Daybook can just add it up, because it owns both the plan and the ledger.
- Every unticked prep task has a real deadline, because the flight is a real deadline.

That sentence — "your own plan costs $399.23 more than you have left" — is the single most
valuable thing in the module and no competitor in section 2 of the plan can produce it.

## Why a fourth tab, and what it costs

The lens option was cheaper and wrong. Phases 1 and 4 of the workflow — a wishlist of places
you haven't committed to, and bookings — are neither tasks nor transactions. They have nowhere
to live in Tasks or Wallet, and inventing a home for them there is worse than giving them one.

The cost is honest: the bar is now four tabs, and for most of the year one of them is a list of
things that aren't happening. Two decisions soften it. The tab carries a live count only when
something is actually in flight. And the module's landing page is **not** the active trip — it
is `trips.html`, which opens with *travel as a category of your life*: $7,848 this year, 11.2%
of everything you've spent, 21 days away. Even with no trip booked, that page has something to
say.

## Trips owns almost nothing

The rule that keeps the fourth tab from becoming a silo: **every record visible in Trips also
lives in its home module, and Trips owns only what has no home elsewhere** — the trip itself,
the wishlist, and bookings. Packing lists are Tasks subtrees seeded from `task_templates`.
Trip spend is Wallet transactions with a nullable `trip_id`. Splitting with Jordan is the
Phase 5b groups/shares/settlements feature, unmodified.

`trip-prep.html` states this out loud in the rail — 48 tasks, 42 transactions, 9 bookings —
and lands the consequence: *delete the trip and none of it disappears. The tasks stay in your
lists, the money stays in your ledger, and only the thread between them is cut.* That is
`ON DELETE SET NULL` written as a promise rather than a migration.

## The five cross-module rules

**1. One chip, both directions.** `.tchip` — a small plane glyph in the trip's colour — appears
on any row in any module carrying a `trip_id`. It is the entire visible surface Trips adds to
Tasks, Wallet and Day, and it's already live on `day.html` (the transfer that funds the trip)
and `goals.html` (the goal that funds it). Click it, you're in the trip.

**2. Trip mode.** When today falls inside an active trip, the app changes state rather than
asking you to navigate. `day-trip.html` is Day on 17 September: a `.tripband` under the page
title, the composer pre-scoped with a removable `.scope-pill`, and amounts defaulting to yen.
This is what "worry-free vacation" actually means — **on holiday you should not have to tag
anything.** The band is visible and reversible, never silent; there is a Turn off button and
the scope pill has an ×.

**3. Trip mode changes what you add, not what you can see.** The boiler task is still on the
timeline on day 3 in Tokyo, without a trip chip, because it is still yours. The rail card
*Home, while you're away* is the payoff phase 5 was reaching for: rent leaves on the 25th and
is funded, Priya has the plants, nothing is overdue for the first time in eleven weeks.

**4. Estimate and actual are the v14 rule on a second axis.** Solid meant *happened* and
hollow meant *planned*, split by a `now` rule. In the itinerary the same grammar now reads
**hollow = an estimate, solid = a settled amount**, and the row carries both figures with the
delta between them. No new visual language was invented; one was extended from time to money.

**5. Trips has no colour of its own.** Day is neutral, Tasks and Wallet share the emerald.
Each *trip* carries a hue through a `--trip` custom property, and every component reads it
without naming it — so Tokyo is violet, Bali is teal, and no component changed. Four palettes
(`.t-violet`, `.t-teal`, `.t-amber`, `.t-blue`) are the only place a trip hue is written down,
and each has a dark-mode lift so a violet trip is AA on both canvases.

## Multi-currency

The plan flagged MYR-only as the one place travel pushes against an existing decision. It does,
and converting at entry and keeping the original as a note is not enough — on a nine-day trip
the original *is* the number you think in.

Every trip amount is a pair. **Local leads inside Trips, home leads in Wallet**, whose job is
your ledger and not your holiday. Never two currencies in one column. The rate is captured per
transaction and shown, never back-filled: the rate card lists what you budgeted at (¥152), what
you're averaging (¥147.2), the best you got (airport ATM) and the worst (hotel desk). It then
does the thing an honest app does — separates **$34.37 of the overrun that the exchange rate
caused from the part you chose.** A `¥ · $` segment in the page head flips which line leads
everywhere at once.

## The pages

**trips.html** — travel as a category, then the active trip as a full-width band rather than
one card in a grid (you are *inside* it, not choosing it), then upcoming/past/idea as peer
cards, then the findings only a ledger can produce: your food estimates miss by 34% and 61%
while transport and attractions land within 6%; shopping has never once appeared in a plan;
two thirds of a trip is spent before it starts, which is why August looked expensive and
September won't.

**trip.html** — the burn-down, the estimate/actual reconciliation for today, and four figures
that separate the overrun into its causes: $412.41 over on the two finished days, $381.79 of it
one afternoon, $34.37 of it the exchange rate, $399.23 needed to finish the plan.

**trip-itinerary.html** — the differentiator page. Day 2 settled with deltas, day 3 straddling
the `now` rule, day 4 all estimates, days 5–9 collapsed. Two callouts do real work: *two
entries had no estimate at all and are 64% of Tuesday*, and *$122.28 of Thursday is one
dinner — ¥9,000 instead of ¥18,000 closes 15% of the gap.*

**trip-prep.html** — readiness as one figure made of four lists, one of which isn't due yet.
The meter is phase-aware: before departure it's prep, mid-trip it's what today needs, on day 8
it becomes going home.

**day-trip.html** — Day in trip mode, which is where the whole argument lands.

## New in theme.css

`.tchip`, `.fx` (the dual-currency pair), `.hero-trip`, `.countdown`, `.burn`, `.daystrip`/
`.dsday`, `.itin`/`.ir` and its estimate/actual/delta parts, `.ready`, `.tripband`,
`.scope-pill`, `.trip`/`.trip-cover`/`.trip-figs`, `.wish`, `.book`, `.pack`/`.pitem`, and the
four trip palettes. Two fixes worth noting: `.trip` needed `position: relative` or its state
chip escaped to the viewport, and the burn-down uses `vector-effect: non-scaling-stroke` so a
stretched `preserveAspectRatio="none"` chart keeps honest 1.75px strokes.

The fourth tab and the Trips module-settings entry are wired into all sixteen existing pages,
so the nav decision is real rather than asserted.

## A note on dates

The Trips pages are set on **Wednesday 17 September** — day 3 of the trip — while the Wallet,
Tasks and Day pages remain on Sunday 17 August. Mid-trip is the module's most demanding state:
it is the only moment where settled amounts, estimates, a `now` rule and a countdown all have
to coexist on one page. `day.html` and `goals.html` show the same trip four weeks out, which is
where their chips come from.

## Still open

- **The recap.** A finished trip needs its own page, and `trips.html` currently promises one
  for Ho Chi Minh City that doesn't exist. It's Close-the-day at a trip's scale and should
  answer "what would you budget differently next time" with numbers.
- **Bali, i.e. the planning state.** Every Trips mockup here is mid-trip. The 86-days-out state
  is a different page: no actuals, no burn-down, and readiness dominating.
- **The map.** Deliberately deferred — it needs geocoding and tiles Daybook doesn't have, and
  it is the one competitor feature that isn't a differentiator.
- **Trip templates.** "Same again, new dates" is obvious and unbuilt.
- **What the fourth tab does in January**, when nothing is booked and the wishlist is all there
  is. The index page has an answer; it hasn't been drawn as an empty state.
