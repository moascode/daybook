# CI/CD & Release Management

How Daybook goes from a commit to running on the Mac that serves the home
network. Three moving parts:

1. **CI** — every PR/push is typechecked, linted, built, and e2e-tested
   (`.github/workflows/ci.yml`).
2. **Release** — pushing a `vX.Y.Z` tag builds a deployable artifact and
   publishes a GitHub Release (`.github/workflows/release.yml`).
3. **Deploy** — on the Mac, `infra/daybook deploy` pulls that artifact, verifies
   it, swaps it in, reinstalls deps, and restarts the launchd service.

```
   commit ──▶ CI (test)
                       push tag vX.Y.Z
                              │
                              ▼
                    Release workflow ──▶ GitHub Release
                    (build + test +        daybook-X.Y.Z.tar.gz
                     package artifact)      daybook-X.Y.Z.tar.gz.sha256
                                                  │
                                                  │  infra/daybook deploy
                                                  ▼
                                          Mac (launchd service)
```

---

## 1. Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main`/`master` and on every
pull request targeting them. One `build-test` job does:

| Step | Command |
|---|---|
| Typecheck (client) | `npx tsc -b` |
| Typecheck (server) | `npm run typecheck:server` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| E2E | `npm run test:e2e` (Playwright) |

The Playwright HTML report is uploaded as a build artifact (`playwright-report`,
30-day retention). Concurrent runs on the same ref are cancelled so only the
latest push is tested.

> Keep `main` green: CI is the gate before a release tag is ever cut.

---

## 2. Release Management

### Versioning

Releases are **semantic version git tags**: `vMAJOR.MINOR.PATCH` (e.g.
`v1.0.0`). The tag is the source of truth — the version baked into the artifact
is derived from it (`v1.2.0` → `1.2.0`). `package.json`'s `version` field is not
used for releases and can stay `0.0.0`.

Rough guidance, mapped to the phase milestones in `CLAUDE.md` §14:

| Bump | When |
|---|---|
| MAJOR | A milestone (`v1` home-network, `v2` AI, `v3` cloud …) |
| MINOR | A new feature shipped within a phase |
| PATCH | Bug fixes, no new behaviour |

### Cutting a release

From a green `main`:

```bash
git checkout main && git pull
git tag v1.0.0          # annotate if you like: git tag -a v1.0.0 -m "v1 home network"
git push origin v1.0.0
```

Pushing the tag triggers `.github/workflows/release.yml`, which:

1. Installs deps, typechecks the server, builds the frontend.
2. Runs the **full Playwright e2e suite** — a red build never ships.
3. Packages the artifact via `scripts/package-release.sh`.
4. Publishes a **GitHub Release** named `Daybook v1.0.0` with
   auto-generated release notes and two assets attached:
   - `daybook-1.0.0.tar.gz`
   - `daybook-1.0.0.tar.gz.sha256`

If anything fails, no release is created — fix forward and push a new tag.

### The release artifact

`scripts/package-release.sh` assembles a self-contained tarball. Contents:

```
dist/                 built frontend (served by the Node process)
server/               server TypeScript (run via tsx)
infra/daybook         the control/deploy tool (so deploy can self-update)
scripts/              package-release.sh
package.json          dependency manifests — `npm ci` runs on the Mac
package-lock.json
tsconfig*.json
.env.example
VERSION               version + commit + build timestamp manifest
```

**Why ship source, not `node_modules`?** Native modules (`better-sqlite3`,
`bcrypt`) compile against the host's architecture and Node ABI. The artifact is
built on Linux CI; the Mac rebuilds them locally with `npm ci`. The server runs
TypeScript directly through `tsx`, so no separate compile step is needed.

You can build an artifact locally to inspect it:

```bash
npm run build
scripts/package-release.sh 1.0.0      # or: scripts/package-release.sh --build 1.0.0
# → dist-release/daybook-1.0.0.tar.gz (+ .sha256)
```

---

## 3. Deploying to the Mac

The Mac runs Daybook as a launchd service (see `infra/daybook install-service`).
Deployment pulls a prebuilt release artifact — no building on the Mac.

### One-time setup

The repo is **public**, so `deploy` downloads release assets anonymously — no
setup required. A token is optional: it raises the GitHub API rate limit and
becomes necessary only if the repo is ever made private. To use one, create a
token with read access to `moascode/daybook` (`contents: read`) and export it
(e.g. in `~/.zshrc`):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx   # optional
```

### Deploy

```bash
infra/daybook deploy            # install the latest release
infra/daybook deploy v1.0.0     # install a specific tag
```

What `deploy` does:

1. Resolves the release from the GitHub API (latest, or the given tag).
2. Downloads the `.tar.gz` and `.tar.gz.sha256` assets.
3. **Verifies the checksum** — aborts on mismatch.
4. Unpacks to a staging dir and sanity-checks it (`dist/`, `server/` present).
5. **Backs up** the current install to `.daybook/backups/<timestamp>/`
   (keeps the 5 most recent).
6. Swaps in `dist/` and `server/`, overlays the manifests, `VERSION`, and the
   `infra/daybook` tool itself.
7. Runs `npm ci` (rebuilds native modules for this Mac).
8. Restarts whichever instance is serving — the launchd service
   (`launchctl kickstart`) or a manual background start.

### Rollback

If a deploy goes wrong, restore the previous release from the most recent
backup:

```bash
infra/daybook rollback
```

This restores `dist/`, `server/`, and the manifests from the latest backup,
reinstalls deps, and restarts the service.

### Check what's running

```bash
infra/daybook status            # running? + LAN URL
cat VERSION                     # version / commit / build time of the live release
infra/daybook logs -f           # follow the service log
```

---

## Deploy paths compared

There are two ways to update the Mac. **`deploy` is the recommended path.**

| | `infra/daybook deploy` | `infra/daybook update` |
|---|---|---|
| Source | GitHub Release artifact (prebuilt) | `git pull origin main` |
| Builds on the Mac? | No (ships built `dist/`) | Yes (`npm run build`) |
| Versioned / pinnable | Yes (`deploy v1.0.0`) | No (whatever `main` is) |
| Checksum-verified | Yes | n/a |
| Rollback | `infra/daybook rollback` | git only |
| Use when | Normal releases | Quick local/source-based update |

---

## Secrets & environment

| Name | Where | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Mac shell env | Optional for `deploy` (repo is public — anonymous works). Raises the API rate limit; required only if the repo goes private. CI provides its own automatically. |
| `SESSION_SECRET` | launchd service env | Signs session cookies. `infra/daybook` generates and persists one in `.daybook/session-secret`; the service refuses to start in production without it. |
| `DAYBOOK_REPO` | optional Mac env | Override the GitHub repo for `deploy` (default `moascode/daybook`). |

Runtime files (`.daybook/`, including backups, pidfile, log, session secret),
`dist/`, `dist-release/`, and `server/data/` are gitignored and never committed.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `deploy`: "Release not found" | Check the tag exists; if the repo is private, export a `GITHUB_TOKEN` with read access. |
| `deploy`: hitting GitHub rate limits | Export a `GITHUB_TOKEN` to raise the anonymous API limit. |
| `deploy`: "Checksum verification failed" | The download was corrupt/partial — re-run `deploy`. |
| Native module errors after deploy | Ensure Xcode CLT is installed (`xcode-select --install`); re-run `deploy` (it runs `npm ci`). |
| Service didn't restart | `infra/daybook status`; check `infra/daybook logs`. |
| Need the previous version back | `infra/daybook rollback`. |
| Release workflow failed | Open the run in GitHub Actions; the e2e step gates the release. Fix and push a new tag. |
