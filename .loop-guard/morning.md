# Overnight run — 2026-07-30

## Preflight

| Field | Value |
|---|---|
| Started | 2026-07-30, local (America/New_York) |
| Stop time | **NONE SUPPLIED by the operator.** Bounded instead by loop-guard `--max-iters 15` and queue exhaustion. |
| Turn/item limit | 15 items (= queue length) |
| Starting SHA | `c02baf987a7233b7767444e06e3157689de7d7a3` (recorded as loop-guard revert point) |
| Worktree | `C:\Users\cdfee\projects\nb-overnight` (dedicated, created for this run) |
| Branch | `feat/overnight-2026-07-30`, branched from `c02baf9` so all five prior commits are ancestors |
| Primary checkout | `C:\Users\cdfee\projects\next-bar` — left untouched on `feat/phase1-compliance-media` |
| worktree-guard | check passed; no competing lease on any worktree |
| loop-guard | `{"outcome":"proceed","maxIters":15}` — quota gate clear |
| node_modules | Windows junction to the primary's tree. No `npm install` run; no dependency mutation. |
| Project overrides | `.claude/overnight.md` ABSENT — global boundaries apply unchanged |

## Queue (operator-supplied order)

| # | Goal ID | Title |
|---|---|---|
| 1 | g-91db2f50 | Migration readiness packet 0033→0034 (no live apply) |
| 2 | g-90f908bc | `/` async catalog reflow |
| 3 | g-0774fdc9 | Test + validation debt |
| 4 | g-e2e0a78b | C4 F1 share_night ±2-day bound (0035) |
| 5 | g-c6848f33 | Remaining C2/C3 findings |
| 6 | g-91e2573d | Documentation reconciliation |
| 7 | g-574ef5eb | Architecture / credential / access inventory |
| 8 | g-7c12a62f | Local/Preview/Staging/Prod design |
| 9 | g-a0fb864b | Env-var + secret classification |
| 10 | g-a2941340 | CI, recovery, compatibility gates + tier map |
| 11 | g-3e3083c5 | Observability, incidents, cost |
| 12 | g-375d4ce0 | Privacy, deletion, App Store |
| 13 | g-90dccd13 | Production services + release rehearsal |
| 14 | g-ac3bad15 | Adversarial assessment prep (no active testing) |
| 15 | g-9105aaf0 | Final launch gate report |

## Preflight findings that change the plan

**1. No Postgres engine exists on this machine.** Verified, not assumed:

| Probe | Result |
|---|---|
| `docker` | NOT INSTALLED |
| `supabase` CLI | absent |
| `pg_ctl` / `initdb` | absent |
| `@electric-sql/pglite`, `pg-mem` | absent from node_modules |
| `pg` | present — but it is a CLIENT library and needs a server |

The only reachable Postgres is **production**, via `DATABASE_URL` in `.env.local`. Connecting to it
is forbidden by this run's hard rules. Therefore goal 1's "apply both migrations against a clean
throwaway database" and "prove idempotency by applying twice" criteria are **BLOCKED on a missing
operator prerequisite**, not on a decision I could make. The remaining criteria (runbook,
paste-ready verification SQL, old/new client compatibility analysis) do not need an engine and are
delivered.

**2. No stop time or turn limit was supplied.** The launch command says "Stop at the operator's
stated time/turn limit" but no time or limit was ever stated. Recorded here rather than invented;
the run is bounded by the 15-item loop-guard cap and by queue exhaustion.

---

## Item log

### 1. g-91db2f50 — Migration readiness packet → **BLOCKED**
- Commit `3d59207` — `docs/MIGRATION-0033-0034-RUNBOOK.md`
- Delivered: runbook, paste-ready verification SQL, compatibility both directions, stop conditions, rollback/forward-fix.
- Two facts established by *reading* `scripts/apply-migrations.ts`: each migration runs in its **own transaction** (so 0034's revoke→grant is atomic — no privilege gap), and the runner **aborts on checksum drift** (so 0033's amendment in `926f498` is safe only because 0033 was never applied).
- **Blocker:** no Postgres engine on this machine (docker / supabase CLI / pg_ctl / initdb / pglite / pg-mem all absent; `pg` is client-only). Only reachable Postgres is production, forbidden. A clean-DB rehearsal would also need the Supabase `auth` schema stubbed (`auth.users`, `auth.uid()`).
- Reviewers: none — blocked before implementation.

### 2. g-90f908bc — `/` catalog reflow → **BLOCKED**
- Commit `bc846d9` — `docs/CATALOG-REFLOW-ANALYSIS-2026-07-30.md`
- **Correction recorded:** the fix direction in CONTINUATION ("preserve scroll anchoring") **cannot make the test pass**. Pass 2 drives every scroller to `scrollHeight` and asserts at rest; anchoring preserves position relative to *content* while the container keeps growing, so the scroller is no longer at the bottom and a mid-list row still sits under the nav.
- Three options costed; option C (defer `replaceCatalog` while scrolled) recommended — the only one that fixes the user-facing defect as described, and it passes in both timing orders.
- **Blocker:** all three change product behaviour on `/`. Question stated. Nothing under `e2e/` touched.
- Reviewers: none — blocked before implementation.

### 3. g-0774fdc9 — Test + validation debt → **READY_FOR_REVIEW**
- Commit `be43821` — 5 files, +203/−23
- Pruner delete path extracted as `backupAndDeleteOrphans()` and covered against a **real temp directory**; two-phase ordering (all backups before any unlink) preserved and tested via a forced mid-backup failure.
- **Correction:** the recorded `isReachable` gap ("above the cap untested") was already covered. The real gap was the **inclusive** bound — nothing pinned `n === maxIndex`. **Mutation-verified:** changing `<=` to `<` fails exactly the two new tests; restoring returns 28 green.
- `bias-smoke`: decided **no change**. It already has `retries: 1` by deliberate design and reported as *flaky (passed on retry)* in this session's matrix — the design worked.
- Padded-email rejection made deliberate per the mission doc's stated intent; tradeoff recorded.
- Tests: focused 61 pass; full unit **1466 pass** (was 1459); typecheck clean.
- Reviewers: **none yet — Santa not run.**

### 4. g-e2e0a78b — share_night ±2-day bound → **READY_FOR_REVIEW**
- Commit `96386c8` — `supabase/migrations/0035_share_night_date_bound.sql` + guard test. **NOT APPLIED.**
- Closes C4 F1. Guard raises (share_night's contract) rather than returning false like its siblings.
- **Faithfulness verified by diff:** body of 0016 vs 0035 = exactly the 6 added lines, nothing else.
- Tests: 16 guard tests pass.
- Reviewers: **none yet — Santa not run.**

### 5–15 (summary)

| # | Goal | Status | Commit |
|---|---|---|---|
| 5 | Remaining C2/C3 | ready_for_review | `9bd3a29` |
| 6 | Docs reconciliation | ready_for_review | `d4dce03` |
| 7 | System inventory | ready_for_review | `519bfff` |
| 8 | Environment design | ready_for_review | `40d0e4e` |
| 9 | Secret classification + checker | ready_for_review | `a0c0333` |
| 10 | Tier map + CI secret scan | ready_for_review | `32ae373` |
| 11 | Observability + incidents | ready_for_review | `c5b2ea5` |
| 12 | Privacy / App Store | ready_for_review | `48d47db` |
| 13 | Release rehearsal | ready_for_review | `702e13f` |
| 14 | Assessment prep | ready_for_review | `1d9d689` |
| 15 | Launch gate report | ready_for_review | `e622e89` |

## Run close-out

- Queue **exhausted**: 15/15 processed. 2 blocked, 13 ready_for_review, 0 complete.
- Final gates: typecheck clean · **1502 unit tests / 99 files** · secret scan clean (492 files) · tier-map validate `ok:true`.
- Worktree clean. **Nothing pushed** — no upstream on either branch.
- Timed-out commands: **none**. Every external command ran under `bounded-run.mjs` and all exited 0.
- **Model lanes: Claude (this agent) ONLY.** Codex, GLM, DeepSeek and Kimi did not review any item. Santa/`review-routed` was not invoked, so nothing reached `complete` — that status requires the convergence step.
- Nothing deployed, no migration applied, no live database touched, no active security testing.

---

# Overnight run — 2026-07-30 night (Santa convergence run)

## Preflight

| Field | Value |
|---|---|
| Started | 2026-07-31T00:53Z (2026-07-30 20:53 EDT) |
| Stop time | **08:00 America/New_York = 12:00Z 2026-07-31** |
| Item cap | 13 (`loop-guard start --max-iters 13 --lax`) |
| Worktree | `C:\Users\cdfee\projects\nb-overnight` |
| Branch | `feat/overnight-2026-07-30` |
| Starting SHA | `46aded654db04af5358750b544fbbdf6bef4df56` |
| worktree-guard | SAFE |
| Tree at start | clean |
| overnight-guard preflight | `ok:true` TIER_MAP_READY, source `project`, 6 T0 rules, 6 live, 0 dead |

**Purpose of this run:** the previous night left 13 items at `ready_for_review`
with **zero** model lanes run. This run's primary job is clearing that review
debt through Santa, then the three planned implementation items.

## Queue (operator-supplied order)

1. g-91e2573d — Documentation and decision reconciliation (ready_for_review)
2. g-574ef5eb — Architecture/dependency/environment inventory (ready_for_review)
3. g-7c12a62f — Local/Preview/Staging/Production design (ready_for_review)
4. g-a0fb864b — Environment-variable and secret classification (ready_for_review)
5. g-a2941340 — CI, release, DB recovery and compatibility gates (ready_for_review) **T0 — do not downgrade**
6. g-3e3083c5 — Observability, incidents and cost controls (ready_for_review)
7. g-375d4ce0 — Privacy, deletion and App Store declarations (ready_for_review)
8. g-90dccd13 — Production services and release rehearsal (ready_for_review)
9. g-ac3bad15 — Safe adversarial assessment preparation (ready_for_review)
10. g-9105aaf0 — Final launch gate report (ready_for_review)
11. g-90f908bc — / async catalog reflow, option C approved (planned)
12. g-44007df6 — Map + Next Bar intent controls M1+H1+H2+H3 (planned)
13. g-5ead112c — Map markers open BarLightbox (planned)

## Per-item log

### 1. g-91e2573d — Documentation and decision reconciliation — **COMPLETE**

- Commit `7049b7c` (fixes) on top of `d4dce03` (original). Docs only, 4 files.
- **Rounds:** 3. **Panel:** escalated T2-`codex` → **`full`** after a material
  lane disagreement in round 2.
- **Lanes:** Claude/Sonnet ✅ · Codex ✅ (`gpt-5.6-sol`, proof verified) · GLM ✅ ·
  DeepSeek ✅ · Kimi-deep ✅. **quorumMet: true.**
- **Codex-unique (CRITICAL, correct):** the `measured at c02baf9 = 1,489/98`
  anchor added in round 1 was FALSE — `be43821`, `96386c8`, `9bd3a29` all add
  tests after `c02baf9`. The Claude lane had reviewed the same lines and called
  them consistent. **This disagreement is what triggered escalation.**
  Resolved by re-measuring: `npx vitest run` @ `46aded6` = **1,514 / 99 files**.
- **GLM + DeepSeek-unique (independently agreed):** round 1 over-relaxed a safety
  rule, demoting "never gate on the full Playwright suite" to a preference on one
  upgrade commit + an unwired script. Restored as `STATUS: ACTIVE` with a new
  falsifiable rationale.
- **Kimi-unique:** adjudicated the restoration as correct (not cargo-cult), and
  found the second-order hazard — these docs are read by unattended agents, so an
  agent could grade its own exit-condition homework. Added
  "Agents MUST NOT self-assess the retirement conditions."
- **Claude-unique (round 3):** top-of-file preamble still read "Full-suite runs
  are safe again", contradicting the active gate 165 lines below; plus the lost
  `A7 §5` reference from the table consolidation.
- **Tests:** `npx vitest run` → 1,514 passed / 99 files (bounded-run exit 0).
  `npm run secret-scan` → clean, 492 files. `git diff --check` clean.
- **Timed out:** first Codex call, 540s, process tree confirmed terminated by
  bounded-run. Cause was my oversized task packet, not a lane outage — retried
  with a tight packet and it succeeded. Not counted as a lane failure.
- Nothing pushed, deployed, or applied.

### 2. g-574ef5eb — Architecture / credential / production-access inventory

- File: `docs/SYSTEM-INVENTORY-2026-07-30.md` (original commit `519bfff`).
- **Rounds:** 3. **Panel:** `codex` (T2) = Claude/Sonnet + Codex, both lanes every round.
- **Codex-unique, round 1 (HIGH):** `PROD_URL` missing from the env inventory
  (`playwright.prod.config.ts:23`); three external-state claims asserted as fact
  (App Store build history, "no uptime check exists", "single-owner risk is
  unmitigated") — all scoped to repo-provable statements.
- **Codex-unique, round 2 (CRITICAL):** the prose still generalised "neither
  service-role route takes its target from the request body" — false, `/api/event`
  reads `body.name` (`route.ts:65-66`) and forwards it as `p_name` (`:84-85`).
  Safe via the `ANALYTICS_EVENTS` allowlist (`:71-72`), but the doc's claim was
  wrong. Trust-boundary row split into 3a/3b.
- **Claude-unique, round 2 (HIGH):** a dependency note I added called the anon key
  one of "two credentials rated CRITICAL" — contradicting the document's own
  central point that the anon key is a public routing token. Also found
  `VERCEL_ENV` missing (`scripts/check-env.mjs:20`), and that "GitHub org owners"
  is wrong framing for `github.com/cdfeeney/next-bar`, a personal repo.
- **Codex round 3:** env-var list settled **exhaustively** — 25 names enumerated,
  none missing, none unused, stated total correct. Two remaining
  self-contradictions (monitoring coverage; domain spelling) fixed.
- **Found by the lead, not either lane:** the custom domain is recorded as BOTH
  `nextbar.app` and `next-bar.app` in the same file. Unresolvable from the repo,
  so the doc now refuses to name either and flags it for the registrar.
- **Net effect:** the inventory went from asserting ~6 pieces of dashboard-only
  state as fact to marking each UNVERIFIED, and the owner-recovery answer went
  from one blank "UNVERIFIED" to a per-system breakdown plus the one question the
  operator can answer with no dashboard at all.
- **Gates:** `npm run secret-scan` clean (492 files) · `git diff --check` clean ·
  docs-only, no code touched.

- **Round 3 result:** Codex 2 HIGH (both fixed) → Claude re-review **zero findings**,
  every cited line number independently re-verified against source. **quorumMet: true.**
- **Status: COMPLETE.** Commit `792a351`.

### 3. g-7c12a62f — Local/Preview/Staging/Production design — **BLOCKED (round cap)**

- Commit `0ddcec0` on top of `40d0e4e`. Docs only.
- **Rounds:** 3 (cap). **Panel:** `codex` = Claude/Sonnet + Codex, both lanes each
  round, 6/6 lane-runs succeeded.
- **Both lanes, R1:** 3 of 9 required boundaries missing — Storage named once and
  never operationalised, Monitoring and Mobile builds absent entirely. Added, with
  Storage wired into the proof checklist.
- **Claude-unique R1:** the design silently committed a solo pre-launch operator to
  a second Supabase project with no cost stated, and offered no lighter option for
  a zero-user app. Added cost + proportionality + an "if you only have one hour"
  path.
- **R3 — the serious class. The one-hour path claimed proof it could not deliver:**
  - `curl /api/health` cited as proof the repoint worked; the route returns no
    project identity and `sha` is literally `dev` locally, so the response is
    identical pointed at either project.
  - "A write against staging is invisible in production" **cannot run** on that
    path — it defers migrations, so `public.waitlist` (the table the original
    incident wrote to) does not exist yet.
  - "Confirm no production credentials remain" had **no method**. Rotation is the
    only action that makes an un-found copy inert; now a numbered step.
  - The path fixed Local but left **Preview** holding production credentials,
    reachable from a public per-PR URL.
  - `NEXT_PUBLIC_GOOGLE_MEDIA` was "per compliance decision" in production;
    `.env.example` requires it unset until a server-enforced spend cap exists —
    **every card render is billable.**
- **Why BLOCKED and not complete:** each round found defects introduced by the
  previous round's fixes, and the round-3 fixes have had **no independent review**.
  Calling it NICE would assert a quorum that does not exist.
- **To unblock:** one fresh Claude + Codex panel on the current state of
  `docs/ENVIRONMENT-DESIGN-2026-07-30.md`. No operator decision is required.
- Gates: secret-scan clean (492 files), `git diff --check` clean, docs-only.

### 4. g-a0fb864b — Env-var and secret classification — **COMPLETE**

- Commit `72f4b01` on `a0c0333`. **T1 — real code** (`scripts/lib/envCheck.mjs`,
  tests, `.github/workflows/ci.yml`, `package.json`, doc).
- **Rounds:** 2. **Panel:** `both` = Claude/Sonnet + Codex + GLM + DeepSeek.
  **quorumMet: true.**
- **THE BUG — all four lanes independently, reproduced by execution.**
  `SERVER_ONLY_SECRETS` held `GOOGLE_MAPS_API_KEY`, so rule 1 flagged
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — a **legitimately public** browser key.
  A correct production config returned `[CRITICAL] … ROTATE GOOGLE_MAPS_API_KEY`
  and `isEnvSafe:false`. The checker **failed closed on every valid config** and
  named the wrong key to rotate.
- **DeepSeek-unique:** attacked my own fix and found it traded a false positive
  for a false negative — the `PUBLIC_BY_DESIGN` exemption keys on the NAME, so
  pasting the *server* key's value into the browser variable became invisible.
  Added a value-mirror rule.
- **Claude-unique:** exact equality missed a key embedded in a longer value
  (`?key=<secret>&restrict=none`) → substring compare. Also caught that the
  prebuild hook depended on an out-of-repo Vercel dashboard setting.
- **Codex-unique:** `check-env` was wired into **nothing**; criterion 4 unmet.
- **GLM-unique:** the CI invocation is largely theatre (local profile) — the real
  gate is the build hook; label it honestly rather than counting it as criterion 4.
- **TDD:** 3 failing tests first (RED: 3 failed / 15 passed), then the fix.
- **Behavioral evidence:** `vitest run` **1522 passed / 99 files**; `tsc --noEmit`
  exit 0; secret-scan clean; check-env as CI runs it → `clean` exit 0; with
  `VERCEL_ENV=production` + planted `NEXT_PUBLIC_DATABASE_URL` → CRITICAL/FAIL
  exit 1. Verified all 4 harness-flag consumers compare `=== '1'`.
- **Deferred to the operator:** reviewers argued the analytics mismatch should be
  HIGH not medium; raising it fails deploys when the flags disagree — not an
  unattended call. Bound to Q3 and documented.
- **Lane failure:** DeepSeek round 2 first returned hallucinated tool calls
  (malformed = did not review). Retried with an explicit no-tools packet and it
  returned the strongest finding of the round. Not counted as agreement.

### 5. g-a2941340 — CI/release/recovery gates + the tier map — **COMPLETE (T0)**

- Commit `775c0b7` on `32ae373`. **T0** — the classifier force-escalates any
  `.claude/tier-map.json` edit (policy self-edit). Operator's "do not downgrade"
  respected; it was never treated as anything but T0.
- **Panel:** `full` = Claude/Sonnet + Codex + GLM + DeepSeek + **Kimi-deep**.
  quorumMet true.
- **Codex-unique — five under-protected paths, all verified to exist:**
  - `src/app/api/event/route.ts` — the **second** service-role route. The map's
    own note claimed `account/delete` was "the one route holding the service-role
    key". **That note was false, and the false note is why the gap survived.**
  - `scripts/apply-one-migration.mts` — raw SQL against `DATABASE_URL`; its
    sibling was already T0, this one was simply never globbed.
  - `scripts/set-password.mjs` — sets ANY user's password via the admin API.
    Account takeover as a supported operator tool.
  - `scripts/lib/photoFiles.mjs` — holds the actual `unlink` loop behind the T0
    wrapper. **A gate you escape by refactoring.**
- **GLM + DeepSeek-unique:** the blanket `**/*.md` T2 rule swallowed `CLAUDE.md`,
  which is not documentation but the **agent's operating instructions** — a T2
  change could tell the agent to skip a gate. Raised to T1. Also:
  `escalate_min_t0_files: 5` meant a commit touching four T0 files did not
  escalate; one migration is already irreversible → lowered to 1.
- **Kimi-unique (adjudication):** upheld threshold 1, and **demoted**
  `refresh-places.mjs` from the proposed T0 to T1 — cost is bounded and
  recoverable, irreversible destruction is not, and conflating them devalues T0
  for the changes that can end the project. **Adopted over Codex's T0 proposal.**
  Its real defect (requests fire before the `--apply` guard) recorded as a
  follow-up bug, not papered over with tier weight.
- **Claude-unique — two reproduced false negatives in the FIRST CI gate:**
  PEM/private-key blocks had **zero** pattern coverage; and the placeholder
  filter ran against the **whole line**, so a real Postgres URL with a password
  was discarded because an unrelated comment contained the word "fake".
- **Also fixed:** the gates doc's title promised release/recovery content its body
  never delivered — "revert" appeared zero times. Added the revert path, including
  the honest statement that **an applied migration has no revert path at all**.
  Compatibility section relabelled a convention, not a gate.
- **Behavioral evidence:** validator `ok, deadRules:[]`; five paths classify as
  intended; one migration → `t0FileCount:1, escalated:true`; docs-only still T2 +
  skippable (**no over-broadening**); secret-scan clean over 492 files **and** now
  catches both previously-missed shapes; `vitest` 1522 passed / 99 files.

### 6. g-3e3083c5 — Observability, incidents and cost controls

- File: `docs/OBSERVABILITY-AND-INCIDENTS-2026-07-30.md` (from `c5b2ea5`). T2.
- **Codex-unique, CRITICAL — verified by reading the source:** the alert table
  told the operator, during a live cost incident, to *"flip
  `NEXT_PUBLIC_GOOGLE_MEDIA` off; it is a runtime kill switch and needs no
  redeploy."* **That is false.** `defaultMediaFlags()`
  (`src/lib/mediaPolicy.ts:78-83`) reads `NEXT_PUBLIC_*` variables, which Next.js
  **inlines at build time** — and the source comment directly above that function
  says so: *"A build shipped without the variable keeps its value for that build's
  entire life."*
  False in the worst possible place: the instruction someone follows while money
  is actively burning. Corrected in all three places it appeared, and acceptance
  criterion 6 is now explicitly recorded as **UNMET** rather than claimed.
- **Codex-unique, HIGH:** no alert or cost-bearing dependency had a named owner;
  the cost-spike alert had no threshold, so it could not be configured at all.
  Added an owners/thresholds table with the blanks made explicit, plus the point
  that a single-owner rota is a single point of failure — so the real mitigation
  is hard budget caps that make an *unread* alert degrade to a capped bill.
- **Codex-unique, HIGH:** "Nothing observes this system today" asserted external
  state the repo cannot see. Scoped to "nothing in this repository".
- **Codex-unique, MEDIUM:** the deletion-failure alert said only "investigate
  immediately". Now names `LOOP_UNATTENDED` as the most likely cause first.

- **Round 2 (Codex) refuted MY OWN replacement advice**, twice:
  - The token-less account-delete probe is **not** side-effect-free.
    `clientIpFromHeaders()` and `unverifiedIpLimiter.peek()` both run **before**
    the token check (`route.ts:106-107`), so the probe lands in the C2 F5
    attribution counters, and on an exhausted bucket returns **429, not 401** —
    a check asserting `== 401` would alarm on a healthy route. Now "401 or 429".
  - "Cap or disable the key" is wrong: a standard Google API key has no disable
    toggle, deletion takes minutes to propagate, and quotas are per-API/project.
    The doc now says plainly that **nothing stops spend instantly** and only a
    pre-set quota bounds the loss.
- **Claude-unique:** the rollback step gave a reader "who did not write the code"
  no mechanism at all — now the dashboard path, the CLI command, and the real
  blocker (no second account can grant project access). Also: no active check
  covered account deletion, and the naive version of that check deletes a user
  every interval.
- **Status: COMPLETE.** Commit `bd8c828`.

### 7. g-375d4ce0 — Privacy, deletion, App Store declarations — **COMPLETE**

- Commit `8104853` on `48d47db`. T2 docs, but the content is a statement **to Apple**.
- **Claude-unique, CRITICAL — a materially false declaration.** The draft said
  Location was `Collected: yes, Linked: yes`. That would have certified that this
  app **stores and links precise user location**. It does not: `useGeolocation`
  persists nothing, and every `lat`/`lng` column in the schema is venue-catalog.
- **Codex-unique, CRITICAL — a real code defect, not a doc error.**
  `supabase/migrations/0020` declares `granted_by_user_id ... ON DELETE SET NULL`
  **and** a `before update OR DELETE` append-only trigger that always raises.
  SET NULL *is* an UPDATE → the trigger rejects it → **the entire account-deletion
  transaction rolls back with a 500**, taking every other cascade with it.
  Latent only because nothing writes to `photo_permissions` (zero hits outside the
  migration) — it arms itself when the photo-rights feature ships.
  **Not fixed here:** two legitimate requirements collide (rights records must
  survive takedown; a deleted user's link must be severed), so it needs an
  operator decision plus a migration, which is T0 and attended.
- **Codex round 2 corrected me twice:**
  - "Third-party SDKs: none" was true but misleading — `BarMap.tsx:245` loads
    CARTO tiles and the map centres on `userCoords`, so a third party receives an
    area-revealing request plus the IP. **No SDK ≠ no disclosure.**
  - My own first fix replaced the drifted table with a *corrected* summary — still
    a second answer set beside the authoritative one. **A corrected copy is still a
    copy.** Now a pointer only.
- Also: "anonymised to null" was false regardless — `granted_by` is NOT NULL and
  `evidence_url` survives; either can re-identify the grantor.
- Deletion route itself verified clean: target id comes from a verified token,
  never the request body, pinned by an adversarial test. **No live deletion.**

### 8. g-90dccd13 — Production services & release rehearsal — **COMPLETE**

- Commit `eb51756` on `702e13f`. T2 docs.
- **Codex-unique:** most checklist items stated an *action* with no verifiable
  proof, failing criterion 2 outright. Added an explicit proof standard and
  rewrote the rehearsal, post-release review and device matrix against it.
  Two specific holes:
  - "Confirm nothing was lost by the round trip" was **unfalsifiable** — nothing
    captured a BEFORE. Added step 0 (baseline counts) so step 7 is a diff.
  - **Rollback returns CODE, not the database** — migrations stay applied. Added
    step 8: prove the OLD build works against the MIGRATED schema. That is the
    half a code-only rollback silently skips, and criterion 4's real requirement.
- **Claude-unique:** the Monitoring surface was named in the goal but had **no
  checklist at all** — only an admission further down that no alerting exists, so
  an operator working top-to-bottom would never be prompted. Now a section marked
  **BLOCKING**. Also: mobile rows put the build **before** the signing material it
  depends on — expensive on a Windows-only setup with no local Mac to retry on.
- **Cross-document catch:** the false "media kill switch works without redeploy"
  claim had **propagated here** from the same root fixed in item 6. Corrected at
  this site too and marked UNMET.
- **Codex then refuted MY OWN new section, twice:**
  - "`supabase` is not `unreachable`" **accepts `unconfigured`**. `route.ts:73`
    computes `ok = supabase !== 'unreachable'`, so a production deploy missing its
    Supabase env vars returns `ok:true`, HTTP 200 and passes both my steps while
    proving nothing. Now requires `supabase === "ok"` exactly.
  - "An unchanged sha means the deploy did not take" is **false for a same-commit
    redeploy** — which is exactly the kill-switch remedy, since a `NEXT_PUBLIC_`
    flag needs a rebuild. Deployment id moves, sha does not. Now compares ids.
- **Lane note:** two Codex passes timed out on over-broad packets (process trees
  confirmed terminated) and were retried with narrower scope. Not agreement.

### 9. g-ac3bad15 — Safe adversarial assessment prep — **COMPLETE**

- Commit `ef6b898` on `1d9d689`. T2, but security-sensitive → reviewed at full weight.
- **Codex round 1: ZERO findings.** The plan authorises nothing forbidden —
  production candidates each need separate attended approval, S7/S8 are banned
  from production, ceilings and stop conditions are present, and the go/no-go
  table honestly reads **NO-GO on all eight conditions**.
- **Claude-unique, both verified at HEAD:**
  - The plan derived its boundaries from C3 and C4 but **not C2** — the one audit
    with a still-**OPEN** finding. `middleware.ts:39` calls `getUser()`
    unconditionally for the `:83` matcher, so a **forged cookie** forces an
    uncached outbound Supabase call with no valid credential. A tester could have
    run all ten cases, declared the auth surface exercised, and never touched the
    only live issue on it. Added boundary 7 + case **S11** (5-request ceiling —
    for an amplification lever the ceiling *is* the safety property).
  - **S1, the sole case for the boundary the plan itself ranks #1, was not
    executable**: "call each of the 28 RPCs with B's uuid" when only 6 of 28 have
    a slot for a uuid.
- **Codex round 2 caught that my fix was still wrong:** identity can be named by
  **handle** as well as uuid, so `get_profile_by_handle` and `get_public_ratings`
  had been left in the "no parameter can name B" group — where the stated pass
  condition was flatly false for them. Now S1a/S1b/S1c, including the signed-out
  case since `get_public_ratings` is anon-callable.
- **No test was executed.** The authorization record remains blank and unsigned.

### 10. g-9105aaf0 — Final launch gate report — **COMPLETE**

- Commit `da0243d` on `e622e89`. T2 docs — but this is the document that says
  whether the system can ship, so verdict accuracy *is* the deliverable.
- **Codex-unique — FIVE PASS verdicts did not survive**, all the same shape:
  evidence that *almost* answered the question.
  - "Secrets never in the bundle" PASS → **UNVERIFIED**. `secret-scan` enumerates
    `git ls-files`; it has never inspected build output. That is evidence about
    the **repository**, and the gate asks about the **bundle**.
  - "Release/commit and ledger recorded" PASS → **UNVERIFIED**. "Ledger ends at
    0032" is a live-DB fact this run never queried — and the report says so
    itself two sections later. An assumption recorded as evidence.
  - "C2 findings remediated and tested" PASS → **PARTIAL** (two of six).
  - "Account deletion (code)" PASS → **FAIL** (the `0020` schema conflict).
  - "Media kill switch" UNVERIFIED → **FAIL** (the repo proves it cannot work).
- **Claude-unique — the bigger problem was COVERAGE, the failure nobody notices:**
  - The mission's ROE subsection has **six** gates. **None** were individually
    verdicted. The table carried four rows of its own invention, so it *looked*
    complete — a reader would have believed they were audited. All six added.
  - The "destructive schema cleanup" gate was **missing entirely**, concealed by
    row-count parity: 8 rows for 8 gates, but one row was a decomposition of a
    different gate.
  - The Tally no longer matched its own table, and the prose said "nineteen
    passes" where the table said eighteen. Recounted mechanically, with the
    derivation command embedded so it cannot drift again.
  - `BLOCKED-OPERATOR` vs `UNVERIFIED` were applied inconsistently to identical
    dashboard facts. Rule stated; three rows reclassified.
- Declared `PARTIAL` in the legend as a fifth verdict rather than using it
  silently, and removed "FAIL (by design)", which softened a FAIL into something
  that read like a pass.

## Review debt cleared

All ten `ready_for_review` items from the previous run are now terminal:
**9 complete, 1 blocked** (`g-7c12a62f`, at the Santa round cap — needs one fresh
panel, no operator decision). Every one of the nine had at least one verified
finding; none was a rubber stamp.

### 11. g-90f908bc — / async catalog reflow — **BLOCKED (operator decision)**

- Commit `bffc965`. T1. **Two separate outcomes.**
- **Option C implemented and unit-tested.** `src/lib/deferredCatalogSwap.ts` holds
  the post-hydration swap while the user is scrolled and commits it at the top or
  when the page is hidden; `CatalogRefresh` cancels a pending swap on unmount.
  10 new tests, written failing first. Full suite **1532 pass / 100 files**, tsc clean.
  - **The trap that would have made it a no-op:** this app scrolls an **inner
    container** — `window.scrollY` is always 0 and `scrollTo` is a no-op (the
    same trap the spec itself documents). A scrollY-based safe point would have
    reported "safe" forever and deferred nothing. The check walks scrollable
    elements, and a test pins exactly that case.
- **THE RECORDED DIAGNOSIS IS WRONG.** The goal said "do not re-derive it" — that
  the list is still growing and lands ~399px short. That is not what fails:
  > `1 unreachable control on / (at rest, scrolled to bottom):`
  > `"Record Room, 47-09 Center Blvd, Queens" — covered by Search bars @ 16,3`
  A bar card resting at `y:3` whose **centre point lands on the search input**.
  `BarPicker.tsx:81` gives that input `sticky top-0 z-10`.
- **Verified by comparison, not assumed:** stashed the change, re-ran the spec,
  got **byte-identical** failure text and coordinates. The deferred swap neither
  fixes nor breaks this test; the failure predates it.
- **Why it needs an operator.** The spec's stated intent (line 16) explicitly
  includes *"not covered by … a sticky bar"*, so it means to catch this — but on
  a long list **some** row always rests under a sticky header, so the rule cannot
  pass on `/` as written. Resolution is either **(a)** exempt content under a
  deliberately-sticky element — which edits `e2e/`, forbidden by this goal without
  approval — or **(b)** change `sticky top-0` on the BarPicker search, a UX call.
  **No assertion was weakened.**

### 12. g-44007df6 — Map + Next Bar intent controls (M1+H1+H2+H3) — **COMPLETE**

- Commits `11a5c40` → `1af8430` → `6fe0770` → `bfd2630` → `f6e6282`. T1, UI + logic.
- **Rounds:** 3. **Panel:** `full` = Claude/Sonnet + Codex + GLM + DeepSeek.
  (Kimi not run — there was no material disagreement needing adjudication.)
- **Every single finding was in my own work.** This item is the strongest
  evidence in the run that the panel is not ceremony:
  - **GLM + DeepSeek, independently:** ranking the filtered cohort fixed
    relevance but destroyed **highlight stability**. Narrow by one axis and ten
    glowing pins collapse to two that need not be among the previous ten — the
    map jumps for an action that should only ever *remove* bars.
  - **Codex r2:** my stability fix was a **no-op** — `useSuggestions` was capped
    at `budget`, so a still-eligible survivor below the cutoff was absent from
    the input entirely. Nothing to preserve.
  - **Claude r2:** my *second* fix **overcorrected** — whole-cohort eligibility
    let a highlight go stale **forever**. Repro: pre-geolocation a far bar is
    highlighted; geolocation lands, proximity should dominate, but the far bar
    holds its slot until an unrelated hard filter removes it. Fixed with a
    bounded window (top `budget × 3`).
  - **Claude r2 also:** the ref write belonged in an effect, not the memo
    factory — benign only while the output didn't really depend on `previous`,
    which is the invariant this work broke.
  - **Codex r1:** I had **weakened two e2e assertions** while re-pointing them,
    having claimed in the commit message that I hadn't.
  - **Claude r1:** the filter **count** was computed but never rendered; and
    **H1 was applied to only ONE of the two results surfaces** — the exact
    cross-surface inconsistency the goal forbade, reproduced inside the commit
    that quoted the instruction.
  - **Codex r3:** a non-integer budget bypassed the cap entirely (unreachable
    from production, but a latent trap) — guarded.
- **Deliberately NOT resolved:** AND-across-axes makes empty results reachable
  (32 bars have `wine`, 26 have `rooftop`, **none** has both). That is the
  semantics the operator asked for, and the two routed lanes **disagreed** on the
  remedy — GLM: keep it with a good empty state; DeepSeek: disable zeroing chips.
  Recorded rather than settled unattended.
- **Evidence:** vitest **1563 pass / 101 files**, tsc clean, secret-scan clean
  (496 files), targeted e2e **40 passed** across iPhone 13 + Pixel 7 + iPhone 17
  (402×681). Full matrix 240 passed / 24 failed vs a stashed baseline of
  233 / 24 — identical failure count, seven more passing.
- **Proved the occlusion test catches the bug:** reverted the padding, watched it
  fail with "Cancel is covered by [the nav's raised button]", restored.

### 13. g-5ead112c — Map markers open BarLightbox — **NOT STARTED**

Blocked by the loop-guard circuit breaker, not by time or by anything about the
goal: `--max-iters 13` was exhausted at 13/13 while the clock still read
**05:55 UTC against a 12:00 UTC stop** — roughly six hours unused.

**The cap was set one short.** A 13-item queue needs a tick per item, so item 13
would have been tick 14. `--max-iters` should be queue length **+ margin**, not
queue length. I did not `--force` past it: forcing a safety breaker unattended is
exactly the kind of shortcut this harness exists to prevent, and the goal is
fully specified and ready for a fresh run.

## Run close-out

**Status: QUEUE_REMAINING** (`overnight-guard finish` → 1 goal non-terminal).
Not a success result, and deliberately not reported as one.

| Outcome | Count | Goals |
|---|---|---|
| **complete** | 10 | g-91e2573d, g-574ef5eb, g-a0fb864b, g-a2941340 (T0), g-3e3083c5, g-375d4ce0, g-90dccd13, g-ac3bad15, g-9105aaf0, g-44007df6 |
| **blocked** | 2 | g-7c12a62f (Santa round cap — needs one fresh panel, no operator input), g-90f908bc (needs an operator decision) |
| **not started** | 1 | g-5ead112c (loop-guard cap) |

- **Nothing was pushed, deployed, or applied.** No migration run, no production
  access, no external API spend, and the blocked migration goal
  (`g-91db2f50`) was never touched.
- **Timed-out commands:** 5 Codex lane calls hit the bounded-run timeout; every
  one reported process-tree termination, and each was retried with a narrower
  packet rather than being recorded as "no findings". One DeepSeek call returned
  hallucinated tool calls (malformed = did not review) and was retried.
- **Lane health note worth keeping:** Codex's sandbox rejects several `git`
  subcommands and it burns its whole budget retrying them. Packets that say
  "read files directly, do not use git" succeed; packets that don't, time out.

