> **Status:** Archived · **Last verified:** 2026-09-16

# Phase definitions and delivery milestones

The original phase roadmap (Phase 0 through 7) and what each delivery milestone meant.
Superseded by `docs/roadmap/`, kept because release notes and older docs refer to phases by number.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 14. Phase Definitions & Delivery Milestones

The roadmap is structured around real deliverables, not arbitrary versions. Each delivery milestone is a usable, stable product — not a work-in-progress.

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3
                                        ↓
                                   ★ ALPHA
                                   Core app on your machine

Phase 4  →  ★ v1.0  Home network, multi-user
Phase 5  →  Phase 5b (5c subtask)
             ★ v1.0+ Household sharing, wallet UX polish
Phase 6  →  ★ v2    Cloud-hosted, anywhere access
Phase 7  →  ★ v3+   Advanced features, ongoing
```

### Phases

| Phase | Name | Type | Goal | Status |
|---|---|---|---|---|
| 0 | Foundation Setup | **Your actions** | Accounts, tools, repo cloned | ✅ Done |
| 1 | Core Scaffold | Dev | Vite + layout shell + UI primitives | ✅ v1.0 |
| 2 | Tasks Module | Dev | Full Workflowy-style bullet tree | ✅ v1.0 |
| 3 | Wallet Module | Dev | Accounts + transactions + CSV + dashboard | ✅ v1.0 |
| 4 | Home Network + Multi-User | Architecture | Node backend, SQLite file, auth, per-user data | ✅ v1.0 |
| 5a | AI Features | AI | Claude integration, NL input, briefing, insights | 🟢 Four features ship ([`feature-specs.md` §AI](../reference/feature-specs.md)); panel/briefing/insights still deferred |
| 5b | Household Sharing | Feature | Groups, shared accounts, transaction splits, settlement | ✅ v1.0.1 |
| 5c | Wallet UX Improvements | UX/Features | Free-text search, accessibility, mobile fixes, polish | ✅ v1.0.1 |
| 6 | Cloud Migration | Cloud | Cloudflare Workers + D1 + PBKDF2 auth (**not** Supabase/Vercel — see `docs/archive/option-2-workers-d1-plan.md`) | ✅ v2 |
| 7 | Advanced Features | v2+ | Recurring rules, budgets, goals, new modules | Planned |

**Note**: Phase 5 has been split into three subtasks:
- **Phase 5a (AI)** — no longer wholly deferred. Owner approved one slice on
  2026-08-08 (PR #112, AI fallback for bulk categorisation), which brought the
  API-key infrastructure [`feature-specs.md` §AI](../reference/feature-specs.md) always assumed: per-user `anthropic_api_key` in
  `settings`, a Settings UI, masked reads, per-user rate limiting, and the first
  outbound Worker call (`worker/lib/anthropic.ts`). A second slice landed in
  R4 (docs/archive/flow-plan.md): AI-assisted merchant name resolution for CSV
  import and bulk cleanup, reusing that same foundation — a new
  `merchant_corrections` cache table, its own rate-limit bucket, and
  `resolveMerchantsWithAI` alongside the existing `suggestCategoriesWithAI`.
  Two more followed on the same foundation: the **composer's free-text parse**
  (`parseComposerWithAI`, R7 — this *is* natural-language transaction entry) and
  **photo-statement import** (`parsePhotoImportWithAI`, v3.3.0–v3.5.0). Four in
  total; [`feature-specs.md` §AI](../reference/feature-specs.md)'s table is the authoritative list.
  **Any later 5a item reuses that foundation — do not rebuild it.** What is
  still deferred: the Claude panel, daily briefing, natural-language *task*
  creation, ask-about-tasks/finances, financial insights, prompt caching,
  Sonnet-tier routing, and the `ApiKeySetup` first-run screen (Settings now
  covers the key). Each remaining item still needs its own owner sign-off under
  rule 10.
- **Phase 5b (Sharing)** shipped v1.0.1 — household groups, shared accounts, splits, settlements
- **Phase 5c (Wallet UX)** shipped v1.0.1 — all 5 wave PRs (#29–#33) merged, see docs/archive/phase-5c-implementation-plan.md

### Delivery Milestones

| Milestone | After phase | What it means |
|---|---|---|
| **Alpha** | 3 | Core app fully working on your machine. Single user. Data in browser IndexedDB (since replaced — see §3). |
| **v1.0** | 4 | Multi-user on home network. Any device on your WiFi can log in. Data on your hardware. |
| **v1.0.1** | 5b | Household sharing added. Family members can share accounts and settle expenses. |
| **v2** | 6 | Cloud-hosted on Cloudflare Workers + D1, reachable from any device, session auth via PBKDF2. Shipped. AI is a separate, partially-started track (5a). |
| **v3+** | 7+ | Power features — ship whatever matters most, one at a time. |

> **Tracker:** Open `tracker.html` in a browser to see the interactive task-level breakdown with progress tracking.

---

## 12. Accounts & Services Checklist

### Needed before Phase 1 (coding starts)

- [x] Anthropic account created + payment method added + $10 spend limit set
      → Only used in Phase 5 (AI features). Account is confirmed active.
- [x] Git installed (v2.50.0 confirmed)
- [x] Claude Code CLI installed — confirmed active
      → Cannot install itself; must exist before any Claude Code session can run
- [x] GitHub account + private repo `daybook` created (github.com/moascode/daybook confirmed)
- [x] Repo cloned to local machine — confirmed (current working directory)
- [x] Node.js 20+ installed — confirmed by user
      → Required to run `npm create vite`, install packages, and start the dev server.

### Needed later (do not set up early)

- [x] Anthropic API key — **now needed, per user.** Each user enters their own on
      the Settings page ([`feature-specs.md` §AI](../reference/feature-specs.md)). Optional: with no key the app is fully usable and
      every AI entry point is hidden. Get one at console.anthropic.com.
- [ ] ~~Vercel account~~ — **not needed.** Phase 6 shipped on Cloudflare Workers,
      not Vercel.
- [ ] ~~Supabase account~~ — **not needed.** Phase 6 shipped on D1, not Supabase.

---
