/**
 * Wipe the local D1 before every suite run.
 *
 * The suite gets per-test isolation by signing up a fresh user per page, and
 * nothing ever cleans those up. `.wrangler/state` also survives between runs, so
 * the local database grew without bound — it was measured at 2,344 users and
 * 2,343 sessions after a day's work, against a schema where every authenticated
 * request does a session lookup.
 *
 * That degradation is gradual, which is why it showed up as *late* tests timing
 * out and as `wrangler dev` dying part-way through a long run, rather than as an
 * obvious failure anyone could place. Starting from empty bounds the cost of a
 * run to that run.
 *
 * `POST /api/test/reset` already existed for exactly this — its own comment
 * offers it "for a clean baseline between runs if needed". It is mounted only
 * when DAYBOOK_TEST=1, which wrangler.toml sets in [env.dev].
 *
 * Safe as a single up-front wipe because the suite runs `workers: 1` and
 * `fullyParallel: false`; wiping between files would race a parallel worker if
 * that ever changes.
 */
async function globalSetup() {
  const url = 'http://localhost:5173/api/test/reset'
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    // Loud, not silent. A skipped wipe reintroduces the slow accumulation this
    // exists to prevent, and the symptom would surface hours later somewhere
    // unrelated.
    throw new Error(
      `global setup: ${url} returned ${res.status}. The test routes are mounted ` +
        `only when DAYBOOK_TEST=1 — check [env.dev] in wrangler.toml.`,
    )
  }
}

export default globalSetup
