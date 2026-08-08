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

# OVERNIGHT RUN C3 — 2026-08-08

Launched: 2026-08-08 02:39 America/New_York
Hard stop: 2026-08-08 08:00 America/New_York
Item cap: 4 (loop-guard --lax)
Worktree: D:\harness-worktrees\nb-20260808-expanded\release-addendum
Branch: harness/nb-20260808-expanded/release-addendum
Starting SHA / revert point: 689e564edd0de5744f07e920230c6b98fae0d092
Queue (operator-supplied, in order): g-e82c72a8-023a-4b49-bcd1-2826556d5175

Preflight: overnight-recovery IDLE; git status clean; lease null/live:false;
overnight-guard preflight TIER_MAP_READY (project map, 10 T0 rules, 0 dead).
Controller first action: /code g-e82c72a8-023a-4b49-bcd1-2826556d5175 (stored status: planned).

## C3 ITEM RESULT — g-e82c72a8 (Item 8: production-migration & release-readiness addendum)

Status: **COMPLETE**. Branch `harness/nb-20260808-expanded/release-addendum`.
Tier T2 (docs-only, `skippable:true`, `t0FileCount:0`). Santa intensity **upgraded** to `full`.

Commits (all local, all path-scoped by hand):
- `8b35a25` re-verify the addendum against the real web candidate
- `a357fef` santa round 7 — five lane-unique findings
- `03ba884` santa round 8 — the escape hatch, and stop by rule
- `8be7e1a` santa round 9 — conform the prose to the table, add the deletion gate
- `7c4d274` C3 run header (this log)

Changed file: `docs/PROD-MIGRATION-ADDENDUM-2026-08-07.md` only (900 lines).

### What actually happened

The deliverable already existed at `299473e` on `chore/prime-foundation`, unreachable from this
worktree's HEAD, and the mission required it on the hardening lineage. It was reproduced
byte-for-byte via `git show` (no checkout/merge/cherry-pick — two peer sessions held sibling
worktrees) and then **four things a re-run of its own commands falsified** were corrected:

1. **Stale facts.** The auth gate goal `g-3fc3789d` is now `complete`; `fix/auth-cross-context-email`
   advanced to `b6a7957` (`76d610f` is its ancestor); `fix/nighttime-mobile-hardening` exists at
   `689e564`. The doc's "un-reviewed auth base / branch could not be created" framing was false.
2. **Wrong ref.** The application enumeration had run against `src` at `99ff7b3` — the *migration
   packet* ref, not the web candidate (57 files / 7,014 insertions apart). Re-run at `689e564`:
   byte-identical for all three tables 0034 narrows, so the conclusion survived but its warrant did
   not.
3. **Enumeration gap.** `ratings` was never enumerated despite being one of the three tables 0034
   narrows. Six sites, four verbs, all granted.
4. **New substantive finding (§8b).** The candidate carries a 39th migration,
   `0043_rate_limits.sql`, absent from the frozen packet. `rateLimiter.durable.ts` calls
   `consume_rate_limit()` from it. On production defaults an unapplied 0043 **denies account
   deletion for every user** — via the fail-closed catch when the tier is armed, and via the
   `requireDurable` refusal when it is not.

### Reviewer lanes — 3 full panels, quorum met in all three

| Round | Claude/Sonnet | Codex (gpt-5.6-sol) | GLM | DeepSeek | Kimi K3 deep |
|---|---|---|---|---|---|
| 7 | OK | OK `6304f92b` | OK | OK | OK |
| 8 | OK | OK `ba166dd2` | OK | OK | OK |
| 9 | OK | OK `51ede660` | OK | OK | OK |

Claude lane = **sonnet**, correct for T2 (`reviewer-model-preflight` ok, no env override). Codex lane
was pre-probed with a **repo read** (counted 39 `.sql` files via a real shell exec), not a text reply.

**Every lane found something no other lane found.** Round 7: Claude — §12 still called `76d610f`
"un-reviewed" after §2 retracted it; Codex — the corrected `apply-migrations.ts` lines
(`:487`–`:503`; the doc cited `installBootstrapFixture`); GLM — §8b widened the migration set without
propagating into §3's scan scope or §10's revert table; DeepSeek — the scratch-DB falsifier was not
the cheapest, an existing test already covers the tier-layer half; Kimi — the quotability hazard and
the scope-dissolution argument. Round 8: four lanes converged on §8b's Disposition still encoding the
abandoned precondition, and Codex+DeepSeek found the missing table row —
`REQUIRE_DURABLE_RATE_LIMIT=0`, the escape hatch named in 0043's own header and absent from the doc.
Round 9: Claude+GLM — the sentence *introducing* the table still said "both configurations deny";
Codex+DeepSeek — row 3's "completely unlimited" overstated risk (`rateLimiter.ts:371` keeps
per-instance limiting); Codex — catch is `:420`, not `:422`; GLM — §12 never exercised account
deletion at all.

**Rejected on repository evidence (3):** DeepSeek's unset-salt claim (`:388` refuses); DeepSeek's
`:407` unattributed short-circuit claim (`aggregateIp` returns any colon-free key unchanged, so a
UUID never equals the `'unknown'` sentinel); GLM's prediction that §13 is a rollback runbook.

**Material disagreement, adjudicated:** GLM argued the round-8 stopping rule was falsified. Kimi
adjudicated against it — the table is correct, so the defect is stale prose adjacent to a correct
edit, not a new class. Adopted; **both** positions recorded in §14b.

### Timed-out command

Codex round 7, first attempt: exit **124** at 542s on an oversized packet. `bounded-run` reported
`terminated process tree rooted at pid 121280` — process-tree termination **confirmed** (not exit
125). Retried with a tighter packet and it succeeded. No other timeouts.

### Verification

Behavioral gate **skipped, justified**: tier T2 / `skippable:true`, markdown-only, no runtime
surface, and the item forbids executing SQL or contacting Production. Static loop
(build/type/lint/test) not runnable — `node_modules` absent; not installed, as a markdown file
cannot break the build. Static checks that did run and pass: `git diff --check` exit 0, no trailing
whitespace, secret scan clean, claim ledger 1–15 contiguous and ordered, 17 level-2 headings,
working tree clean. Frozen worktree `nb-prod-migrations-0042` re-verified **empty** at HEAD
`99ff7b3` (read-only `git -C`).

All 15 acceptance criteria audited **MET** by the round-7 Claude lane with independently reproduced
evidence; rounds 8 and 9 confirmed no criterion regressed.

### Carried risk — read before treating this as finished

Round 9's four fixes are the last edits and **received no independent pass**: the three-round review
budget was exhausted. This is disclosed inside the document (§14b) so a resumer verifies **that
four-item diff only** — the intro sentence, row 3's wording, the `:420`/`:422` citation, and the new
§12 gate — rather than re-reviewing 900 lines. All four are safety-monotone.

### Human decisions still required

1. The packet is **NOT APPROVED** and this item's completion does not change that. It is a reviewed
   local document, nothing more.
2. **The packet and candidate `689e564` must not ship as a pair as they stand** — decide 0043's
   disposition, the paired application SHA, and the value of `REQUIRE_DURABLE_RATE_LIMIT`, together.
3. Run the §14 requirement-6 checks in cost order: the unit test first (settles §8b's one unverified
   link with no database), then read-only Production queries for claims 5–8, then a scratch database.
4. Four assumptions (applied migration set, current grants, public-flag row count, restore
   capability) remain unsettleable by any amount of review.

Nothing was pushed, deployed, migrated, or irreversibly applied. No PR, no database connection, no
environment/auth change, no external system contacted, no credentials used. No worktree, branch or
stash was created, moved, removed, pruned, reset or cleaned; `chore/prime-foundation` and its
2026-08-07 commit chain are untouched. The `loop-guard checkpoint` adopted a clean HEAD and swept
nothing.
