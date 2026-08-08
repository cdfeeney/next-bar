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
