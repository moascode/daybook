# Trips — design adoption (R6)

R6's job is to make the fourth tab true without building the module. It ships
the route, the sidebar, the mobile tab, and **`trips.html`'s first-run state**.

Blocking: **D-4**.

---

## What ships

**`/trips`** rendering the landing page's top half, computed entirely from data
that already exists — no `trips` table needed for this part:

> **Travel as a category of your life.** RM7,848 this year · 11.2% of everything
> you spent · 21 days away.

Derived from transactions in travel-ish categories. It is real, it is
interesting, and it answers `REVIEW.md`'s own last open question — *what the
fourth tab does in January, when nothing is booked and the wishlist is all there
is.*

Below it, the designed empty state for the three sections that need the schema:
**Active trip** (none), **Upcoming / Past / Ideas** (none), with a single
`Plan a trip` action that is disabled-with-a-reason until R12.

**Sidebar and mobile tab** per [../foundation/03-app-shell.md](../foundation/03-app-shell.md).

**The tab badge is absent**, not zero. A `0` on a tab is noise; the design's own
rule is that the count appears only when something is in flight.

---

## What explicitly does not ship in R6

The burn-down, the itinerary, prep, bookings, wishlist, trip mode and
multi-currency. R6 is the honest-empty-state release, and saying so in the UI is
better than a half-built trip page.

---

## Done when

- `/trips` is a live route in the bar, sidebar and mobile tabs.
- The travel-as-a-category figures are real and match what Reports would say.
- Both themes, 1440 / 768 / 390.
- A spec asserting the empty state renders and the disabled action states why.

Together with `/day`'s equivalent, this completes **v3.0**: the design is
adopted across the product.
