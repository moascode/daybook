---
name: intake
description: File a feature request, report a bug, or brainstorm an idea into Daybook's backlog at docs/backlog/. Use whenever the user wants to add, capture, log, file, note down or track a new feature, enhancement, bug, defect, regression, idea or "thing we should do later" — including phrasings like "I want to add X", "X is broken", "we should eventually", "remind me to build", "let's think about X", or /intake. Also use when reviewing the backlog, promoting an item into a release, or deciding whether an epic is still worth doing.
---

# Intake

Daybook's backlog lives at `docs/backlog/`. This skill is how things get into
it, and how they get reviewed once they're there.

**Three things are mandatory for every item:** its own file, its row in
`docs/backlog/README.md`, and an **epic**. An item file with no index row is
invisible; an index row with no file is a dead link; an item with no epic never
gets the "is this still needed?" question asked of it. `npm run check:backlog`
gates all three, so a half-filed item fails the build rather than quietly rotting.

**There are no standalone items.** If nothing fits, create an epic first — a
two-item epic is fine, and it gives the work somewhere to be reviewed. When you
create one, say in its file what decision it is waiting on, or that it is
waiting on none.

---

## The three modes

### `feature` — something to build

**Ask before writing.** A one-line feature request produces a one-line item
nobody can act on in three months. Ask up to four questions, and stop as soon as
you can answer these yourself:

1. **What can the user do afterwards that they can't now?** (the actual outcome)
2. **Which module?** Wallet · Tasks · Trips · Day · cross-cutting
3. **What triggers the need?** A real situation they hit, not a hypothetical
4. **What's explicitly out of scope?** The single most useful line in any item file

Then: **pick the epic first** (or create one), allocate an ID, write
`items/FEAT-NNN-slug.md`, and add the index row under that epic's section.

If the request is clearly bigger than one PR, it *is* an epic —
`epics/EP-NN-slug.md` — with its items underneath it.

### `bug` — something that's broken

**Check for a duplicate first.** Search `docs/backlog/` and `CLAUDE.md` §8's
open-risks list before filing. Daybook already tracks several known defects
there, and re-filing one buries the original's history.

Capture, in this order:

1. **What happened** vs **what should have happened** — both, always
2. **Steps to reproduce**, numbered, starting from a clean state
3. **Where you think it lives** — file path if known, "unknown" if not. Never guess a cause and write it as fact
4. **Money, data loss, or cosmetic?** Daybook is a money app; a wrong figure outranks a wrong margin

Then write `items/BUG-NNN-slug.md` and add the index row.

**If the bug is trivial and you can see the fix, still file it**, then offer to
fix it on a branch. The file is the record; fixing it immediately doesn't make
the record unnecessary.

### `brainstorm` — thinking out loud

**Write nothing at first.** This mode is a conversation, not a form. Explore the
idea properly: what problem it actually solves, what it would displace, what
the cheap version looks like, why it might be a bad idea.

Only when the user says to keep it — "save that", "file it", "keep this" — do
you write `items/IDEA-NNN-slug.md`, capturing the *reasoning*, not just the
conclusion. An idea file whose "why not" section is empty was filed too early.

An `IDEA` graduates to a `FEAT` when the user commits to it. Keep the original
ID in the new file's header so the thinking stays traceable.

---

## Mechanics

```bash
node scripts/backlog.mjs next FEAT     # → the next unused ID
node scripts/backlog.mjs check         # → index and files agree
```

**Never pick an ID by eye.** The script scans every ID ever used, including ones
whose files have moved to `docs/archive/`, so a shipped `FEAT-012` can't be
reissued to something unrelated.

### Item template

```markdown
> **Status:** Open · **Filed:** YYYY-MM-DD · **Epic:** [EP-NN](../epics/EP-NN-slug.md)

# FEAT-NNN — Short title

**What.** One paragraph: what the user can do afterwards that they can't now.

**Why now.** The real situation that triggered this.

**Out of scope.** What this deliberately does not include.

**Still needed?** The honest answer, kept current. This is the field the owner
reads when reviewing — "Yes", "Question it — <why>", or "Consider dropping — <why>".
```

The **Epic** field must contain a real `EP-NN` link. The check rejects `—`.

Bugs swap `What` / `Why now` for **Expected** / **Actual** / **Repro**.

### Index row

Add to the right table in `docs/backlog/README.md`:

```markdown
| [FEAT-051](items/FEAT-051-slug.md) | Feature | Short title | Yes — one clause on why |
```

---

## Reviewing the backlog

When asked to review — "is this still needed?", "what's in the backlog?", "do we
still want the business module?" — the useful answer is rarely a list.

**For an epic, answer two questions separately:**

1. **Is the epic still worth doing?** Products change. An epic written against
   an architecture that no longer exists, or for a module that got redesigned,
   may be obsolete as a whole.
2. **Is every item under it still needed?** An epic can survive while half its
   items die. Mark dead ones `Dropped` **with the reason in the file** — a
   dropped item whose reason was never written down gets re-proposed forever.

**Before saying an item is still needed, check whether it already shipped.**
Several of Daybook's proposal documents sat for months describing work that was
already live. Verify against the code — a route in `worker/routes/`, a component
in `src/`, a migration — not against another document.

---

## Rules

1. **An item is not a spec.** When one grows past roughly a page, it graduates:
   the spec goes to `docs/roadmap/`, the item shrinks to a link, status becomes
   `Scheduled`.
2. **Never file into `CLAUDE.md`.** It points at the backlog; it doesn't carry it.
3. **Never delete an item.** Mark it `Dropped` and keep the reason.
4. **Filing is not scheduling.** Adding something to the backlog is not a
   commitment to build it, and shouldn't be described to the user as one.
