# Overnight test and release-readiness scope — 2026-08-05

This is a local-only unattended verification and planning loop. Its purpose is
to execute the broadest safe regression suite, expose incomplete beta/social
work, and prepare an evidence-backed Production-promotion packet for attended
review. It does not resume the paused census goal or authorize any external
action.

## Entry state and preservation rules

- Read `CLAUDE.md`, `docs/CONTINUATION-2026-08-04.md`, and
  `docs/MORNING-HANDOFF-2026-08-05.md` first.
- Starting handoff commit: `8cb4b9a922002889b18a4887dd99d8983a524a1b`,
  unless a later deliberate local commit is proven and reported.
- Census goal `g-7104aed0-7305-491e-8297-b47729cd1496` must remain paused.
- Require no live lease and an armed common remote-write lock before starting.
- Preserve the exact `0041` migration and census report/apply binding. Do not
  edit migrations, `scripts/census/**`, catalog apply code, curated payloads, or
  either iOS worktree.
- Never touch the four protected operator documents or the redundant
  `nb-testflight-node22` worktree.
- Generated `.next`, Playwright report, trace, screenshot, coverage, and test
  result artifacts are evidence only; do not stage or commit them.
- Do not print `.env.local`, tokens, keys, connection strings, or secret values.

## Remote-safety fence

The overnight loop must not use Production or protected-Staging credentials or
make network requests to Supabase, Vercel deployments, Google providers, Apple,
GitHub write APIs, or any non-loopback application target.

Before browser testing, prove that Playwright's application base URL and web
server are loopback-only. Add a test-run network fence if one is not already
available: application requests leaving `localhost`/`127.0.0.1` must be aborted
and recorded by hostname only, never with query strings or credentials. If the
fence cannot be proven, run unit/static/build gates and mark browser execution
blocked rather than risking a live call.

Public read-only research may use primary official documentation. Package
security metadata may be read without changing dependencies or lockfiles.

## Execution ladder

Run each gate once. A single evidence-driven retry is allowed only for a proven
harness/infrastructure failure or the documented `/quiz` cold-compile flake.
Report the first genuine failure with the smallest relevant tail. Do not churn
on failures or patch application behavior by guesswork.

### Gate 1 — repository and safety checks

- Reconcile branch, HEAD, dirty files, goal status, lease, and remote-write
  lock.
- Confirm the four protected documents are the only pre-existing dirty paths.
- Run `git diff --check` without modifying files.
- Run `npm run secret-scan`.
- Run `npm run tier-validate`.
- Inspect the configured feature/environment manifest and migration-number
  reservations without connecting to a database.

### Gate 2 — complete unit and static verification

- Run `npm test` and record exact pass/fail/skip counts and duration.
- Run `npm run typecheck`.
- Run focused environment-identity, environment-safety, feature-manifest,
  migration-contract, RLS/static, push, auth, social, matching, catalog, and
  census tests as separately named evidence where the full output otherwise
  hides their status.
- Do not run any script that accepts `DATABASE_URL`, service-role credentials,
  `--apply`, provider execution, seeding, cleanup, or remote smoke behavior.

### Gate 3 — social regression suite

Run the existing social/auth/history suites on both iPhone 13 and Pixel 7 under
the loopback network fence. Include at least:

- `auth-page`, `claim-handle`, `onboarding-identity`, and `profile-anon`;
- `friends-flow`, `friends-real`, and `follow-requests`;
- `suggestions`, `vibe-vote`, and `tonight-exclusion`;
- `share-card`, `night-page`, and `nights-history`;
- `lists-flow`, `rankings-lists`, and `want-to-go` flows;
- account deletion refusal/safety and account-switch isolation coverage;
- analytics-silence and privacy-relevant negative cases.

Produce a social evidence matrix with rows for identity, follow/request,
ratings, consensus, suggestions, RSVP, vibe votes, sharing, unsharing, Nights
Out, public profiles, lists, pins, Close Friends, Crews, invited Night Outs,
and notifications. For each row record:

- implementation state;
- unit/E2E/static evidence and exact test name;
- signed-in, signed-out, unauthorized, revoked, empty, loading, error, stale,
  concurrent, and mobile coverage;
- whether evidence is mocked localhost, real Staging, physical TestFlight, or
  absent;
- the next missing behavioral test.

Do not count the followed-circle `get_circle_suggestions` flow as proof of an
invited-Crew Night Out. Mark reusable Crews, invite-scoped suggestion/voting,
member removal, expiry, and real multi-account Staging coverage incomplete.

### Gate 4 — full feature E2E matrix

Run the complete Playwright suite through the repository configuration after
the targeted social suite is understood. At the handoff the repository has 55
E2E files and 264 declared `test()` cases; recompute these counts rather than
hard-coding them into the verdict.

The configured matrix includes iPhone 13, Pixel 7, scoped iPhone 17, desktop
marketing, and the warmup dependency. Record results per project and spec, not
only an aggregate exit code. Explicitly cover:

- app shell, login/auth, age gate, navigation, install and legal surfaces;
- Where Next, quiz, matching, rerun, filters, empty recovery, and distance;
- ratings, pairwise ranking, lists, want-to-go, recap, and sharing;
- map markers, lightbox, filters, search, location, and pin UX;
- mobile controls, safe-area-sensitive overlays, scrolling, and accessibility;
- photos/media-policy and analytics-silence behavior;
- every existing social suite from Gate 3.

The browser suite cannot prove native safe areas, APNs, background behavior, or
real protected-Staging membership/RLS. Report those as attended gaps.

### Gate 5 — production-like local build and packaging

After Playwright has stopped its dev server, verify no repository dev server is
still using `.next`; do not run `next build` concurrently with `next dev`.

- Run `npm run build` and record warnings, route output, and duration.
- Run the quick local TestFlight preflight after the already-completed
  typecheck/build gates, recording every PASS/WARN/FAIL.
- Verify the manifest, icons, installed display name `Next Bar`, bundle ID
  expectations, canonical-site resolution, analytics disabled state, push
  disabled state, and forbidden environment/reference checks.
- Inspect build artifacts only for deterministic size/readiness facts; do not
  modify or commit generated output.

### Gate 6 — Production-switch readiness simulation

This gate tests the release machinery and documented configuration contract;
it does not inspect or change the live Production environment.

- Execute environment-checker tests for production, staging, preview, unknown,
  missing, and secret-exposure cases using synthetic non-secret values.
- Verify Production rejects harness flags, preview rejects server-write
  credentials, unknown environments fail closed, analytics flags agree, and
  required public configuration names are enforced.
- Generate a release manifest containing the proposed exact code range,
  web/native/schema classification, feature flags, required migrations,
  excluded migrations, expected environment-variable names, rollback target,
  smoke matrix, and abort conditions. Unknown live values must remain marked
  `ATTENDED/UNKNOWN`.
- Confirm that census migrations `0037`/`0041`, draft `0038`, planned `0039`,
  and future `0040` are not silently included in Production.
- Verify all proposed release code is compatible with the migration set that
  Production is expected to have; where the live ledger is unknown, record an
  attended blocker rather than assuming compatibility.
- Exercise rollback and migration-recovery procedures as dry-run/static
  reasoning only. A clean-database rebuild remains blocked if no isolated local
  Postgres exists; never substitute protected Staging.

### Gate 7 — gap creation and bounded test additions

After the baseline is complete, rank uncovered behavior by user harm and
release risk. It is acceptable not to finish everything.

- Documentation and test-only additions are allowed when they do not touch
  census/apply/migration/native code and can run wholly on localhost.
- Each new test must first fail for the missing coverage or proven defect,
  exercise the actual interactive outcome, and run on both primary mobile
  projects where relevant.
- Do not implement new beta features or fix application defects in this paused
  census worktree overnight. Record reproducible defects and queue/deduplicate
  goals for attended or post-census implementation.
- Use one focused test-harness correction at most if the runner itself is the
  proven blocker. Otherwise report the blocker.

## Architecture and product packets

In parallel with test evidence, produce reviewed packets for:

1. Complete beta user epics with local/Staging/Production status.
2. Reusable Crews and ephemeral invited Night Outs.
3. Native APNs integration and manual push testing.
4. 20,000-concurrent-user architecture and localhost-only load design.
5. Staging acceptance and Production promotion/rollback.

T1 packets require fresh FABLE plus Codex. T0 privacy, database, auth, native,
capacity, or release packets additionally require the appropriate risk-routed
specialist. Never infer a missing verdict.

## Required overnight report

Create `docs/OVERNIGHT-TEST-REPORT-2026-08-05.md` containing:

- base and final SHAs and exact local commits;
- safety-grounding result and network-fence evidence;
- every command run, duration, and PASS/FAIL/BLOCKED/NOT RUN status;
- exact unit, social, full-E2E, viewport/project, typecheck, build, secret,
  environment, and preflight results;
- a feature-to-test matrix and the incomplete social/Crew items;
- reproducible defects with the smallest useful evidence;
- production-readiness simulation result and all attended unknowns;
- reviewed architecture/product packets and exact verdicts;
- prioritized open-goal queue for tomorrow and later;
- confirmation that census state was unchanged, the census goal stayed paused,
  no credentials or paid providers were used, no external writes occurred,
  Staging/Production/Apple/GitHub/Vercel were untouched, no lease remains, and
  the common remote-write lock is armed.

Commit only focused documentation/test evidence locally. Never push. Update the
durable continuation once at the final checkpoint without touching the four
protected documents.
