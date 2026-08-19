# Day — feature waves (R15–R16)

---

## R15 · `v3.9.0` — real time, notes, the ribbon, the composer

**Schema**: `transactions.occurred_at`, `notes`
([01-data-model.md](01-data-model.md)).

### Real time of day

The composer and `TransactionForm` set `occurred_at`; the timeline shows clock
times on money rows for the first time. CSV imports stay null and group under an
honest `no time recorded` heading rather than being scattered at midnight.

This is what unlocks the page's founding example: 09:41 Whole Foods −RM86.40 and
09:48 "log the Whole Foods receipt" seven minutes apart, with a chip on the task
saying it matched the purchase.

### Notes

First-class timeline entries in a sunken block with a left rule. Without them
"day ledger" is a merged feed; with them it is a journal you can search.

### The hour ribbon

A 06:00–24:00 track under the band, one mark per entry, coloured by kind, hollow
if it has not happened. It states the shape of the day before you read a word —
everything clusters 07:00–14:00, then nothing until three tasks and two charges
after 18:00.

Now that `occurred_at` exists, the ribbon is truthful. Building it in R6 would
have drawn import times.

### The Day composer

**The only input in the product that writes to either module depending on what
you type**: `coffee 4.20 cash` *or* `call the plumber 3pm`. Shortcuts: Expense ·
Task · Note · Habit · Transfer.

That dual-target behaviour is the second argument for Day being where you land,
and it is the composer's hardest parsing case (D-11). Ship it after the Wallet
and Tasks composers, not before — it is their union.

### Past and future days

The design's own open item, and cheap once the grammar exists: prove the
solid/hollow rule at the extremes. A day in the archive is entirely solid; a day
next week is entirely hollow; only today is both. Two specs.

---

## R16 · `v3.10.0` — the ritual and the history

### Close the day

The reason to open Day daily. Loose ends become **three one-click decisions**,
then one ink button:

1. *six tasks will not get done* → move them
2. *RM48.30 at Shell needs a category* → accept Transport, **as with the last
   six** — the suggestion carries its own evidence
3. *write a line about today* → a note

Idempotent, via `day_closures`. Closing a day is not destructive and must be
re-openable.

### Against your usual

The insight only a day-grained store can produce: 9 tasks vs a usual 4, RM139
spent by 14:30 vs a usual RM62, 3 finished vs a usual 5 — each as a **pair of
bars, yours over the average**. "Usual" means the same weekday over a trailing
window; state the window in the card rather than hiding it.

### On this day

The same date a year back, and the point it lands: the boiler has come up in
your notes four times in twelve months. Needs `notes` (R15) and a year of them,
so it will be thin at first — say so rather than showing an empty card.

### The month grid

Day is also the app's **history**: dots for what happened, the day's net
underneath, click any square. Past days solid, future days muted. Closed days
marked. This is what makes Day the way you get to any other day, which is the
thing a date-addressed page needs most.

### This week · Calendar · Weekly review

The three sidebar destinations Day has promised since it was drawn.

**Weekly review is the interesting one: it is Close the day at a week's scale.**
Same shape — loose ends turned into decisions — over seven days instead of one.
Design it before building it; there is no mockup.

---

## Layout note

The page is band (12) → timeline (8) + rail (4) → month (12). **The rail is a
`stack`**, so it ends where its content ends rather than stretching to match a
timeline that is naturally twice its height — the v10 rule applied by not
pairing them in the first place.

Two fixes already found in the design and worth not rediscovering: timeline rows
carrying both an amount and hover actions were wrapping onto a second grid line,
so **amount and actions need named columns with the action lane reserved**; and
the two day figures **stack with a top rule** instead of a dangling left border
below 680px.
