# Day — module plan

**Shell: R6 (`v3.0.0`). Completion: R15–R16 (`v3.9`–`v3.10`).**

Day is last to be built and first in the app bar, which is deliberate: it is a
**merge** of the other modules, so it can only be as good as they are.

| Doc | What it covers |
|---|---|
| [01-data-model.md](01-data-model.md) | time of day, notes, and the interim |
| [02-design-adoption.md](02-design-adoption.md) | R6 — the route and the honest first timeline |
| [03-feature-waves.md](03-feature-waves.md) | R15–R16 — the real page and the ritual |

---

## Why it exists

The question Day had to answer first is *why it exists*, because Tasks/Today and
Wallet/Overview already cover "what must I do" and "how is the month going".

**Day is the only page in Daybook addressed by a date rather than by "now"** —
and the entire design hangs off that one property.

## The four decisions

**1. One spine, both modules.** A vertical timeline with a time gutter, where a
completed task, a coffee purchase, a transfer and a note are all just entries at
a time. Tasks put a checkbox on the spine; money puts a coloured dot. That is
the whole visual grammar, and it is the argument for one app instead of two:
09:41 Whole Foods −RM86.40 and 09:48 "log the Whole Foods receipt" sit seven
minutes apart, and the task carries a chip saying it matched the purchase.

**2. Solid means it happened, hollow means it is planned.** One rule, applied to
every dot and every checkbox, split by a `now` rule across the page. Above it
the page is a **record**; below it, a **plan**. Amounts below are set in subtle
rather than ink, so a scheduled −RM18.99 never reads as money already gone.

This makes past and future dates coherent for free: a day in the archive is
entirely solid, a day next week is entirely hollow, and only today is both.

**3. Two figures, deliberately equal.** The band opens with `3 of 9` and
`−RM138.90` at the same type size, separated by a hairline. **Neither module gets
to be the headline** — the moment one is bigger, Day becomes a skin over the
other one.

**4. The hour ribbon.** A 06:00–24:00 track under the band with one mark per
entry, coloured by kind and hollow if it has not happened. It states the *shape*
of the day before you read a word. No other page in Daybook has a device for
"when in the day", because no other page is a day.

---

## Day's own action: Close the day

Every module needs a reason to be opened daily. Wallet's is checking a balance,
Tasks' is ticking things off. Day's is **closing it** — a card that turns the
loose ends into three one-click decisions:

1. six tasks will not get done → move them
2. a RM48.30 charge needs a category → accept Transport, as with the last six
3. write a line about today

then one ink button. That ritual is what makes Day the landing tab rather than a
read-only summary, and it is why R16 matters more than its size suggests.

---

## Hard dependencies

- **Time of day on a transaction** does not exist (D-6). R6 works around it
  honestly; R15 fixes it.
- **Notes** do not exist as an entity. Without them "day ledger" is just a merged
  feed; with them it is a journal you can search.
- The **usual-comparison** and **on this day** cards need history, so they are
  worth more later than earlier — another reason Day is last.
