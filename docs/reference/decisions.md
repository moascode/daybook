> **Status:** Live · **Last verified:** 2026-09-16

# Known decisions and rationale

Choices that were made deliberately, with the reason, so they are not relitigated by accident.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 15. Known Decisions & Rationale

| Decision | Choice | Why |
|---|---|---|
| App name | Daybook | Historical accounting term for a daily record — captures both tasks (what to do today) and finances (what you spent today) in one word |
| Local DB | ~~PGlite~~ → **D1** | PGlite (Phase 1–3) was per-browser; replaced by server SQLite in Phase 4 and by Cloudflare D1 in Phase 6. Do not reintroduce it. |
| State manager | Zustand | Lighter than Redux, simpler than Jotai for this complexity level |
| DnD | @dnd-kit | Most accessible, supports nested trees, actively maintained |
| Charts | Recharts | React-native, sufficient for cash flow + pie, no D3 complexity |
| AI model routing | Haiku + Sonnet | Haiku for parsing/categorisation, Sonnet for reasoning. ~60% cost saving. Only the Haiku half is built (`claude-haiku-4-5`, [`feature-specs.md` §AI](feature-specs.md)). |
| Domain | `daybook.moascode.workers.dev` | Free `workers.dev` subdomain. The vercel.app plan was dropped with Vercel itself. ⚠️ Publicly reachable. |
| Auth | ~~Supabase Auth~~ → **PBKDF2 + D1 sessions** | Phase 4 shipped bcrypt + express-session; Phase 6 replaced it with PBKDF2-HMAC-SHA256 (50k iterations) via Web Crypto and D1-backed sessions behind an HMAC-signed cookie. **Not JWTs** — logout must stay instant. |
| Transfer schema | `destination_account_id` on transactions | Transfers have two legs; without this column balances are incorrect |
| CSV dedup | `import_hash` column | SHA-256 of date+amount+merchant prevents double-importing the same CSV |
| Data export | Phase 5 feature | Browser storage can be cleared accidentally; JSON/CSV export is the safety net before cloud sync exists |
| Anthropic SDK | **None — plain `fetch`** | Removed in PR #112 after three years unimported. It targets Node and is unproven on the Workers runtime; see §4. |
| Sonnet model ID | `claude-sonnet-4-6` | Correct current model ID — `claude-sonnet-4-20250514` does not exist and will return 404 |
| Phase 4 architecture | Local Node.js backend + SQLite file | Home network multi-user requires a real server — PGlite is per-browser only. SQLite file keeps it simple before committing to Postgres |
| AI key location | Per user, in `settings`, read server-side only | The key never reaches the browser: `GET /api/settings` masks it to `'set'`/`''`. One user's spend can never land on the other's bill. |
| Cloud (Phase 6) ordering | Shipped **before** AI | Reversed in practice: Phase 6 landed first and AI began afterwards on top of it, so the one AI feature is Worker-native and `server/` never needed touching. |

---
