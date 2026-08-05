# Production-switch readiness simulation — 2026-08-05 (overnight Gate 6, rev 3)

Local-only simulation per `docs/OVERNIGHT-TEST-AND-READINESS-SCOPE-2026-08-05.md`.
This packet FEEDS the attended goals `g-87cf2100` (go/no-go) and `g-52470455`
(attended release); it authorizes NOTHING and touched no live environment.
**No remote action may be taken "against this packet" without a separate,
recorded go/no-go authorization for that exact action.** Every live value below
is `ATTENDED/UNKNOWN` unless a repository fact proves it.

Rev 2 incorporated the verified round-1 panel findings; rev 3 incorporates
round 2 (fresh Fable + Codex, 2026-08-05 — full lane record in the overnight
report, which is this packet's audit artifact).

## 1. Environment-contract simulation (synthetic values only) — PASS

`src/lib/environment.test.ts` + `scripts/lib/envCheck.test.ts` +
`scripts/lib/environmentIdentity.test.ts`: **62/62, exit 0** (2026-08-05).
Cases proven by name: production flags harness flags (`LOOP_UNATTENDED`,
`G4_DUMP`) as unsafe; preview rejects `SUPABASE_SERVICE_ROLE_KEY` and
`DATABASE_URL`; unknown/unrecognized environment fails CLOSED (single critical,
nothing else evaluated); missing and empty-string Supabase config both flagged
for deployments; secret-under-`NEXT_PUBLIC_` name, same-value leak, and
embedded-value leak all CRITICAL; checker never echoes values; analytics flags
(`ANALYTICS_ENABLED` / `NEXT_PUBLIC_ANALYTICS`) must agree; scripts/app
identity mirrors agree exactly (no third copy).

## 2. Code-range inventory (NOT an RC — see §3 rule)

- This branch: `feat/overnight-2026-07-30` @ `d40e644` at review time (final
  overnight SHA in the overnight report).
- Divergence measurements (local refs only, both stale — reconcile after an
  attended fetch):
  - vs `origin/feat/overnight-2026-07-30` (this branch's own remote ref):
    `git log origin/feat/overnight-2026-07-30..HEAD` = **31 commits** at
    review time (29 pre-existing + `5b9e300` scope doc + `d40e644` tonight).
  - vs local `origin/main` (`4b06ed6`, provably stale — PR #95 merged later as
    `6ec5e5d` per the attended session record in `0f6e479`): merge-base
    `8ac648c`; `git log 4b06ed6..HEAD` = **217 commits** (156 excluding
    `docs:`; 144 excluding `docs:`+`chore:`). The 31 and 217 measure different
    things; both are reproducible with the commands above.
- Live `origin/main` tip: **ATTENDED/UNKNOWN**. The RC must be built AFTER
  reconciling both sides with a real fetch.

## 3. Classification and the RC-construction rule

**Rule (round-1 Codex HIGH, verified):** the branch history is linear, so any
"RC @ branch tip" AUTOMATICALLY CONTAINS the excluded work below as ancestors,
and no pin feature flag exists. Therefore a valid RC is NOT this branch tip: it
must be constructed in the attended session as a new release branch from
reconciled `main`, cherry-picking (or merging then reverting) so that the
excluded classes are provably absent from the deployed tree — verified by
inspecting the RC's built output/diff, not by prose.

| Class | Commits (representative) | RC eligibility |
|---|---|---|
| Web-only, reviewed, complete | `276a258`+`4b3977d`+`0c8e62a` (search auto-hide), `046b36a`+`7a86d94` (social Phase A), `49d9192` (matcher v1.1 + dark KPI) | Candidate **IN** |
| Schema-dependent web | `deffdd1` (venue pins — needs draft 0038, NEVER applied; **also moves the shared night boundary 5am→6am**, which affects non-pin surfaces) | **OUT by default.** Unit evidence does NOT show pre-pin UX: helpers convert missing-RPC errors to `false`/`null` but the UI still renders pin controls and "Couldn't load pins"/"Couldn't pin" errors. Include only after a live check on a 0038-less database (see §4b) or behind a real flag that removes the UI. The night-boundary change needs its own attended inclusion decision. |
| Census (T0, Staging-scoped) | `f5d1579`, `9480fb1`, `48f9f93` (0041) | **OUT of Production** — census work is scoped as eligible ONLY for protected Staging, and even there only after separate exact-action authorization (as of the checkpoint record, the 0041 Staging-apply approval has NOT been given) |
| Native/TestFlight pipeline + CI | e.g. `1514420`, `87c95c8`, `4b06ed6` (on main), workflow fixes | Neutral to the web RC bytes; the native pipeline itself is versioned by main + Apple state — any native change requires its own reviewed commit + fresh TestFlight build (attended) |
| Docs/continuations | `f4264aa`…`8cb4b9a`, `5b9e300` | Neutral (no behavior) |
| Test-only (tonight) | `d40e644` (fence + matrix) | Neutral — improves CI honesty |

The table is representative; the attended RC construction must classify **every**
commit in the reconciled range mechanically (script in §8), not just these.

## 4. Migrations

- Production ledger content: **ATTENDED/UNKNOWN** (no DB contact tonight).
  Expected baseline: 0000–0036 per prior packets; VERIFY via the plain
  read-only SQL of §4a in the attended session — NEVER by invoking the runner,
  which has no read mode (it executes ledger DDL and then applies).
- Required by the web-only RC: **NONE new**.
- **Excluded, must NOT reach Production under this packet:** `0037` + `0041`
  (census — protected-Staging-only under `g-7104aed0`), `0038` (venue-pins
  DRAFT in `supabase/migrations/drafts/`, runner-inert), `0039` (reserved,
  Social Phase B, no file), `0040` (reserved, night photos, no file).
  File-presence check 2026-08-05: `migrations/` holds 0000–0037 + 0041;
  `drafts/` holds 0038 only — matches reservations exactly. Applied-state
  claims for 0038 ("never applied") and 0041 ("applied nowhere") are **as of
  the attended checkpoint record** (`docs/CONTINUATION-2026-08-04.md` §7c,
  `docs/MORNING-HANDOFF-2026-08-05.md`); current live ledger state remains
  ATTENDED/UNKNOWN and is re-verified in the attended read window.
- **4a. Mechanical enforcement (round-1 Codex HIGH, verified):** the ledgered
  runner (`scripts/apply-migrations.ts`) applies EVERY top-level
  `supabase/migrations/*.sql` not in the ledger — so IF Production's ledger
  still ends at 0036 (expected but ATTENDED/UNKNOWN), an ordinary
  `npm run db:migrate` pointed at Production WOULD apply 0037+0041.
  Therefore: `npm run db:migrate` (and `db:bootstrap`) are **FORBIDDEN against
  Production for this release**. **The runner has NO `--plan`/`--dry-run` mode
  today (round-2 Codex HIGH, verified)** — the would-apply check must NOT be
  produced by running the runner. The read-only procedure that exists today:
  in the attended read window, `SELECT name, checksum FROM
  public.schema_migrations ORDER BY name` (plain read-only SQL — ledger
  columns are `name`/`checksum`/`applied_at` per
  `scripts/lib/migrationLedger.ts`), diff those `name` values against the
  BASENAMES of `git ls-files ':(glob)supabase/migrations/*.sql'` (top-level
  only — a bare `supabase/migrations/*.sql` pathspec would wrongly sweep in
  the runner-inert `drafts/0038`), and require the would-apply set to be
  **exactly empty**; non-empty = abort, not a prompt. A first-class `--plan`
  flag belongs to the §8 automation (future T1 work), not to this release.
  **Scope note (round-3 DeepSeek):** the empty-would-apply gate is specific to
  THIS migration-free release, not a general promotion rule — a future release
  that ships schema must replace it with a governed apply step (pre-apply
  ledger read → ledgered apply → post-apply ledger + artifact verification),
  or operators get pushed toward ungoverned shadow applies.
  **Defense-in-depth (round-3 DeepSeek):** ledger-vs-reality divergence is
  unlikely with this runner (DDL + ledger row commit in one per-file
  transaction) but cheap to check: in the read window, `to_regclass()` the
  tables the ledgered migrations claim to create; any missing artifact =
  divergence = abort.
- **4b. Pins compatibility check (needed only if pins are ever included):**
  live check against a 0038-less database is REQUIRED — unit mocks cannot
  reproduce the real error path (PostgREST wraps Postgres `42P01`
  undefined-table errors in its own JSON error shape, and a missing table
  errors at parse time so RLS is never evaluated — meaning RLS-denial tests
  pass vacuously while masking the actual failure mode). Review-derived
  (DeepSeek round 1); verify the exact error shape during the live check.
- **Schema-drift silent-subset risk (DeepSeek round 1):** a web-only RC can
  still assume data shapes that exist only on Staging (e.g., rows with
  `source='census'` after 0041). Pre-promotion check: enumerate the RC's
  expected `bars.source` (and similar enum-ish) value sets and verify them
  against Production data (`SELECT source, count(*) FROM bars GROUP BY 1`)
  in the attended read window; a value the code requires that returns no rows
  is a stop.

## 5. Environment variables (NAMES only — never values)

- **Runtime (app, Production):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only),
  analytics pair `ANALYTICS_ENABLED` + `NEXT_PUBLIC_ANALYTICS` (must agree;
  both dark until the attended enablement decision).
- **Environment identity (read by the checker):** `VERCEL_TARGET_ENV` /
  `VERCEL_ENV` (unknown values fail closed).
- **Attended migration-shell only (never app runtime, never preview):**
  `DATABASE_URL`, `NEXT_BAR_DATABASE_ENVIRONMENT`,
  `NEXT_BAR_PRODUCTION_PROJECT_REF`.
- **Must not be ENABLED (`=1`) in Production:** harness flags
  `LOOP_UNATTENDED`, `G4_DUMP` — the checker flags the enabled value, not mere
  presence (`0` is deliberately tolerated). **Forbidden in preview:**
  service-role key, `DATABASE_URL` (checker-enforced). NOTE (round-2 Codex,
  verified): `DATABASE_URL` in Production runtime is NOT checker-forbidden —
  its "attended migration-shell only" scoping above is policy, enforced by the
  §6 abort item "any §5 scope violation", not by `check-env`.
- Live Vercel env state: **ATTENDED/UNKNOWN**. Known local posture (preflight
  WARN): `.env.local` carries the Production project ref variable — never copy
  `.env.local` into any deploy config.

## 6. Rollback + abort

- Rollback mechanism: redeploy the previous Vercel deployment. Rollback target
  identifier: **ATTENDED/UNKNOWN** — it MUST be recorded before promoting;
  a missing recorded rollback identifier is itself an abort condition.
- Native: TestFlight build 5 (uploaded 2026-08-04 per the attended session
  record — current ASC state itself is ATTENDED/UNKNOWN) wraps the production
  URL; web rollback instantly affects it and is the ONLY rollback for native
  users — there is no TestFlight-side rollback. Any WebView-contract change
  (postMessage protocol, viewport meta, cookie SameSite) breaks build 5 users
  until a NEW TestFlight build ships; treat such changes as native-class, not
  web-only (round-1 DeepSeek).
- Rollback is **asserted, not demonstrated** (round-1 Codex HIGH): before
  first Production promotion, rehearse the redeploy-previous flow on Staging
  (promote → roll back → verify SHA + login + catalog + one social read), and
  record TestFlight/cache-refresh behavior during the rehearsal. Until
  rehearsed, rollback readiness is **ATTENDED/UNKNOWN**.
- Data/rollback asymmetry (round-1 DeepSeek): rollback redeploys OLD code
  against the database and client localStorage AS MODIFIED by the new build.
  Before rolling back, check whether the RC wrote any new/reshaped
  localStorage keys or JSONB/metadata values the previous build parses
  differently; if it did, prefer roll-forward hotfix over rollback.

### Abort conditions — promotion does not proceed / rolls back on ANY of:

Pre-promotion stops: any §10 attended unknown unresolved; env-check failure;
**analytics pair disagreement** (the checker classifies it only `medium`, so
`isEnvSafe` alone would NOT stop it — round-2 Codex, verified — hence it is
an explicit abort here); **any §5 scope violation** (e.g., `DATABASE_URL`
present as Production app runtime — also not checker-enforced); would-apply
migration list non-empty (per the §4a read-only procedure); excluded migration
present in the RC tree; rollback identifier not recorded; Staging acceptance
(§7) not passed; RC tree SHA ≠ the reviewed/tested SHA.
Post-promotion stops: health route not reporting the promoted SHA (or not
fresher than the deploy); login/callback failure; catalog absent/empty on
/search or /map; social reads failing signed-in; error rate above the
operator-set threshold agreed at go/no-go time (set a number then — "visibly
elevated" is not a gate); RLS denial regression on the smoke accounts.
The operator-reported unauthenticated-open login-window issue remains OPEN;
its go/no-go disposition (ship-known vs block) is an explicit attended
decision at promotion time, not a default.

## 7. Staging acceptance checklist (attended, pre-promotion)

Auth (fresh sign-in + callback), catalog (search + map + >1000-row paging),
ratings 3-tier, friends/follows + requests, consensus/suggestions
(followed-circle — invited-Crew flow is INCOMPLETE and must be reported as
such, not substituted), shared-night links + revocation, Nights Out history,
mobile safe-areas/background/scrolling on the TestFlight shell, and
unauthenticated app open (login window — operator-reported, still OPEN).
Each on both configured mobile viewports; social items with two real accounts.

## 8. Promotion-packet automation (design; never performs the action)

`scripts/release/build-promotion-packet.mjs` (future, T1): reads local git +
ledger files + env NAMES, emits `docs/PROMOTION-PACKET-<date>.md` with the
exact commit range with per-commit classification, migration would-apply diff
(must be empty), env-name diff, smoke matrix, rollback identifier
placeholders, and the abort list. Hard rules: read-only; refuses to run
`git push`/`vercel`/`supabase`/any network call (allowlist: none); every live
value it cannot read locally prints as `ATTENDED/UNKNOWN`. The packet output
is decision input ONLY: each remote action still requires its own recorded
operator authorization at execution time.

## 9. Dry-run recovery reasoning (static)

- Migration failure mid-apply: the ledgered runner applies per-file
  `BEGIN..COMMIT` — semantics confirmed by static runner analysis during the
  0041 review panel (DeepSeek lane). **0041 itself has been applied NOWHERE**;
  no live apply of 0041 has ever run, so this is runner-semantics evidence,
  not live-apply evidence. Recovery = fix forward or restore from the
  pre-apply snapshot; no partial-file state.
- Clean-database rebuild rehearsal: **BLOCKED** locally — no isolated local
  Postgres engine exists (docker/pg absent per `g-91db2f50`); protected
  Staging must NEVER be the rehearsal target.

## 10. Attended unknowns (complete list)

1. Live `origin/main` tip + Vercel Production deployment SHA/identifier —
   the latter recorded explicitly AS the rollback target of §6 (its absence
   is the "rollback identifier not recorded" abort).
2. Production migration-ledger contents (and empty would-apply proof, §4a).
3. Production/preview Vercel env variable state (names audit per §5 scoping).
4. Pins live degradation proof on a 0038-less database (§4b) — or pins stay OUT.
5. Staging acceptance run (§7) with real accounts.
6. Rollback rehearsal on Staging (§6) incl. TestFlight/cache behavior.
7. Production data-shape check for RC-assumed value sets (§4 drift check).
8. Whether operator wants pins/matcher in the first promotion or web-fixes-only,
   and the login-window disposition (§6).
9. The numeric post-promotion error-rate threshold (set at go/no-go time;
   promotion may not begin while it is unset — §6).
