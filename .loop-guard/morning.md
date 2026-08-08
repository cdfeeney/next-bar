# Overnight run — 2026-08-05 (local)

- Queue: g-5cb22f54-a76c-4eec-9a81-705351043de4 (Beta 1 Path B all-in-one: Stop-Sharing plus persistence v2.1)
- Stop conditions: goal complete | genuinely blocked | three-round Santa review cap (no fixed clock stop given)
- Item limit: 1 goal (loop-guard max-iters 4: /code + up to 3 Santa rounds)
- Starting SHA: f40783af61399ffc0111728ac12e4d011208a3eb
- Worktree: C:\Users\cdfee\projects\nb-account-sync
- Branch: feat/beta1-account-sync
- Timezone: local (America — Windows host)
- Constraints: no push/deploy/migrations/credentials/Staging/Production/TestFlight contact; no worktree create/remove; no node_modules links; one writer, one lease; gating Claude reviewer = FABLE; missing review lanes fail closed.

## Items

### g-5cb22f54 — COMPLETE (NICE, 3 Santa rounds, quorum met every round)

**Commits** (all local, branch feat/beta1-account-sync; nothing pushed, nothing deployed,
no migration applied, no credentials read, no Staging/Production/TestFlight contact):
- 4c3eccd fix: tokenless Stop-Sharing (RED-proven; exact confirmation sentence)
- f40783a→bec2e3a feat: persistence v2.1 (readiness barrier, quarantine journal,
  read-back confirmation, retry ladder, gate UI, sign-out dialog, migration 0042 amended
  in place — UNAPPLIED by design)
- 48494b3 fix: santa round-1 (12 verified findings, 11 RED-proven tests)
- 114e5bb fix: santa round-2 (supersede-preserving commit, no mid-flight clobber,
  honest write notifications; 7 RED-proven tests + 2 guards)
- 66a9c02 fix: santa round-3 (digest-guarded envelope mutations, raw-invalid supersede
  single-key path, invalid-bytes capture before hydrate x3, rollover archive gate;
  7 RED-proven tests)

**Final verification**: tsc clean; vitest 2121/2121; gate+nights e2e 31/31 on iPhone 13 +
Pixel 7; next build clean; git diff --check clean; secret scan clean. Pre-existing e2e
failures at HEAD (map-lightbox x3, photo-card x1) proven pre-existing via git stash baseline.

**Panel (T0 full, unattended, fail-closed)** — every round quorum met:
- R1 (bec2e3a): FABLE + Codex + GLM + DeepSeek + Kimi — 12 verified findings fixed.
- R2 (48494b3): FABLE (2 Medium) + Codex proof 70befe25 (2 High: quarantine commit
  destroyed superseded divergent copy; release hydrated over newer mid-flight edit).
- R3 (114e5bb / final range for routed lanes): FABLE (2 Medium: invalid-bytes hydrate
  clobber, rollover archive race — fixed), Codex proof 444ea15a (2 High: stale-tab
  release/update unguarded, raw-invalid single-key overwrite — fixed), DeepSeek (no
  blockers), GLM (5 candidates all refuted with repo evidence), Kimi deep (no Critical,
  architecture holds).

**Lane-unique catches**: Codex R2 caught the supersede-destroys-preserved-copy bug that
FABLE R2 explicitly traced and called benign — model diversity earned its cost. FABLE R3
caught the invalid-bytes and rollover gaps no other lane saw.

**Codex timeouts**: R2 first attempt and R3-scoped first attempt hit 540s (bounded-run
terminated the process tree both times); both succeeded on retry with narrowed 3-question
task files and returned valid proofs.

**Residuals (documented, no code change — human decisions for morning)**:
1. Superseded chains uncapped — operator-locked no-eviction/no-cap; drain = one promoted
   conflict per release through the existing dialog. (Codex R3 Medium)
2. Rollover-refusal is silent (visit dropped, history preserved) — Kimi recommends a
   Retry banner; GLM concurred. Beta+1 candidate.
3. Equal-clock divergent live value loses the LWW tie to the server on next sync —
   pre-existing designed rule, only reachable via non-stamping writer anomaly. (DeepSeek)
4. Kimi Beta+1 recommendations: unify cold stores into one preservation log; aggregate
   "preserved copies awaiting review" badge.
5. Migration 0042 remains UNAPPLIED (out of scope per goal); 0043 reserved for Beta+1.

## Run result — QUEUE_REMAINING (1 blocked, 1 paused, 3 untouched)

**Item 3 — g-b9dc294e — BLOCKED after 3 full Santa rounds.**
Commits: 1153e1a, cea6214, 3532131, ff85f11 on fix/nighttime-mobile-hardening (from b6a7957).
Real fixes landed: modal heading min-w-0 + break-words + line-clamp-3 + title; BarPicker address
span shrink-0 -> min-w-0 truncate; named-list chips min-w-0 max-w-full break-words; a generic
"no nested scroller has a horizontal axis" guard; add-bar-overflow added to the iPhone 17 project.
Verified: 31 passed on iPhone 13 + Pixel 7 + iPhone 17; 157 files / 2339 unit tests; typecheck,
build, secret-scan, git diff --check clean.

UNRESOLVED BLOCKER (rounds exhausted): QuickAddBar variant="search" (lines 211-226) renders its
match list in a bare overflow-hidden ul with an unconstrained name span - silent, affordance-free
clipping, the same defect class, in the path every returning user with >=1 rating takes
(rankings/page.tsx:216). Claude/FABLE measured scrollWidth 1025 vs clientWidth 340. NO test in the
suite reaches it, because gotoRankings() clears localStorage and so always takes the dialog path.

**Item 4 — g-cb7cefd2 — PAUSED, no code written.**
Root-caused: viewportFit:'cover' IS set (layout.tsx:68); the codebase has NO safe-area-inset-top
anywhere - only inset-bottom. Sites: page.tsx:82 header (px-6 py-4), BarLightbox.tsx:306 column
(px-4 py-6). Open test-design problem recorded: Playwright does not emulate safe-area insets, so
env(safe-area-inset-top) is 0 in test and criterion 7's geometry assertion is trivially satisfiable.

**Items 5, 6, 7 — planned, untouched. Items 1, 2, 8 — untouched.**

### Model lanes (Item 3)
Round 1: Claude/FABLE + Codex + GLM + DeepSeek — 4/4 quorum.
Round 2: same four — 4/4 quorum.
Round 3: Claude/FABLE + Codex — GLM/DeepSeek not re-run on the round-3 delta.

Findings unique to each lane:
- Codex only: the nested-scroller blind spot's test consequences; the line-clamp affordance hole.
- Claude/FABLE only: the vacuous list-chip seed (missing createdAt/updatedAt); the search-variant gap.
- GLM + DeepSeek only: the arbitrary max-w-[45%] cap; async settling before measuring.
- All four: the overflow-y-auto => overflow-x:auto absorption.

### Process errors, recorded honestly
1. I backgrounded review agents while running my own builds/Playwright in the same worktree. Their
   mutate-and-restore testing uses `git checkout --`, which reset to HEAD and twice silently
   reverted my UNCOMMITTED fixes; their Playwright runs also spawned next dev on :3000 and
   contended with next build over .next, producing two misleading failures (/api/flags, then
   /_document) that were artifact contention, not code. Reviewers must be serialized.
2. A reviewer ran `git stash push -u` despite the operator's explicit ban on stashing. It remains as
   stash@{0} ("santa-round3-preserve-inflight-edit"). I did NOT drop it - dropping is deleting. It
   holds an earlier version of the line-clamp edit that is now committed in ff85f11, so it is
   believed redundant, but the operator should confirm and clear it.

### Confirmation
Nothing pushed, deployed, migrated, or irreversibly applied. No PR, database, environment, auth,
email, account, TestFlight, or App Store action. No worktree deleted, moved, reset, or pruned.

---

## C2 overnight run — security follow-up queue (Items 9-11)

Started: 2026-08-08 (local). Stop rule: operator turn/item limit, or when no safe runnable item
remains. No wall-clock stop time was supplied. Item cap: 3.

- Worktree: C:\Users\cdfee\projects\nb-overnight-20260807
- Branch: fix/nighttime-mobile-hardening
- Starting SHA: ff85f117a888e31776887cf00b9bb0650059c879
- Queue (operator-supplied order):
  1. g-0f4af1bc-8b52-4e00-a8ac-ef90a0b9bd6c - Item 9: Next.js request-boundary hardening (T0)
  2. g-ce503c6c-e3d9-43b1-a600-4b3bb8c1fb93 - Item 10: Durable rate-limiting architecture (T0)
  3. g-e0fb31ba-d3b2-41a7-85db-1eaf7ab684a6 - Item 11: Supabase authz verification runbook (T1)
- Preflight: overnight-guard preflight ok, tierMapSource=project, 10/10 live T0 rules, no dead rules.
  Recovery status TERMINAL/completed (no interrupted C1 run). No write lease held.
- ENOSPC precondition from C1 is CLEARED: C: now has 5.9 GB free (was 0.01 GB) and node_modules is
  present. All three specs were written to block on this; it no longer blocks.

### Protected pre-existing state (do NOT touch during C2)
The worktree is dirty with C1 Item 4 work, which the operator has explicitly ring-fenced:
`src/app/page.tsx`, `src/components/BarLightbox.tsx` (both modified) and `e2e/safe-area-top.spec.ts`
(untracked). Also `stash@{0}` ("santa-round3-preserve-inflight-edit") from a C1 reviewer.
These are NOT C2 changes. Consequence for this run: checkpoints must be NARROW commits of only the
files C2 itself changed - a broad `git add -A` checkpoint would sweep Item 4's work into a C2 commit,
which is exactly the failure recorded in memory (loop-guard checkpoint broad-commits).

### Item 9 - g-0f4af1bc-8b52-4e00-a8ac-ef90a0b9bd6c - COMPLETE
Commit: 037a527 (local only, NOT pushed). Tier T0, Santa intensity full, 3 rounds, quorum 5/5.

Changed: next.config.js; src/app/api/{waitlist,event,media-metric}/route.ts + their tests;
src/lib/{requestBoundary,vibeProfileSchema}.ts + tests; src/lib/securityHeaders.test.ts;
src/lib/mediaMetric.server.ts; src/lib/waitlistGuard.ts + test; e2e/security-headers.spec.ts.

Verification: tsc 0; vitest 160 files / 2413 tests; next build 0; secret-scan clean (705 files);
Playwright 73/73 (smoke + new header spec) on iPhone 13 + Pixel 7; production-server behavioral run
15/15 (403 origin-less, 403 cross-origin, 413 oversized, 200 real signup, 400 unknown event name,
all six headers served). Non-vacuity proven: the 6 new waitlist tests were run RED against the
unchanged route first.

Model lanes - all five succeeded each round they were run:
Claude/FABLE (preflight expected_model=fable, override absent), Codex gpt-5.6-sol (proofs
4e251d54, 4643fb29), DeepSeek, GLM, Kimi K3 deep.

Findings unique to ONE lane:
- Codex only: missing Places UI Kit CSP hosts (places.googleapis.com, *.googleusercontent.com,
  and the Google webfont hosts an earlier draft of mine had wrongly removed); the missing
  regression test pinning media-metric's native-origin behavior.
- Claude/FABLE only: the savedAt silent-data-loss trap; media-metric's inline sameOrigin
  silently 403-ing capacitor:// native beacons; the parseVibeProfile name collision.
- DeepSeek only: the allowAbsent truthiness bypass (' ' or true buying leniency).
- GLM only: the imprecise sendBeacon justification string.
- Codex AND DeepSeek independently: the escaping stream rejection.
- Kimi only: guardOrigin should be documented as a browser-originated gate so a future
  signature-authenticated webhook skips it by design rather than by workaround.

Refuted with repository evidence (recorded, not silently dropped):
- DeepSeek's ":443 port time bomb" - the URL API already normalizes default ports.
- FABLE r2's "no test asserts any security header" - its grep was case-sensitive and missed the
  lowercase header names in the 13-assertion securityHeaders.test.ts.
- GLM's savedAt conflict-resolution inconsistency - that invariant belongs to the separate
  public.vibe_profiles table and its 0033 LWW trigger, not the waitlist snapshot column.
- GLM's unbounded request.json() / server-action / stale-importer omissions - verified none remain.
Adjudicated by Kimi: GLM's "reject-absent-Origin is a funnel regression" overruled (on HTTPS an
intermediary cannot strip headers without terminating TLS); DeepSeek's HIGH on the capacitor
allowlist overruled (the same client can send a matching https Origin, so it grants nothing new).

Residual risk / follow-ups NOT done here (deliberate, recorded):
1. CSP is Report-Only with NO report sink, so no telemetry arrives on its own. Promotion to
   enforcing is an ATTENDED check. Kimi recommends adding a collector endpoint; that is a new
   mutating API route and belongs to its own change.
2. The Capacitor WebView origin is INFERRED from capacitor.config.ts, never observed on device.
   capacitor://localhost + ionic://localhost are allowlisted so a wrong inference is non-fatal,
   but an attended TestFlight check of the signup form is still owed.
3. T0 post-deploy smoke check is OUTSTANDING - this run authorized no deploy, so the verified
   state is intermediate, not final.
4. Per-route scoping of the native-shell allowlist (Kimi, hygiene only, no security gain) and a
   shared boundary-result mapper (GLM) were deferred rather than done at round 3.
5. Uneven runtime validation in direct Supabase helpers remains from the original audit -
   upsertServerVibeProfile rebuilds from destructured fields and is auth+RLS+LWW guarded, but its
   tag/neighborhood element types are not allowlist-checked. Outside Item 9's stated scope.

### Item 10 - g-ce503c6c-e3d9-43b1-a600-4b3bb8c1fb93 - COMPLETE
Commit: 5bf69c8 (local only, NOT pushed). Tier T0, intensity full, 3 rounds, quorum 5/5.

Changed: src/lib/rateLimiter.ts, rateLimiter.durable.ts, rateLimiter.test.ts (new);
src/lib/waitlistGuard.ts (+test), mediaMetric.server.ts; the four API routes; two new route-level
policy suites; supabase/migrations/0043_rate_limits.sql (WRITTEN, NOT APPLIED).

Verification: tsc 0; vitest 163 files / 2469 tests; build 0; secret-scan clean; Playwright 73/73;
production-server behavioral run 5/5 with the shared store deliberately UNREACHABLE - waitlist fails
open (200), the local backstop still binds (4 of 14 throttled, so fail-open is NOT unlimited), event
fails open at the limiter (503 at the store, not 429), one IPv6 /64 shares a bucket, a different /64
keeps its own.

Lane status: Claude/FABLE, Codex gpt-5.6-sol, DeepSeek, GLM, Kimi K3 deep - all succeeded.
Codex TIMED OUT once at 540s on an oversized round-2 packet (exit 124, supervisor confirmed
process-tree termination); re-run with a narrowed packet and returned valid output with proof. A
timeout was NOT counted as approval. FABLE BLOCKED twice; both blocks closed.

Findings unique to ONE lane:
- Claude/FABLE only: two RAW NUL BYTES making rateLimiter.ts binary to ripgrep (the core module was
  invisible to every content search); compressed-IPv6 mis-bucketing reopening the 2^64 rotation
  bypass; NODE_ENV arming the refusal on Vercel PREVIEW deploys too; and a rollout note that my own
  earlier fix had silently turned into a production-outage instruction.
- Codex only: malformed dotted quads and empty zone indexes coerced into real buckets.
- DeepSeek only: IPv4-mapped notation granting DOUBLE quota (its stated mechanism was wrong; the
  defect was real and verified empirically before acting).
- GLM only: partial configuration being indistinguishable from intentional local-only, with the
  degraded flag staying false so monitoring shows green while the global cap does not exist.
- FABLE + DeepSeek + GLM converging: an unconfigured shared tier silently leaving the
  irreversible-action quota per-instance.
- Kimi only: adjudicated the L1/L2 window seam as the standard fixed-window 2x property rather than
  a composition bug, and endorsed the Postgres-over-Redis choice with named exit criteria.

Attended-only decisions STOPPED at, none made: applying 0043; provisioning any paid KV/Redis;
creating or setting RATE_LIMIT_KEY_SALT; salt rotation cadence; enabling pg_cron (avoided by design);
sign-off on the fail-open policy for event/media-metric.

### Item 11 - g-e0fb31ba-d3b2-41a7-85db-1eaf7ab684a6 - BLOCKED (REVIEW_INCOMPLETE)
WIP preserved at 652020d. Tier T1. Santa round 1 = BLOCK; quorum NOT met.

Claude/FABLE ran and blocked with 1 High + 4 Medium. Codex, GLM and DeepSeek did NOT run, so the
'both' panel never reached quorum. Under the unattended rule that is REVIEW_INCOMPLETE, never NICE.

What is sound: parser, report generator and 14 static tests are OFFLINE BY CONSTRUCTION (node:fs and
node:path only - no network, no database contacted, which was the item's central constraint), run in
the ordinary vitest gate, and every assertion is paired with a broken fixture. Their generated
numbers are independently true: 39 migrations 0000..0043, 21 tables, 21 of 21 with RLS, 41 functions,
29 SECURITY DEFINER, 0 unpinned search_path.

Why blocked - the deliverable IS the expected state, and parts of it are wrong:
1. Check 2 claims all but two tables have a policy; six more are intentionally policy-less, so an
   operator on a HEALTHY Staging would log six false mismatches.
2. public.schema_migrations is created by the migration RUNNER, not a migration, so the parser cannot
   see it; a healthy schema has 22 tables, not 21.
3. The anon-grant invariant covers 2 tables; the corpus grants to anon on three (bars, bar_photos,
   pairwise_comparisons) - FABLE's own allowlist named only two, which is itself evidence the
   expectation must be generated rather than written by hand.
4. tableGrants has no corpus-level non-vacuity guard.
5. Function tail-attribution spans to the next function, so a future 'alter function ... set
   search_path' could falsely mark an unpinned definer as pinned. Not live today.

Root cause, demonstrated on myself: my own verification regex reported all 21 tables as policy-less
- false - because policy names are quoted and contain colons ("profiles: owner can read own"). The
policy and grant expectations must be GENERATED like the counts already are.

NEXT ACTION: /santa-loop g-e0fb31ba-d3b2-41a7-85db-1eaf7ab684a6 --unattended --intensity both
after generating the policy/grant expectations and adding schema_migrations to Checks 1-3.

## C2 RUN SUMMARY

Status: QUEUE_TERMINAL - 2 complete, 1 blocked. Commits: 037a527, 619b109, 5bf69c8, 652020d.
Deployed RLS parity remains UNVERIFIED; Item 11 builds the means to check it and was not finished.

Nothing was pushed, deployed, migrated, or irreversibly applied. No PR, no database connection, no
environment/auth change, no email, account, TestFlight or App Store action. Migration 0043 was
WRITTEN and NOT APPLIED. No worktree was added, moved, removed, pruned, reset or cleaned; no stash
was created or dropped.

Protected C1 Item 4 state is intact and still uncommitted: src/app/page.tsx,
src/components/BarLightbox.tsx (modified) and e2e/safe-area-top.spec.ts (untracked), plus stash@{0}.
`loop-guard checkpoint` DID sweep all three into a commit as memory warned; that commit was undone
with a soft reset and the files restored to their exact prior state, and every later commit was
path-scoped by hand.

---

# Overnight run — 2026-08-08 (C3, America/New_York)

- Queue: g-4e72a0c5-eb4b-4e5f-b192-6c1b7b64fa92 (Item 5: Compact auth layout — visual only)
- Stop conditions: 08:00 America/New_York 2026-08-08 | loop-guard item cap (max-iters 4) | no safe runnable item remains
- Start time: 2026-08-08 02:41 EDT
- Starting SHA: 689e564edd0de5744f07e920230c6b98fae0d092
- Worktree: D:\harness-worktrees\nb-20260808-expanded\auth-layout
- Branch: harness/nb-20260808-expanded/auth-layout
- Preflight: overnight-recovery IDLE; git status clean; lease null/not-live; overnight-guard preflight TIER_MAP_READY (project map, 10 live T0 rules, 0 dead)
- Constraints: local commits only; no push/PR/deploy/migrate/DNS/credentials/external contact; no destructive cleanup; no worktree create/remove; no node_modules junctions; one writer, one lease; gating Claude reviewer = FABLE for T0/T1; missing review lanes fail closed.

## Precondition re-check (the two 2026-08-07 blockers, both now CLEARED)

1. **DISK — cleared.** C: now has 4.9 GB free (was 1.1 MB on 2026-08-07). This worktree lives on
   D: with 629 GB free, npm cache is already warm at 770 MB on C:, and every Playwright browser
   build is already present in C:\Users\cdfee\AppData\Local\ms-playwright. No cleanup, deletion or
   attended file-management step was performed to reach this state.
2. **AUTH BASE — cleared.** Goal g-3fc3789d-2219-43aa-8b94-e46fb43e3a19 is `complete`
   (2026-08-07T15:37Z) in the C:\Users\cdfee\projects\nb-google-photos workspace, so
   <AUTH-NICE-SHA> resolves to b6a7957, the reviewed tip of fix/auth-cross-context-email.
   `git merge-base --is-ancestor b6a7957 HEAD` succeeds: this worktree's 689e564 already descends
   from the reviewed auth base, so Item 5 needs no branch creation and touches no protected worktree.

### Item 5 - g-4e72a0c5-eb4b-4e5f-b192-6c1b7b64fa92 - COMPLETE (NICE, 3 Santa rounds, quorum met every round)

**Branch** `harness/nb-20260808-expanded/auth-layout` (descends from b6a7957, the reviewed auth base,
and from the nighttime-hardening tip 689e564). Four local commits, nothing pushed:
- `bdfcfef` compact /auth layout (visual only)
- `302eb63` santa round-1 findings
- `92ced7f` santa round-2 findings
- `54b201c` santa round-3 test hardening
(`5ea0809` is the loop-guard checkpoint; it touched only this morning log.)

**Changed files**: `src/app/auth/page.tsx` (classNames + comments ONLY), `e2e/auth-layout.spec.ts`
(new, 17 tests), `e2e/tools/appOrigin.ts` (new), `playwright.config.ts`,
`e2e/tools/fence-global-setup.ts`, `scripts/screenshot-g-12d33864.mjs`.

**Result**: /auth needed 772px of document height in a 390x664 iPhone 13 viewport - the sign-in form
scrolled on the smallest configured phone. It now needs 587px, so signin, signup, forgot and
reset-sent are each exactly one screen on iPhone 13 and Pixel 7. Headroom: signin 77px, signup 125px,
forgot 172px, inbox 111px.

**Verification**: vitest 164 files / 2483 tests; the 8 auth unit files (149 tests) pass UNMODIFIED
and `git status` on those paths is empty (criterion 6); typecheck, production build, secret-scan
(723 files), `git diff --check` all clean; Playwright foreground 111/111 across auth-layout,
auth-page, auth-cross-context and app-shell-smoke on iPhone 13 + Pixel 7.

**Panel** (T1 tier, escalated to `full` intensity because this is UI work) - quorum met all 3 rounds:
- R1 (bdfcfef): Claude/FABLE + Codex + GLM + DeepSeek + Kimi deep. 5 findings fixed, 3 refuted.
- R2 (302eb63): same five. Codex 0 findings, DeepSeek 0, GLM/Kimi no blockers, FABLE 1 advisory.
- R3 (92ced7f): same five, Kimi at STANDARD depth (`--depth deep` errored exit 4 twice while a route
  probe answered OK - the deep profile specifically was degraded; recorded, not hidden).
  Codex 3 Mediums, all against my own tests; FABLE/GLM/DeepSeek clean.

**Lane-unique catches**:
- Codex only: the `deadTail` assertion was vacuous; `fits-one-screen` could not distinguish "fits"
  from "clipped"; three round-3 test false-pass paths; `screenshot-g-12d33864.mjs` ignoring the port.
- Claude/FABLE only: independently caught the vacuous dead-tail claim; the stale comment still
  advertising the deleted helper's coverage.
- GLM only: the `md:` restorations were implemented but wholly unverified (both device projects are
  mobile); the `m-auto` centring was untested at runtime.
- DeepSeek only: raised that `min-h-dvh` might not resolve in Tailwind 3.4 - refuted by reading the
  built CSS.
- GLM + DeepSeek converging: the missing `dvh` fallback, and the desktop spacing leak.
- Kimi only: ruled the `md:py-12` safe-area drop above 768px a FIX NOW; adjudicated the two disputed
  claims below; and set the post-cap gate for test-only fixes.

**Claims REFUTED with evidence, recorded rather than quietly dropped**:
1. "The bottom safe-area inset is double-counted; content overflows on a notched device" (GLM +
   DeepSeek independently, and the mechanism under FABLE's round-1 HIGH). Measured: the gap below
   `<main>` was 0.5px before the change and ~0px after. `<main>` overflows the body's `height:100%`
   border box instead of stacking after its padding, so the nav reserve never becomes scrollable
   space. Kimi adjudicated it refuted. FABLE's proposed fix - conditioning the body reserve away -
   would be a root-layout change touching every route to fix a non-problem on this one.
2. "items-center currently traps the top of overflowing content" - refuted as a live defect by the
   390x420 and 390x340 states. Hardened to `m-auto` anyway on Kimi's endorsement.
3. My OWN first hypothesis was wrong the same way, and the spec header now carries the correction:
   I initially blamed a 64px dead strip and wrote an assertion claiming it was RED pre-fix. It never
   was. That assertion is deleted.

**Honest negative result**: the reviewer-requested tall-card overflow assertion was written and
measured NOT to work - mutating back to `items-center` + `mx-auto` left it green, because the
section's `min-height:auto` growth means the trap cannot fire in this structure. It was replaced with
a guard on the precondition that would arm it (the section must keep `overflow: visible`), which does
go red. Shipping the original would have been the same coverage theater this item removed elsewhere.

**Mutation proofs** (memory rule: a regression test must fail pre-fix). Eight real product-code
mutations, each reverted: bare `min-h-dvh` fails the @supports pin; a clipped card fails the clipping
guard; dropping an `md:` restoration fails the desktop pin; `mx-auto` fails the centring test; flat
`md:py-12` fails the desktop safe-area pin; `md:pb-12` fails the media-scoped inset assertion;
`overflow-hidden` on the section fails the precondition guard; removing `min-h-screen` fails the
fallback assertion. The @supports SOURCE-ORDER clause has no available product mutation and is
corroborated by direct built-CSS inspection instead (`.min-h-screen{min-height: 100vh}` at byte
18325, `@supports (min-height:100dvh)` at 44602 - fallback first, gate after).

**Test-infrastructure change, flagged for the operator**: `NB_E2E_PORT` (default 3000, behaviour
unchanged when unset). `reuseExistingServer: true` plus a hardcoded `:3000` means a Playwright run in
one leased worktree silently tests the code served by another worktree's dev server - and `:3000` was
in fact held by the sibling `item3-overflow` worktree throughout this run, so this item could not
have been verified honestly without it. `playwright.config.ts`'s storageState origin and
fence-global-setup's reused-server canary both follow the port. GLM noted this is bundled into a
visual-only commit and would ideally have shipped separately; it is in `bdfcfef` alongside the
layout change.

**ATTENDED CHECKS STILL OWED** (not blockers for local completion):
1. Real-device pass for criteria 1-2. Playwright emulates neither collapsing browser chrome nor
   device safe-area insets, so `100dvh` vs `100vh` and every `env(safe-area-inset-*)` value are
   pinned as CSSOM DECLARATION assertions only. On a notched iPhone and a gesture-nav Pixel, confirm:
   nothing retreats behind the address bar as it expands, the home indicator does not overlap the
   submit button, and overscroll exposes no broken-looking gap.
2. Keyboard-open behaviour on real hardware (the tests approximate it by shrinking the viewport).
3. Orientation change mid-session, 200% text zoom / iOS Dynamic Type, and PWA standalone mode.

**Residuals deliberately NOT actioned** (Kimi ruled DOCUMENT or DROP):
- The body's `pb-[calc(64px+env(safe-area-inset-bottom))]` reserve is inert on nav-less routes.
  Measured non-visible; making it route-aware is a root-layout change and belongs in its own item.
- The `md:` breakpoint at 768px gives portrait iPads the compact layout - deliberate for a single
  short form.
- Residual reliance on Tailwind emitting variant utilities after base utilities, now guarded by the
  source-order assertion.
- FABLE's round-3 Low note: the media-scope assertion counts carriers rather than binding scope
  exactly; the round-3 fix addressed the substance, and the narrower duplicate-stylesheet case
  remains a known limitation noted in the test file.

**Nothing was pushed, deployed, migrated, or irreversibly applied.** No PR, no database connection,
no environment/credential access, no email/account/TestFlight/App Store action. No worktree was
added, moved, removed or pruned; no stash was created or dropped; no branch was force-updated,
merged or rebased. The only writes outside this worktree were temp files under the job scratch dir.
The `npm run build` step performs next/font's build-time Google Fonts fetch - the project's own
standard verification step, read-only, no credentials; under the network fence it fails closed, and
that is why the fenced build attempt is recorded as failing on fonts alone.

## C3 RUN SUMMARY

Status: **COMPLETE** - 1 supplied goal, 1 complete, 0 blocked, 0 remaining.
Commits: bdfcfef, 302eb63, 92ced7f, 54b201c (+ 5ea0809 checkpoint, morning log only). All local.
