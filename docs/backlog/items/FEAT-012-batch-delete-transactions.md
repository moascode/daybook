> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-03](../epics/EP-03-consistency-remainder.md)

# FEAT-012 — Batch `DELETE /transactions` endpoint

**What.** One endpoint that deletes many transactions, replacing N sequential
single deletes from the multi-select path.

**Why now.** Bulk delete currently issues one request per row. On a large
selection that is slow and, worse, non-atomic — a failure halfway leaves a
partial delete the user did not ask for.

**Out of scope.** Undo for bulk delete. Wallet's multi-select deliberately uses
`ConfirmDeleteModal` rather than an undo toast (CLAUDE.md coding conventions).

**Notes.** Verified 2026-09-16: only `DELETE /transactions/:id` exists.
