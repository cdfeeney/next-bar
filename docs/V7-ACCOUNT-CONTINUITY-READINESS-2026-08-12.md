# v7 TestFlight — account-continuity readiness (offline slice)

Goal `g-537c9855-4272-4f53-9ca0-7b32fcb35319` · 2026-08-12 · risk tier **T1**

This document records what an **offline, read-only** evidence run can and cannot
prove about the claim *"the v7 TestFlight candidate keeps the existing beta
users' staging Supabase project and their stable auth identities/history."*

Nothing here contacted a live system. Migration `0042` was **not applied**. No
`.env*` file was read, no credential value was read or logged, nothing was
deployed, nothing was uploaded to TestFlight, nothing was pushed.

## How to reproduce

```
npx tsx scripts/release/account-continuity-check.mts
```

Optional positional arguments override the two inspected shell configs; the
defaults are discovered (`nb-beta1-rc`, `nb-ios`). `--json` prints only the
machine-readable report.

Exit code is `0` when no check is `fail`, `1` otherwise. A non-empty
`cannot-verify-offline` list does **not** affect the exit code — that list is
the point of this slice, not a defect in it.

## Run output — 2026-08-12, verbatim

```
account-continuity-check: 7 pass, 0 fail, 4 cannot-verify-offline (attended gates)
```

Script exit code: **0**.

| # | Check | Status |
|---|---|---|
| 1 | `supabase-project-identity` | **pass** |
| 2 | `native-bundle-identifier` | **pass** |
| 3 | `app-update-origin-behavior` | **pass** |
| 4 | `redirect-origin-configuration` | **pass** |
| 5 | `account-persistence-migration-status` | **pass** |
| 6 | `signed-in-history-continuity` | **pass** |
| 7 | `staging-production-separation` | **pass** |
| 8 | `supabase-project-binding-live` | **cannot-verify-offline** |
| 9 | `supabase-redirect-allowlist-live` | **cannot-verify-offline** |
| 10 | `zero-zero-four-two-row-preservation` | **cannot-verify-offline** |
| 11 | `testflight-build-behavior-live` | **cannot-verify-offline** |

Per-check detail, as reported by the run:

1. **`supabase-project-identity`** — `src/lib/supabase.ts` reads
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
   environment; no literal Supabase host in 219 non-fixture source files (values
   never read).
2. **`native-bundle-identifier`** — 2 shell config(s) agree on `com.nextbar.app`:
   `nb-beta1-rc/capacitor.config.ts`, `nb-ios/capacitor.config.ts`.
3. **`app-update-origin-behavior`** — `CAP_SERVER_URL`-driven origin, normalized
   `server.url`, protocol/host/path/query/fragment guards, and
   `next-bar.com` + `www.next-bar.com` always in `allowNavigation` (2 configs).
4. **`redirect-origin-configuration`** — redirect built from the runtime origin
   in `src/app/auth/page.tsx`; in a `server.url` shell build that **is** the
   config-driven Capacitor origin, so shell and auth callback cannot diverge.
   The project's redirect allow-list itself is attended gate #9.
5. **`account-persistence-migration-status`** — 0042 present only at
   `nb-account-sync/supabase/migrations/0042_account_content_state.sql`
   (domains: `lists`, `night_log`, `night_archive`, `shared_nights`); absent from
   this worktree's `supabase/migrations` (0 matches); unapplied everywhere as of
   this run — no live database was queried.
6. **`signed-in-history-continuity`** — all 4 domains are localStorage-only today
   (`src/lib/lists.ts`, `src/lib/nightLog.ts`, `src/lib/nightArchive.ts`,
   `src/lib/sharedNightsLocal.ts`); no `src` reference to
   `account_content_state`, so a v7 build shipping before 0042 keeps reading the
   existing local history rather than an empty server table.
7. **`staging-production-separation`** — `src/lib/supabase.ts` yields a null
   client and `supabaseConfigured === false` when either env var is absent; no
   `??` / `||` fallback to any literal endpoint.
8. **`supabase-project-binding-live`** — requires reading the deployed
   environment configuration and a live auth session.
9. **`supabase-redirect-allowlist-live`** — lives in the Supabase project
   settings, not in this repository.
10. **`zero-zero-four-two-row-preservation`** — requires applying the migration
    against a real database, which this goal forbids.
11. **`testflight-build-behavior-live`** — requires an actual upload and install.

## Migration 0042 was not applied

`0042_account_content_state.sql` exists **only** in the `nb-account-sync`
worktree on `feat/beta1-account-sync`. It is unapplied in every environment as of
this run, and this goal did not apply it anywhere.

Server-side account-persistence continuity is therefore **historical evidence
only**. The implementing work is tracked by `g-5cb22f54-a76c-4eec-9a81-705351043de4`
(Stop-Sharing + Account Persistence Remediation v2.1) and the superseded
`g-ba7a64d6-a6a9-4947-b408-15d1105aeaa8`, both of which live in
**`nb-account-sync`'s own goal store**, not this workspace's. They are
**referenced here, not reopened and not duplicated.** Their documented state is
in `docs/CONTINUATION-2026-08-05.md`.

The practical consequence for v7: because 0042 is unapplied and no `src` code
reads `account_content_state`, a v7 build **must keep reading the existing
localStorage stores**. Shipping a build that reads a server table first would
present existing beta users with blank lists and night history.

## (a) What this goal proves offline

Config-level, statically verifiable, no live system involved:

- The Supabase project is chosen **entirely** by `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, with no hardcoded host anywhere in the
  non-fixture client construction path — so nothing in the code can silently
  repoint v7 at a different project.
- Absent env vars **fail closed** to a null client, never to a guessed or
  hardcoded production endpoint.
- The native bundle identifier is `com.nextbar.app` in both shells and they agree
  — the installed app's identity does not change under v7.
- The webview origin stays config-driven with fail-closed URL validation, and the
  canonical hosts remain navigable unconditionally, so a v7 shell change cannot
  strand an installed build on a dead origin.
- The auth redirect is built from the runtime origin rather than a hardcoded
  host, so the callback cannot diverge from the origin the shell loads.
- All four 0042 persistence domains are still client-side only, and no code reads
  the unapplied server table.

## (b) What only an attended session can prove

These require real credentials, live reads, or a real build. They are **not**
covered by anything above, and the offline run names them explicitly rather than
folding them into "pass":

- **Which Supabase project the existing beta testers' sessions actually resolve
  against.** The code proves the project is env-selected; only reading the
  deployed environment proves *which* project is selected, and only a live
  session proves testers' identities resolve there.
- **Whether applying 0042 preserves existing rows for existing `auth.users`.**
  Nothing is applied here, so nothing about post-apply behavior is demonstrated.
- **Live TestFlight build behavior** on an existing beta tester's device,
  including whether an update preserves the signed-in session.
- **Whether the Supabase project's auth redirect allow-list contains the shell
  origin.** That value lives in project settings, not in this repository.

## Attended gates still required before any real v7 TestFlight upload

Each is an operator action in an attended session. None may be inferred from this
document.

1. **Confirm the deployed environment's Supabase project ref** matches the one
   existing beta users are signed into — read the deployed env config, do not
   guess from `.env.local` (which historically carries the production ref; see
   `scripts/preflight-testflight.mjs`).
2. **Confirm the target is the `next-bar-staging` Vercel project's Production
   target**, never a Preview deployment (Preview is SSO-gated and carries the
   wrong app-environment identity).
3. **Confirm the Supabase auth redirect allow-list** contains the exact origin
   the shell will load, including any `CAP_SERVER_URL` override used at
   `npx cap sync ios` time.
4. **Decide explicitly whether 0042 is applied for v7.** If it is not, confirm
   the build still reads localStorage for all four domains. If it is, prove on a
   real database that existing rows for existing `auth.users` survive, before any
   tester sees the build.
5. **Confirm the Apple App ID / app record** still matches `com.nextbar.app` so
   the upload lands on the existing app, not a new one.
6. **Confirm the four GitHub secrets** and the App Store Connect API key are
   present and valid (runbook §3–§4) — without reading their values into any log.
7. **Confirm distribution stays internal-only.** The `server.url` remote-origin
   design is internal TestFlight only and must never reach external testing or
   App Review (`TESTFLIGHT-ARCH-DECISION-g-39169b3b`).
8. **Run the existing local preflight** (`npm run preflight:testflight`) and this
   check, and require both green, before dispatching the build workflow.
9. **After upload, verify on a real device with an existing beta account** that
   the session survives the update and that lists / night history are intact.

## Scope note

This document is evidence, not a decision. Whether to apply 0042 and whether to
run a live v7 TestFlight build are separate operator decisions outside this
goal's scope.
