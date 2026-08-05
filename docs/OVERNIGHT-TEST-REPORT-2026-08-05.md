# Overnight test and release-readiness report — 2026-08-05

Local-only unattended verification loop per
`docs/OVERNIGHT-TEST-AND-READINESS-SCOPE-2026-08-05.md`. Executed via the
stored-goal system (/mission queue) with /santa-loop review panels.
Run window: ~01:30–04:00 ET 2026-08-05.

## 1. Base and final state

- Base SHA: **`5b9e300`** (expected starting HEAD — matched exactly).
- Final SHA: **the commit containing this report** (parent chain below).
- Local commits created tonight (all local-only, NOTHING pushed):

| SHA | What |
|---|---|
| `d40e644` | test: [T1][g-638c1a9f] e2e loopback network fence + Gate 3 social evidence matrix |
| `d579a2e` | docs: [T0-class][g-c2d30f7b] Gate 6 release-readiness simulation packet rev 3+fixes |
| `fec5d6c` | test: [T1][g-9bc426bb] fence-proxy contract tests (RED-first) + FENCE_PORT |
| `f428996` | fix: [T1][g-9bc426bb] santa round-1 fence fixes (server-side env, scope docstring, ws upgrade) |
| `0e48573` | fix: [T1][g-9bc426bb] santa round-2 fence fixes (globalSetup authenticity, canary, sanitization) |
| (this) | docs: overnight report + continuation |

- Protected operator docs: the four files were the only pre-existing dirty
  paths at start and remain untouched byte-for-byte (never staged; no
  `git add -A` used anywhere).

## 2. Safety grounding and network-fence evidence

Grounding at start: branch `feat/overnight-2026-07-30`; HEAD `5b9e300`;
dirty = exactly the 4 protected docs; census goal `g-7104aed0` **paused**;
lease registry `live=false`; remote-write lock ARMED
(`next-bar/.git/OVERNIGHT_REMOTE_WRITE_LOCK`, 0 bytes, 8/3 21:49). Zero
discrepancies.

**Network fence (built tonight, scope-sanctioned):** refuse-all logging proxy
`e2e/tools/fence-proxy.mjs` on 127.0.0.1:39555 + Playwright `use.proxy` with
loopback bypass (browser side) + `webServer.env` HTTP(S)_PROXY both cases +
`NODE_USE_ENV_PROXY=1` (dev-server side, Node 24 undici) + globalSetup
authenticity probe. Fail-closed: with the proxy down, proxied requests fail at
connect. Proof (chromium + webkit): outbound HTTP and HTTPS CONNECT refused
and logged by hostname only (no query strings); loopback bypasses.
**Fence log totals for the night: 390 refusals of
`wqxovhiovgcijmfzxgby.supabase.co` (protected Staging) + ~248 of
`a/b/c.basemaps.cartocdn.com`** — traffic every previous e2e run silently
emitted. One incident: the proxy crashed on an unhandled ECONNRESET during
batch A (fixed + regression-tested); fail-closed held while down — nothing
escaped, only logging paused.

## 3. Command ledger (status · duration)

| Gate | Command | Result |
|---|---|---|
| 1 | `git diff --check` | PASS (2 CRLF warnings only) · <1s |
| 1 | `npm run secret-scan` | PASS clean, 636→638 tracked files · 1s |
| 1 | `npm run tier-validate` | FAIL (script bug: `~` unexpanded under cmd.exe, MODULE_NOT_FOUND) → equivalent absolute-path run PASS `ok:true, deadRules:[]` — defect queued (`g-8354588a`) |
| 1 | feature manifest + migration reservations (no DB) | PASS: `config/feature-manifest.json` all-false in all 4 envs; migrations/ = 0000–0037+0041, drafts/ = 0038 only, 0039/0040 reserved (no files) |
| 2 | `npm test` (vitest) | PASS **2065/2065, 132 files** · 57.9s (end-of-night: **2069/2069, 133 files** after fence tests) |
| 2 | `npm run typecheck` | PASS exit 0 · 4s |
| 2 | focused env/manifest/migration suites | PASS 7 files / 194 tests (no `migration0041` unit test file exists — noted) |
| 2 | focused push/auth/social/matching/catalog/census | PASS 11 files / 231 tests |
| 2 | focused RLS-static/server + migrations | PASS 8 files / 130 tests |
| 3 | social batch A (auth/identity/delete/analytics ×2 devices) | 61p/1f/1s · 97s → failure retried under justified infra window (fence-proxy crash): **4/4 PASS**; skip = chromium-only clipboard guard |
| 3 | social batch B (friends/suggestions/vibe/tonight/pins ×2) | **PASS 109/109** · 133s |
| 3 | social batch C (nights/share/lists/WTG ×2) | **PASS 73/73** + 2 skips (clipboard guards) · 112s |
| 4 | full iPhone 13 project | 241p / **26f** / 3s · 5.8m |
| 4 | full Pixel 7 project | 230p / **37f** / 2s / 1 flaky-passed (bias-smoke) · 4.9m |
| 4 | full iPhone 17 project | 58p / **23f** · 2.9m |
| 4 | full Desktop marketing project | 6p / **15f** · 48s |
| 5 | `npm run build` | PASS exit 0 · 31s (route table recorded; no warnings beyond output) |
| 5 | `npm run preflight:testflight` | PASS **13 ok / 3 WARN / 0 fail** · 44s |
| 6 | env-contract suites | PASS **62/62** exit 0 |
| 7 | fence contract tests (new) | PASS 6/6; RED-first proven 3× against pre-fix copies |

E2E inventory recomputed: **51 spec files + 1 setup; 288 static `test()`
sites** (handoff's 55/264 superseded).

## 4. Gate 4 failure analysis — the headline finding

**All 101 Gate 4 failures share ONE root cause: the e2e suite assumes live
non-loopback egress.** Not one is an application regression (the same specs
were green in prior unfenced runs; tonight's failures reproduce only with the
fence refusing traffic). Sub-classes, each verified by direct diagnosis:

1. **Live catalog dependence:** the `data-catalog-swapped` marker only lands
   after an anon `rest/v1/bars` fetch from protected Staging. Blocks
   `search-bars` (13–14/project), `map-lightbox` (8), `phase1-compliance`
   ("catalog page sizes seen: []").
2. **Tile-CDN dependence:** Leaflet tiles from cartocdn — `/map` render tests
   (webkit error: "Failure when receiving data from the peer").
3. **Console-purity assertions:** `app-shell-smoke` asserts zero console
   errors per route; Chromium logs `ERR_TUNNEL_CONNECTION_FAILED` per fenced
   request → all 15 routes fail on chromium projects (incl. `/install`,
   `/auth` which need no data).
4. Downstream visibility timeouts: `onboarding-identity` (1),
   `vibe-tweak-reachable` (2).

**Consequence:** Gate 3's social suites are loopback-clean (they stub
Supabase); the broader suite is NOT. Top queued goal `g-5dd241b6` adds a
catalog fixture, tile stub, and fenced-error allowlist.

## 5. Gate 5 detail

Build: exit 0, full route table (static app surfaces incl. `/install`
marketing; dynamic share/OG/u-handle routes). Preflight WARNs (all
known-gap class): (1) 1024×1024 App Store icon absent (pre-submission
requirement, not pre-internal); (2) `/support` route not built (falls back
`/install`); (3) `.env.local` carries the Production project-ref variable
(legacy posture; value never printed). Verified: manifest correctness,
genuine 192/512 icons, display name, canonical identity, siteIdentity,
staging/production isolation in committed files, no analytics SDK, analytics
flags dark, secret scan. Preflight proves NO signing/upload/device facts.

## 6. Gate 6 — Production-switch readiness simulation

`docs/RELEASE-READINESS-SIM-2026-08-05.md` (rev 3 + panel fixes) @
`d579a2e`. Env-contract 62/62. Key packet outcomes: branch tip is NOT a
valid RC (excluded work — census `f5d1579`/`9480fb1`/`48f9f93`, pins
`deffdd1` — are ancestors; RC must be rebuilt from reconciled main);
`npm run db:migrate` FORBIDDEN vs Production (runner auto-applies 0037+0041
if the ledger ends at 0036; no dry-run mode exists — read-only SQL diff
procedure specified instead); pins are OUT by default (unit evidence does NOT
show pre-pin UX; live 0038-less check required — PostgREST 42P01 masks RLS
evaluation, mocks can't reproduce); rollback is asserted-not-demonstrated
(Staging rehearsal required; iOS build 5 has NO native rollback — web
rollback is the only mechanism); 9 attended unknowns enumerated (live main
tip, Production ledger, Vercel env, pins proof, Staging acceptance, rollback
rehearsal, data-shape drift check, RC content decision, error-rate
threshold).

**Panel (T0-class: fresh Fable + Codex + DeepSeek, 3 rounds):** R1 Codex
BLOCK (4H/3M) + Fable APPROVE (2H) + DeepSeek (3 adopted risk items) — all
verified findings folded. R2 Codex BLOCK (2H/4M) + Fable APPROVE — folded.
R3 Fable APPROVE (1H) + Codex BLOCK (2H, SAME mechanical defect both lanes:
ledger column `name` not `filename`; drafts-sweeping pathspec) + DeepSeek
(2 adopted). Convergent R3 fixes applied verbatim post-panel; **goal parked
`blocked` per the 3-round cap pending one re-verdict of those final hunks** —
the packet itself is panel-converged decision input for `g-87cf2100`/
`g-52470455`, not a failed gate.

## 7. Gate 7 — gaps, bounded additions, santa outcome

Additions (all test-harness, RED-first proven): fence contract tests (6/6;
ECONNRESET crash regression, ws:// upgrade logging, hostile-host token
exclusion), fence authenticity globalSetup + reused-dev-server canary,
both-case proxy env, FENCE_PROXY single-source, vitest include for
`e2e/tools/**`. Full unit suite after: **133 files / 2069 tests green**; tsc
clean; live spec runs green through the new globalSetup.

**Santa (T1: fresh Fable + Codex, 3 rounds):** R1 Fable BLOCK (1 CRITICAL:
server-side fence was shell-env-only, not config-enforced → fixed) + Codex
timeout (10m broad packet — retried narrower). R2 Fable APPROVE (1H
reused-server auto-check → canary added) + Codex BLOCK (2H port-squat
impostor + lowercase-precedence → both fixed). R3 **both BLOCK** — cap
reached; work preserved at `0e48573`; goal parked `blocked`. **Unresolved
R3 findings (all folded into `g-5dd241b6`):** (1) Playwright's default
testMatch collects `e2e/tools/fence-proxy.test.ts` (vitest) on a FULL
`npx playwright test` run → needs `testIgnore` (predates: `fec5d6c`;
tonight's Gate 4 full runs happened BEFORE that commit — unaffected);
(2) banner-substring authenticity probe is spoofable and a stale detached
proxy masks later edits; (3) canary fail-open windows (health 30s cache,
unreachable≠fenced, no fetch timeout); (4) sanitizeHost deletes instead of
rejecting (`%2F` variant) and IPv6 CONNECT targets are mangled upstream;
(5) 600ms single-retry spawn race. The fence remains fail-closed for all
executed evidence.

## 8. Feature-to-test matrix and incomplete social work

`docs/SOCIAL-EVIDENCE-MATRIX-2026-08-05.md` @ `d40e644` — 17 rows
(identity → notifications), each with implementation state, exact evidence,
state coverage, evidence class, and next missing behavioral test. ALL e2e
evidence is **mocked-localhost**; no row has real-Staging, multi-account, or
physical-device proof. Confirmed incomplete/not built: **reusable Crews,
invited Night Outs (get_circle_suggestions is followed-circle, NOT
invite-scoped — explicitly not counted), Close Friends (Phase B `g-c8b26779`,
0039 reserved), native APNs**. Operator-reported items still OPEN:
unauthenticated-open login window (queued `g-31c59158`), TestFlight shell
background/safe-area/scrolling (queued `g-b07c73bc`).

## 9. Reproducible defects found tonight

1. `npm run tier-validate` broken on Windows (`~` unexpanded under cmd.exe;
   MODULE_NOT_FOUND; exit 1). Equivalent absolute-path command passes.
   Queued `g-8354588a` with the fix sketch.
2. E2E suite live-egress dependence (§4) — queued `g-5dd241b6`.
3. Playwright-collects-vitest-file defect (§7 item 1) — in `g-5dd241b6`.
4. Fence-proxy ECONNRESET crash (self-introduced tonight, fixed same night,
   regression-tested).
No application-behavior defects were found by the suites that could run
loopback-clean.

## 10. Architecture/product packets

| Packet | Status |
|---|---|
| Staging acceptance + promotion automation + release manifest | **DONE** (inside Gate 6 packet, panel-reviewed as above) |
| Beta epics with per-surface status | **NOT RUN** (goal `g-6b9f79ec` planned; Gate 3 matrix is its prepared input) |
| Crews / invited Night Outs architecture | **NOT RUN** (same goal; block-B acceptance chain recorded in matrix + handoff) |
| Native APNs | **NOT RUN** (goal `g-9b97c22d`; `g-39169b3b` ADR is the base) |
| 20k capacity + load-harness design | **NOT RUN** (same goal) |

Honest reason: Gates 1–7 plus two 3-round review cycles consumed the window;
packets without their required T1/T0 panels would have been unreviewed prose.

## 11. Prioritized open-goal queue (tomorrow → later)

1. **Attended (morning, per handoff):** census closeout `/code g-7104aed0`
   (0041 apply approval + Lucinda's re-approval), then blocks B/C using the
   Gate 6 packet (`g-87cf2100`/`g-52470455` remain the go/no-go holders).
2. `g-c2d30f7b` — one re-verdict on the Gate 6 packet's final fix hunks.
3. `g-5dd241b6` — loopback-clean e2e (top unattended item; unblocks honest
   full-matrix green + fixes the playwright/vitest collection defect).
4. `g-6b9f79ec` + `g-9b97c22d` — product/platform packets with panels.
5. `g-31c59158` (login window — needs product decision first),
   `g-b07c73bc` (mobile-shell regression pack), `g-8354588a` (tier-validate).
6. Pre-existing blocked goals unchanged (`g-c8b26779` Phase B attended
   migration session, `g-e9d493e9` photos, `g-4ed5f834` ranking answers,
   `g-12d33864` map visual approval, `g-35babba8` photo sweep, etc.).

## 12. Boundary confirmations (explicit)

- **Census state unchanged:** goal `g-7104aed0` still `paused`; 0041 applied
  nowhere by this loop; no census/apply/migration/catalog-apply/native code
  touched; `scripts/census/**` untouched.
- **No credentials used; no paid providers.** `.env.local` was read only for
  variable NAMES and the Supabase hostname; no secret value printed or used;
  no DB connection opened.
- **No external writes.** Nothing pushed (origin tips untouched); no PR,
  deploy, workflow dispatch, migration, provider call, Apple/GitHub/Vercel/
  Supabase write. The ONLY network traffic beyond loopback was *refused* by
  the fence and logged by hostname (§2) — that is the fence working, and the
  same hostnames were contacted freely by every previous unfenced run.
- **Staging/Production/Apple/GitHub/Vercel untouched.**
- **No lease remains** (`lease inspect` → `live:false` at close).
- **Remote-write lock ARMED** at close.
- Generated artifacts (.next, playwright-report, test-results, traces) left
  uncommitted; four protected docs untouched; `nb-testflight-node22` and
  `nb-ios` untouched.
