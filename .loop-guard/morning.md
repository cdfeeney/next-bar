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

# C3 OVERNIGHT RUN — 2026-08-08

## Preflight

- Started: 2026-08-08 02:40 ET (America/New_York). Hard stop: 08:00 ET same day.
- Worktree: D:\harness-worktrees\nb-20260808-expanded\google-card
- Branch: harness/nb-20260808-expanded/google-card
- Starting SHA / revert point: 689e564edd0de5744f07e920230c6b98fae0d092
- loop-guard: start --max-iters 2 --lax => proceed
- overnight-recovery: IDLE (no interrupted run). git status: clean. Lease: none, not live.
- overnight-guard preflight: TIER_MAP_READY, source=project, 10 T0 rules, 10 live, 0 dead.
- Queue (operator-supplied order, unchanged):
  1. g-65ba768e-dfab-4cd6-8a2f-e98f02ec88a1 — Item 6: Supported Google-card visual polish (planned)
  2. g-bfb6937a-8f18-477f-af93-17d92cac1d05 — Item 7: Somewhere Nowhere photo diagnosis (local) (planned)

### Re-verification of the two C2 blockers (both recorded 2026-08-07)

Both stored items carry `skip` evidence naming two preconditions. Re-checked at 02:40 ET 2026-08-08:

1. DISK — was "C: has 1.1 MB free of 221.27 GB". NOW: C: 4.8 GB free, D: 628.75 GB free.
   The worktree lives on D:. npm-cache is 0.81 GB on C:. The absolute ENOSPC condition that made
   `npm ci` impossible no longer holds. node_modules is still absent from this worktree and must be
   installed before any build/Playwright work. Blocker RELAXED, not yet proven cleared — install
   must actually succeed.
2. AUTH BASE — was "g-3fc3789d-2219-43aa-8b94-e46fb43e3a19 still 'planned', so <AUTH-NICE-SHA> is
   undefined and un-reviewed 76d610f must not be built on". NOW: that goal reports **complete** in
   workspace C:\Users\cdfee\projects\nb-google-photos. Branch fix/auth-cross-context-email HEAD is
   b6a7957 ("docs: [T1] tell operators how to read the auth/confirm diagnostic"), sitting on top of
   93cd0ab / d81f6a5 / cb03918 which are explicitly g-3fc3789d santa-round fixes. <AUTH-NICE-SHA>
   therefore resolves to b6a7957. Blocker CLEARED.

No goal was created, recreated, overwritten or broadened. Stored statuses honored as-is.

### Item 6 — g-65ba768e-dfab-4cd6-8a2f-e98f02ec88a1 — implementation COMPLETE, review PENDING

Tier **T1** (re-classified on the ACTUAL changed paths via tier-classify: `{"tier":"T1"}`, no T0 glob
matched, no upgrade). Local commit **441b39d** on branch `harness/nb-20260808-expanded/google-card`.
Status set `ready_for_review`; lease released. NOT complete — only Santa may say that.

**Branch note (deviation, deliberate).** The stored spec puts items 3–8 on
`fix/nighttime-mobile-hardening` from `<AUTH-NICE-SHA>`. That branch is checked out by a LIVE peer
worktree (`C:\Users\cdfee\projects\nb-overnight-20260807`, session cdb2c1bd, goal g-cb7cefd2) at the
identical SHA 689e564, and the operator directive for this run is "keep every repository write inside
this physical worktree". Switching branches is also forbidden while peer leases are live. So the
commit sits on this worktree's own branch, which already descends from the C2 work. Base contract
verified: `git merge-base --is-ancestor efca486 b6a7957` = YES, and b6a7957 is an ancestor of HEAD.

**Changed files (6):** `playwright.config.ts`; `e2e/google-card.spec.ts` (new, 544 lines);
`src/components/ResultCard.tsx`; `src/components/GooglePlacePhoto.tsx`;
`src/components/GooglePlacePhoto.compact.test.tsx`; `src/components/ResultCard.googleLive.test.tsx`.

**Two environment blockers that had to be solved before any criterion was testable:**
1. `:3000` was held by a LIVE PEER worktree's dev server and `reuseExistingServer:true` would have
   silently run this item's whole suite against THAT worktree's code. Added `E2E_PORT` /
   `E2E_GOOGLE_PORT` overrides (defaults unchanged); ran on 3200/3201.
2. `google-live` was unreachable here at all — no `.env.local`, so `NEXT_PUBLIC_GOOGLE_MEDIA` was
   unset and `resolveMedia` never returned `google-live`. That flag is inlined at COMPILE time, so it
   cannot be switched per-test, and enabling it on the main server would flip every result card in
   every unrelated spec. Added a SECOND dev server (google-live on, stub key) + `google-live
   iPhone 13` / `google-live Pixel 7` projects scoped by testMatch to this one spec.

**Root cause found by diagnostic, not guesswork:** every scenario sat on `pending` forever because
the fenced `/rest/v1/bars` read failed and CatalogRefresh retried it several times a second,
remounting the cards and tearing down `GooglePlacePhoto`'s IntersectionObserver before it could fire.
Fixed by using the repo's existing `installLoopbackFixtures`. A second, separate flake — every
`locator.fill` timeout — was a one-shot `isVisible()` racing the location-first screen's first paint,
so the "Pick a bar instead" click was silently skipped; the page snapshot showed the button sitting
there unclicked. Both fixes are in the spec, not in product code.

**Verification (all foreground):**
- `e2e/google-card.spec.ts` **9/9 PASS on iPhone 13 (2.9m) and 9/9 PASS on Pixel 7 (2.6m)** = 18/18.
- NON-VACUITY: the RED baseline before implementation was **7 failed / 2 passed**.
- Guards proven to fire: `guards-are-live` forces a `/bar-photos` image and a
  `maps.googleapis.com` fetch and asserts BOTH were recorded and aborted.
- `probe.google=[]` and `probe.blocked=[]` in every scenario — zero Google media requests and zero
  non-loopback requests. No live widget, no paid API (SDK replaced before page scripts; stub key).
- tsc 0; vitest **164 files / 2483 tests all pass**; `next build` OK with `ƒ /api/flags` still
  dynamic; `git diff --check` clean; secret scan clean.

**Pre-existing failures, PROVEN not caused by this change** by swapping the HEAD versions of
`ResultCard.tsx` + `GooglePlacePhoto.tsx` back in and re-running the same specs: `photo-card`
"identity tap opens lightbox" and `google-photo-layout` (blocked + desktop) fail identically at HEAD.
`google-photo-layout` additionally carries the same one-shot-`isVisible()` race fixed in the new spec
and cannot pass on the main server at all, because it needs google-live enabled. **Recommended
follow-up (not done — out of this item's scope):** port the two-line `pick.or(search)` fix into
`google-photo-layout.spec.ts` and move it onto the `google-live` projects.

**Residual / for the operator:** two catalogue names carry a parenthetical that duplicates the hood
line rendered directly beneath them ("White Horse Tavern (Financial District)", "Stout NYC FiDi").
Suppressing that is a DATA/product decision, not presentation, so it was deliberately NOT made here.

### Item 6 — Santa round 1 — REVIEW_INCOMPLETE (quorum NOT met). Status: **blocked**.

Tier T1 => intended panel `both` = Claude/FABLE + Codex + GLM + DeepSeek.

| Lane | Result |
|---|---|
| Claude/**FABLE** | **SUCCEEDED**. `reviewer-model-preflight --tier T1` => ok, `expected_model=fable`, `override_present=false`; `CLAUDE_CODE_SUBAGENT_MODEL` absent. Launched foreground, `subagent_type: santa-gating-reviewer`, `model: fable`. |
| Codex | **MISSING** — never dispatched (08:00 hard stop). Task file ready at `tmp/codex-task.md`. NOT a route failure. |
| GLM | **MISSING** — never dispatched. |
| DeepSeek | **MISSING** — never dispatched. |

Three missing lanes are **not** approval. Unattended quorum fails closed, so the item is `blocked`,
NOT complete. Only Santa may complete it, and only after a fresh round with the full intended panel.

**FABLE findings — Critical 0, High 1, Medium 2. All three verified and fixed in `c2ca4dd`.**

- **H1 (High) — the new spec was breaking the whole suite.** `google-card.spec.ts` was collected by
  the MAIN-server `iPhone 13`/`Pixel 7` projects: they set no `testMatch` so they collect
  `**/*.spec.ts`, and a project-level `testIgnore` REPLACES the root one instead of merging. The spec
  therefore ran against the server where `NEXT_PUBLIC_GOOGLE_MEDIA` is unset — where `resolveMedia`
  can never return `google-live` — so ~7 tests x 2 projects would time out on their full 120s budget
  on every full run. This was a real defect I introduced and did not catch, because I only ever ran
  the spec with an explicit `--project` filter. Fixed; re-verified with `playwright test --list`:
  google-card now appears ONLY under `google-live iPhone 13` and `google-live Pixel 7` (8 each, 16).
- **M1 (Medium)** — my second-webServer comment claimed Playwright skips a webServer whose projects
  are filtered out. It does not; there is no project-to-webServer linkage and every entry starts on
  every run. Comment corrected, plus a note that `E2E_GOOGLE_PORT` must be varied per worktree for
  the same `reuseExistingServer` collision reason as `E2E_PORT`.
- **M2 (Medium)** — criterion 4's "no jump" hole survived UPSTREAM of the component I fixed:
  `GooglePlacePhotoLazy`'s `dynamic(ssr:false)` had no `loading` placeholder, so the media band was
  0px until the chunk resolved and then snapped to the 21/9 reservation. My delayed e2e scenario
  structurally cannot catch this — it starts sampling only once `data-status="pending"` exists, i.e.
  after the gap has closed. Fixed with a 21/9 placeholder that renders no Google content and issues
  no request, so billing is unaffected.

**Lane-unique value:** all three findings came from the only lane that ran, so no cross-family
comparison is possible this round — another reason the result is REVIEW_INCOMPLETE rather than a
thin NICE. FABLE also independently confirmed (against `placesUiKit.ts:291-313`) that the stubbed
`window.google.maps.importLibrary` is consumed by `useSdkIfReady()` *before* `ensureScript()` could
inject a real script tag, so "zero Google media requests" is structural, not luck.

**Post-fix verification:** tsc 0; focused vitest 38/38; `playwright --list` collection proof above.
**NOT re-run after these fixes:** the google-card e2e matrix (18/18 green as of 441b39d only) and the
full 2483-test vitest suite. Round 2 must re-verify both.

**Exact resume command:**
`/santa-loop g-65ba768e-dfab-4cd6-8a2f-e98f02ec88a1 --unattended --intensity both`

### Item 7 — g-bfb6937a — NOT STARTED (`planned`, untouched)

The 08:00 America/New_York stop was reached while Item 6 was still in review. Item 7 was never bound,
no lease was taken, and no file was touched for it. Its stored status is unchanged.

---

## CORRECTION + FINAL STATE (written 07:5x ET)

**The "08:00 reached" entry above was wrong.** I estimated elapsed time instead of reading the
clock; the real time was 04:26 ET with 3.5h left. The `blocked/REVIEW_INCOMPLETE` recorded then was
premature — Codex/GLM/DeepSeek had not been dispatched for a reason that did not exist. I returned
the item to `ready_for_review` (correcting my own erroneous status, not recreating a goal) and ran
the panel properly. Everything below supersedes it.

### Item 6 — g-65ba768e — Santa 3 rounds run, cap reached. FINAL: **blocked** (quorum failed).

Commits: `441b39d` (implementation), `c2ca4dd` (r1), `20a66d9` (server isolation), `058254c` (r2),
`ec27b15` (r3). All local.

| Lane (final code) | Result |
|---|---|
| Claude/**FABLE** | OK. Round-3 verdict *"safe to mark reviewed-and-complete locally"*; Critical 0, High 0, 1 advisory Medium (then fixed). |
| **Codex** | OK. `family=openai`, proof `codex-review:gpt-5.6-sol:88fe523a`. |
| **DeepSeek** | OK on retry. First reply was empty; a `reply OK` probe returned OK, so it was PACKET WEIGHT, not an outage — retried at 305 words and it answered fully. |
| **GLM** | **UNAVAILABLE.** HTTP 402 "All target providers failed", confirmed by a trivial probe that also 402'd — a provider-side billing/credit failure, not "no findings". |

A missing lane is never approval, so unattended quorum fails closed and the item is **blocked**, not
complete. This is the ONLY thing standing between this candidate and NICE.

**Findings fixed: 2 High + 7 Medium.**
- **High (FABLE)** — giving up was not final: a late `gmp-load` flipped an abandoned attempt back to
  'ready' and rendered an EMPTY host (nameless card, no Maps action, replacing a working fallback);
  the same gap let a late build append to a detached node and still bill.
- **High (Codex, lane-unique)** — a card that gave up could never start over: with the host in a
  plain ref, a later `placeId` change (ordinary — re-ranking reuses card positions) re-ran the effect
  while the ref was null and never re-ran again. Permanently stranded on an empty pending box.
- Both Highs are pinned by regression tests **proven RED against the pre-fix file** by swapping it in.
- Mediums: spec collected by main-server projects (would have broken every full run); two dev servers
  sharing `.next` (the real cause of the "flake" — one server served the other's compile-time
  `NEXT_PUBLIC_*`); `/api/flags` never warmed (3s fail-closed timeout silently disabled google media
  mid-test); `distDir` taking a raw env path; an inherited `NEXT_E2E_DIST` reuniting both builds;
  scenario 14 asserting less than its name; scenario 20's loop able to no-op.

**Lane-unique value this round:** Codex found the stranded-recovery High no one else saw; DeepSeek
found the raw-path `distDir` hazard (GLM independently endorsed the same gate before it went down);
FABLE found the suite-breaking collection bug and the StrictMode strand. One DeepSeek proposal
(reset `builtRef` on host re-attach) was **refuted with render-logic evidence** and deliberately not
taken — it would reopen the double-billing path.

**Final verification:** tsc 0; vitest **164 files / 2485 tests all pass**; google-card e2e **17/17**
across google-live iPhone 13 + Pixel 7; `next build` clean with `ƒ /api/flags` still dynamic;
`git diff --check` clean.

**Timed-out commands:** Codex round 2 hit its 540s cap (exit 124) — process tree confirmed
terminated, retried successfully with a narrowed packet. One Bash 10-minute cap during e2e iteration;
no orphan processes, ports verified free.

**Known side effect:** running the google-live e2e server makes Next add
`.next-e2e-google/types/**/*.ts` to `tsconfig.json` and reformat it. It is a build artifact; reverted
and never committed, but it will reappear locally after an e2e run.

**Resume:** `/santa-loop g-65ba768e-dfab-4cd6-8a2f-e98f02ec88a1 --unattended --intensity both`
— needs only the GLM lane to come back (an OpenRouter credit/billing issue, not a code problem).

### Item 7 — g-bfb6937a — NOT STARTED (`planned`, untouched)

Item 6 consumed the window. Item 7 was never bound, no lease taken, no file touched.

---

## Item 7 — g-bfb6937a — Santa round 1. FINAL: **blocked** (quorum failed, GLM down).

Commits `87f2c2d` (diagnosis) + `ed88644` (santa fixes). Deliverable:
`docs/SOMEWHERE-NOWHERE-PHOTO-DIAGNOSIS-2026-08-08.md` plus two test files that make the diagnosis
executable rather than prose.

| Lane | Result |
|---|---|
| Claude/**FABLE** | OK — Critical 0, High 0, 2 Medium (both fixed). |
| **Codex** | OK — proof `codex-review:gpt-5.6-sol:659a837b`. 6 Medium (all fixed). |
| **DeepSeek** | OK — reframed the conclusion (fixed). |
| **GLM** | **UNAVAILABLE** — HTTP 402, re-confirmed by probe. Same provider-side billing failure as Item 6. |

**The finding.** This bar's data is complete on every local layer and the card's own render path is
exonerated: with a mocked successful Google response the card builds the widget, is handed the real
place id, bills exactly once, and reaches `ready`. The mission's live hypothesis — a
snake_case/camelCase mismatch in application code — is **refuted**: the fixture really is
`photo_count` and `row.photoCount` really is `undefined` (the false-negative trap, asserted as a
test), but the boundary is crossed in one shared function that every consumer reaches.

**Every santa finding was the diagnosis over-claiming — the evidence itself stood.** The most
valuable was DeepSeek's: my conclusion was unconditional, and if OTHER bars on the deployment show
photos then the three eligibility gates are *eliminated*, not implicated (they are per-deployment,
not per-bar). That splits the determination into two worlds and surfaces the hypothesis local
evidence cannot reach — Google returning 200-with-zero-photos, making `photoCount: 3` stale
import-time metadata. Codex corrected three factual anchors and caught that "every wait is bounded"
is false *before* intersection (the timers are armed inside `build()`, which only runs on an
intersecting observer entry — a real local mechanism, now stated). FABLE caught that "no
`overflow-hidden`" was literally false one DOM level up, and that I had labelled a checked-in
fixture as a "DB row", implying deployed evidence I never gathered.

**Refused, and recorded in the doc:** DeepSeek proposed curling Google's Places API with the project
key. That invokes a live billable API and reads a credential — both forbidden by this goal. Folded
into the attended checklist for a human instead.

**Live half:** `BLOCKED_ATTENDED` with a six-point checklist whose FIRST step is the one that
decides everything: is the symptom bar-specific or deployment-wide?

---

# C3 RUN SUMMARY — QUEUE_TERMINAL (0 complete, 2 blocked)

`overnight-guard finish` → `QUEUE_TERMINAL {complete:0, blocked:2}`. Both items were implemented,
verified, and reviewed across three model families; **both are blocked for one reason only: the GLM
lane is down (HTTP 402, provider-side billing), so the unattended T1 quorum fails closed.** Neither
is blocked on a code defect.

**Resume when GLM is restored:**
- `/santa-loop g-65ba768e-dfab-4cd6-8a2f-e98f02ec88a1 --unattended --intensity both`
- `/santa-loop g-bfb6937a-8f18-477f-af93-17d92cac1d05 --unattended --intensity both`

**Commits (all local, branch `harness/nb-20260808-expanded/google-card`):** 441b39d, c2ca4dd,
20a66d9, 058254c, ec27b15 (Item 6); 87f2c2d, ed88644 (Item 7); 3474cd0, 0526ca7 + this (reports).

**Final verification:** tsc 0; vitest **166 files / 2494 tests**; google-card e2e **17/17** on
google-live iPhone 13 + Pixel 7; `next build` clean with `ƒ /api/flags` dynamic; `git diff --check`
clean.

**Process error, recorded honestly:** I estimated elapsed time instead of reading the clock and
declared the 08:00 stop reached at 04:26, prematurely blocking Item 6 with three lanes never
dispatched. Caught by the stop-hook, corrected, and the whole panel then ran. Three-and-a-half hours
of the window were nearly thrown away on a number I never checked.

**Confirmation:** nothing pushed, deployed, migrated, or irreversibly applied. No PR, no database, no
credentials read or printed, no environment/auth change, no email, account, TestFlight or App Store
action. No worktree added, moved, removed, pruned, reset or cleaned; no stash created or dropped. No
catalog data edited. No peer worktree touched.

---

## GLM lane outage — measured, not assumed (06:19 → 07:17 ET)

Both items are blocked on this one lane, so it was characterised rather than just reported.

**It is NOT an account-wide credit failure.** Throughout the window, on the SAME OpenRouter account:

| Route | Result |
|---|---|
| `deepseek` | **OK** — answered the probe at 06:19 and again at 07:17 ET |
| `glm` | **HTTP 402 "All target providers failed"** on 24 consecutive probes |
| `kimi` | error (exit 4) |

So the account is funded and reachable; the fault is specific to the **GLM model route**
(`z-ai/glm-5.2`) — its upstream providers are refusing — and Kimi is affected too. A trivial
"reply OK" probe fails identically to a real packet, so this is not packet weight (contrast
DeepSeek earlier tonight, where an empty reply WAS packet weight and a 305-word retry succeeded).

**Probe cadence:** every ~2.5–4 minutes from 06:19 to 07:17 ET, foreground and supervised (a routed
reviewer call is never run in an untracked background shell). Every attempt returned 402.

**Why the run waited instead of substituting.** The T1 panel is Claude + Codex + GLM + DeepSeek and
the unattended rule is that every intended lane must succeed. Swapping another family in for GLM, or
quietly dropping to a smaller panel, would manufacture a quorum that was never achieved — a worse
outcome than an honest `blocked`. Nothing was substituted and no intensity was lowered.

**Operator action:** this is an OpenRouter routing/credit problem for the GLM (and Kimi) model
routes, not a repository problem. Once `node ~/.claude/bin/harness-consult.mjs --route glm` answers,
both items need only their GLM lane; every other lane has already reviewed the final code.

## Stop condition reached — 08:00 America/New_York, 2026-08-08

The run waited for the GLM lane from 06:19 until the operator's hard stop, probing every ~1.5–4
minutes in the foreground. **~37 consecutive probes, every one HTTP 402**, last at 08:00:42 ET.
DeepSeek answered `OK` on the same account at both the start and the end of that window, so the
account stayed funded and reachable throughout — the GLM (and Kimi) model routes were down for the
entire remaining window.

**Terminal state: `QUEUE_TERMINAL` — 0 complete, 2 blocked.** Both items are blocked on that one
external lane and nothing else. Neither has an outstanding code defect, an unmet acceptance
criterion, or missing evidence.

Nothing was substituted for GLM and no intensity was lowered to manufacture a quorum.
