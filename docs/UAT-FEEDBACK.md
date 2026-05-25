# UAT Feedback Log

All user-reported bugs and feedback captured during alpha testing, with status and fix details.

---

## Session 1 — Alpha Release Feedback (2026-05-25)

### BUG-001 — Tasks editor blinks on every keystroke  
**Severity:** High  
**Status:** ✅ Fixed  

**Symptom:** Typing into a task causes the entire line to blink/flicker. The cursor sometimes jumps or the text flickers on every character.

**Root cause:** `handleInput` called `onUpdate` on every keystroke, which triggered a DB write → Zustand update → React re-render → `useLayoutEffect` syncing `textContent` back to the DOM — even though the content was unchanged. The DOM mutation caused visible flicker.

**Fix (BulletEditor.tsx):**
- Introduced a `localContent` ref that tracks the current content without triggering re-renders.
- Debounced the `onUpdate` (DB write) call by 400 ms after the last keystroke.
- The DOM is only synced from the store when the editor is **not focused**. While the user is typing, the browser manages the contenteditable state natively — React never touches it.
- On `blur`, the debounce is immediately flushed so no content is lost.
- Before special keys (Enter, Tab, Backspace), `flushUpdate()` is called to ensure content is saved before the action.

---

### BUG-002 — No visible way to complete a task  
**Severity:** High  
**Status:** ✅ Fixed  

**Symptom:** The only way to mark a task complete was `Cmd+Enter` — there was no visible checkbox or button. New users had no way to discover how to complete tasks.

**Fix (BulletNode.tsx):**
- Added a visible checkbox button on every task row, between the collapse toggle and the bullet dot.
- Checkbox turns **brand-green** (filled + checkmark) when completed, and shows a hover state on uncompleted tasks.
- Also added "Mark complete / Mark incomplete" to the `⋯` dropdown options menu.

---

### BUG-003 — Drag-and-drop not discoverable  
**Severity:** Medium  
**Status:** ✅ Improved  

**Symptom:** The drag handle (grip icon) was opacity-0 by default, only appearing on hover. Users didn't know DnD was available or how to use it.

**Notes:** The grip handle shows on `group-hover` — this is correct UX for dense list views (matches Notion, Linear, Workflowy). No code change to visibility, but:
- The drag handle now has a `title="Drag to reorder"` tooltip for discoverability.
- DnD works within the same parent level. Cross-level moves are handled via Tab/Shift+Tab indent/outdent.

---

### BUG-004 — Wallet navigation is scattered  
**Severity:** High  
**Status:** ✅ Fixed  

**Symptom:** The sidebar had 3 separate entries for "Transactions", "Accounts", and "Dashboard" — all under Wallet. This looked like three unrelated modules and was confusing.

**Fix:**
- **Sidebar.tsx** — Consolidated to a single "Wallet" sidebar entry. The nav item stays highlighted for all `/wallet/*` paths (`end={false}`).
- **WalletTabNav.tsx** — New shared tab bar component added at the top of every wallet page: Transactions · Accounts · Dashboard · Import CSV.
- All four wallet pages (WalletPage, AccountsPage, Dashboard, CsvImport) now show a consistent "Wallet" heading + tab strip at the top.

---

### IMPROVEMENT-001 — No README  
**Severity:** Low  
**Status:** ✅ Fixed  

Added `README.md` at the project root with: overview, features list, tech stack, setup instructions, project structure, and roadmap.

---

### IMPROVEMENT-002 — No user guide  
**Severity:** Medium  
**Status:** 🔄 Tracked  

A full user guide with screenshots and feature walkthroughs is planned. See `docs/USER-GUIDE.md` (to be created in Phase 5 when the AI features are added and the UX is stable enough to document).

---

## Known Limitations (Alpha)

| Item | Note |
|---|---|
| DnD cross-level | Dragging a task to become a child of another task is not supported — use Tab to indent instead |
| Browser storage | IndexedDB can be cleared by the browser — no data export yet (planned Phase 5) |
| No auth | Single user only, no password protection (Phase 4) |
| Safari quota | Safari is more aggressive about IndexedDB eviction than Chrome |
| Large CSV | CSV imports with thousands of rows may be slow in Safari |

---

## Tester Sign-off

| Feature | Test date | Result | Notes |
|---|---|---|---|
| Add task | 2026-05-25 | ✅ Pass | — |
| Complete task (checkbox) | 2026-05-25 | ✅ Pass | — |
| Complete task (keyboard) | 2026-05-25 | ✅ Pass | Cmd+Enter |
| Indent / outdent | 2026-05-25 | ✅ Pass | Tab / Shift+Tab |
| Backspace delete | 2026-05-25 | ✅ Pass | On empty line |
| Zoom in / breadcrumb | 2026-05-25 | ✅ Pass | — |
| Hide completed | 2026-05-25 | ✅ Pass | — |
| Drag to reorder | 2026-05-25 | ✅ Pass | Same-level only |
| Add note | 2026-05-25 | ✅ Pass | Via ⋯ menu |
| Add account | 2026-05-25 | ✅ Pass | — |
| Edit account | 2026-05-25 | ✅ Pass | — |
| Delete account | 2026-05-25 | ✅ Pass | Cascades transactions |
| Add transaction | 2026-05-25 | ✅ Pass | — |
| Edit transaction | 2026-05-25 | ✅ Pass | — |
| Delete transaction | 2026-05-25 | ✅ Pass | — |
| Transfer transaction | 2026-05-25 | ✅ Pass | — |
| Filter transactions | 2026-05-25 | ✅ Pass | Date/type/account/category/tag |
| CSV import | 2026-05-25 | ✅ Pass | — |
| Duplicate detection | 2026-05-25 | ✅ Pass | SHA-256 hash |
| Dashboard charts | 2026-05-25 | ✅ Pass | — |
| Wallet tab navigation | 2026-05-25 | ✅ Pass | After fix |
