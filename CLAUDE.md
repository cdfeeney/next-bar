# Next Bar — agent operating notes

Project context lives in `docs/PRD.md`, `docs/PRD-v0.3.1.md`, `docs/PRD-v0.5.md`,
and `docs/ARCHITECTURE-v0.2.md`. Read those before making non-trivial changes.

## The standard gate — `test:e2e` is part of it

Before claiming a change is verified, all three of these run and pass:

```
npm run typecheck
npm test           # vitest
npm run test:e2e   # Playwright, production build, both viewports
```

**`npm run test:e2e` IS the release run** — it is `scripts/run-e2e-release.mjs`,
which sets `PLAYWRIGHT_RELEASE=1` itself. The gate is the default spelling on
purpose: the env-prefixed form `PLAYWRIGHT_RELEASE=1 npm run test:e2e` is a
parse error in PowerShell, this machine's primary shell, and a gate command
half the project's shells cannot run is a gate that does not get run. The dev
run is `npm run test:e2e:dev` — an explicit opt-in for iterating on one spec.

Gate on release, not dev. The dev server carries a navigation race that is not
a product defect: a `page.goto()` issued straight after a load can be
interrupted by the app's own client-side navigation while the route is still
cold-compiling. Measured 2026-08-17 on `app-store-pack.spec.ts:16` — **3/3 red
on dev, 5/5 green on a production build of the same commit**.

**Two specs are known-red under `test:e2e:dev` and green under the gate**,
measured on the same commit 2026-08-18 (dev: 2 failed / 438 passed; release:
0 failed / 440 passed). Both fail on iPhone 13 only:
- `app-store-pack.spec.ts:16` — the navigation-interrupt race above.
- `native-shell-contract.spec.ts:617` (lightbox focus restore) —
  `toBeFocused` receives `inactive`, i.e. the element IS `activeElement` but
  the document is not the active one. A headless-contention artifact of the
  slower dev compile, not a focus-management defect.
They are NOT quarantined: they pass in the gate, and skipping them there would
delete real coverage to silence a mode nobody gates on.

`npm test` runs **vitest only**. Between 2026-08-13 and 2026-08-16 every
"full suite green" reported during the V8 work meant vitest alone — the browser
specs were never invoked, and the suite had been red and invisible for weeks.
A gate that omits the browser specs is not a gate; say which of the three you ran.

Release mode is production build, 3 workers, zero retries. Do NOT pass
`--reporter=list` on the command line: it overrides the config's
`[['list'], ['html']]`, so the run produces no HTML report — exactly when a
failure most needs it. Traces come from `trace: 'retain-on-failure'` and do not
depend on a retry; `on-first-retry` wrote none at all under a zero-retry gate.

## Testing principle: every interactive feature gets an e2e test

Connor caught a "rating a bar pushes me back to home" bug manually that should
have been caught by Playwright. Don't repeat that.

**Before claiming a feature works:**

1. **Smoke**: at minimum, an e2e test that visits the route and asserts a
   recognizable heading / control renders. See `e2e/app-shell-smoke.spec.ts`
   for the pattern. Add a new entry whenever you add a route.
2. **Interaction**: every button or control that does something user-visible
   gets an e2e assertion on the resulting state — including the *negative*
   state, e.g. "tapping this does NOT change the URL" / "tapping this does
   NOT close the modal." Negative assertions catch the bugs unit tests miss.
3. **Both viewports**: Playwright config runs against `iPhone 13` and
   `Pixel 7`. Don't add a test that only passes on one. Same e2e is run
   against both — make assertions viewport-agnostic.
4. **Both auth modes** when behavior diverges: signed-in vs signed-out paths
   for `useRatings` / `/rankings` / `/settings` should each have at least one
   test. Server-mode and local-mode are different code paths and have
   regressed independently.

**Known dev-server flake to expect, not chase:** the Next.js dev server
cold-compile races with `page.goto()` from Playwright workers. Failure
signature: `Error: page.goto: Navigation to "http://localhost:3000/<route>" is
interrupted by another navigation to "/"`. **Not confined to `/quiz`** — hit on
`/map` (app-store-pack.spec.ts:16) on 2026-08-17, where it was not intermittent
at all but 3/3 reproducible on a cold server, which reads exactly like a real
regression. What settles it is the mode, not the repeat count: the same commit
was 5/5 green under `npm run test:e2e`. Re-run it in release mode before
debugging, and gate in release mode so it cannot cost anyone this hour again.

## Database migrations

SQL migrations live in `supabase/migrations/` as numbered `.sql` files. Apply
them with `npm run db:migrate` — the runner reads `DATABASE_URL` from
`.env.local` and applies every file in lexical order. Migrations must be
idempotent (`CREATE ... IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc.) —
there's no schema_migrations ledger yet.

## Other ground rules

- **Connor is on Windows.** No Mac. The iOS App Store path uses PWABuilder +
  iTMSTransporter (Java, runs on Windows) or cloud Mac CI — never assume a
  local `xcodebuild`.
- **Marketing landing lives at `/install`,** not `/`. `/` is the app surface
  (Where-next BarPicker).
- **5-tab bottom nav** (Next Bar? · Map · Rankings · Friends · Settings) is
  hidden on `/install`, `/join`, `/api/*` only. If you add a new tool route,
  decide explicitly whether it gets a tab or sits outside the nav.
- **Ratings are 3-tier** (Loved · Liked · Pass) in code even though PRD-v0.3.1
  reads 4-tier. Don't reintroduce "Meh" without explicit confirmation.
- **Pre-existing dev-server cold-compile flake** on `/quiz` is documented in
  memory. Don't try to "fix" it by adding waits or restructuring — it's a
  Next.js dev artifact, not a product bug.

## Environments (added 2026-08-18 — keep values out, pointers only)

- **Two Supabase PROJECTS, operator-confirmed 2026-08-18** (beware: the dashboard labels the
  main branch of EVERY project "production", including the staging project — the branch label
  is not the project):
  - **`next-bar`** = production, ref `nuhqlvneokucxomguxhi`. Live v7 users. Repo-root
    `.env.local` points here. Ledger head **0032**, no night-out schema (2026-08-18). The
    2026-08-18 Supabase advisory (RLS off on `schema_migrations`) was about THIS project and
    was fixed same day: RLS enabled + anon/authenticated grants revoked, ledger intact (33 rows).
  - **`next-bar-staging`** = staging, ref `wqxovhiovgcijmfzxgby`. Serving database for
    pre-release streams, ~16 migrations ahead. Read its ledger head before migration decisions
    (still pending 2026-08-18); apply the same `schema_migrations` RLS fix there.
  Guard env vars: `NEXT_BAR_PRODUCTION_PROJECT_REF=nuhqlvneokucxomguxhi`,
  `NEXT_BAR_STAGING_PROJECT_REFS=wqxovhiovgcijmfzxgby` (set in gitignored `.env.local`).
- **The canonical local env lives in the repo-root `.env.local`** (main checkout only — it is
  gitignored, so **worktrees do NOT inherit it**; that gap caused a day of "missing env"
  failures on 2026-08-18). A worktree that needs DB access gets a curated STAGING-ONLY copy:
  staging URL, anon key, staging DATABASE_URL, its pinned PLAYWRIGHT_PORT. **Never copy
  production credentials (service role key, prod DATABASE_URL) into a worktree an unattended
  worker runs in.**
- **Credentials policy:** connection strings, passwords, and keys are never committed and never
  recorded in this file. Source: Supabase dashboard → project → Settings → Database, or the
  operator. Hand them to a session via its environment or gitignored `.env.local` only.
- **Migration truth:** a migration file in the repo is NOT applied anywhere until the target
  project's ledger says so; this repo's `db:migrate` is ledger-blind. When in doubt, read the
  ledger, not the filesystem.
