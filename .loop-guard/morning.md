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
