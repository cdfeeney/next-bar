# Attended read-only release reconciliation — 2026-08-05

Executed under the operator's explicit authorization for read-only GitHub,
Vercel, and bounded database inspection. **No push, PR, merge, deploy,
migration, database write, environment change, workflow dispatch, or
TestFlight action occurred. No secret value is printed here.** This packet
replaces the `ATTENDED/UNKNOWN` fields of
`docs/RELEASE-READINESS-SIM-2026-08-05.md` with measured facts.

## 1. Git refs (fetched, not pushed)

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | **`6ec5e5d`** | advanced `4b06ed6 → 6ec5e5d` on fetch; local ref had been stale exactly as the sim packet predicted |
| `origin/feat/overnight-2026-07-30` | `edd9d8f` | ancestor of local HEAD — **no divergence**, nothing to reconcile |
| local `HEAD` | `85d61c0` | 44 commits ahead of the pushed overnight branch; 230 ahead of `origin/main` |
| merge-base(`origin/main`, HEAD) | `8ac648c` | matches the sim packet |
| commits on main not local | **6** | `ebbcd55`, `7cc7fea`, `1514420`, `87c95c8`, `4b06ed6`, `6ec5e5d` — the iOS wrapper + TestFlight CI chain (PRs #90–#95) |

## 2. Vercel deployment identities

| Item | Value |
|---|---|
| Production project | `cdfeeneys-projects/next-bar` |
| **Current Production deployment** | `dpl_4kHrzs54Cm5j1Z1KdRaHGbTBngeR` (`next-ikmfe8guo…`), Ready, 2026-08-04 19:02 ET |
| **Production serving SHA** | `6ec5e5d7ad1d` (from `/api/health`) — **matches `origin/main` exactly** |
| **Rollback target (previous Production)** | `dpl_HtdttFsECRehCmoVGBcZz8EpcpyP` (`next-m1tqwm7nt…`), Ready, 2026-08-03 21:49 ET |
| Production health | `{ok:true, supabase:"ok"}` |
| Staging project | `cdfeeneys-projects/next-bar-staging` — latest Production-target deploy is **`● Error`**; the project URL returns **404** on `/` and `/api/health` |

**Finding S1 (HIGH, blocks Staging acceptance):** there is no serving Staging
deployment. Step 4 of the release sequence (real-account Staging + mobile
acceptance, rollback rehearsal) **cannot run** until a Staging deployment is
successfully redeployed — which is itself a deploy action requiring separate
approval.

## 3. Environment variable names (names only; no values read or shown)

- **`next-bar` (Production project) — only 5 variables:**
  `SUPABASE_SERVICE_ROLE_KEY` (Production), `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (Production + Preview), `NEXT_PUBLIC_SUPABASE_URL` (Production + Preview).
- **`next-bar-staging` — 11 variables**, incl. `NEXT_PUBLIC_BUILD_SHA`,
  `NEXT_PUBLIC_PUSH_ENABLED`, `NEXT_PUBLIC_ANALYTICS`, `ANALYTICS_ENABLED`,
  `VERCEL_TARGET_ENV`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_LEGACY_PHOTOS` — all scoped **Preview** except two
  `NEXT_PUBLIC_BUILD_SHA` entries.

**Finding E1 (MEDIUM):** Production has **no analytics variables at all**
(`ANALYTICS_ENABLED` / `NEXT_PUBLIC_ANALYTICS` absent). Absent reads as
disabled today, so analytics is dark in Production — but the checker's
"flags must agree" rule is satisfied vacuously, not affirmatively.

**Finding E2 (MEDIUM):** `next-bar-staging` holds `DATABASE_URL` **and**
`SUPABASE_SERVICE_ROLE_KEY` scoped to **Preview** — exactly the combination
`envCheck` flags as a preview-credential violation. It is the Staging
project, but the variables are attached to the Preview environment.

**Finding E3 (LOW/process):** `vercel link` rewrote `.gitignore` (appended
`.env*`) and rewrote `.env.local` as a side effect. Both were reverted; the
Staging `DATABASE_URL` ref was re-verified as `wqxovhiovgcijmfzxgby`
afterwards. Worth knowing before any future `vercel` CLI use in this repo.

## 4. Migration ledgers — three-way comparison

| Ledger | Rows | Range |
|---|---|---|
| **Production** (`nuhqlvneokucxomguxhi`) | **33** | `0000` → `0032` |
| **Staging** (`wqxovhiovgcijmfzxgby`) | **39** | `0000` → `0037` + `0041` |
| Local files | 39 | `0000`–`0037`, `0041` (+ `drafts/0038`) |

**Normalized-checksum comparison (runner's `checksum()`): ZERO drift.**
33/33 Production entries match their local files; 39/39 Staging entries match.
No edited-after-apply migration exists in either environment.

**Finding M1 (HIGH — the central release fact):** Production is missing
**six** migrations that `npm run db:migrate` would apply if pointed at it:
`0033_vibe_profiles`, `0034_revoke_first_grants`,
`0035_share_night_date_bound`, `0036_protect_schema_migrations`,
`0037_census_provenance`, `0041_bars_source_census`. The sim packet's
"expected baseline 0000–0036" was **wrong by four** — Production is at 0032,
not 0036. Any RC containing code that depends on 0033–0036 (vibe profiles,
revoked first-grants, share-night date bounding, ledger protection) is
**schema-incompatible with Production as it stands**.

## 5. Production data shape

- `bars` total: **1,256** rows.
- `source` distribution: `curated=401`, `import=855`, `places=0`,
  `user-submitted=0`, **`census=0`**.
- Staging by contrast: 412 rows (`curated=411`, `census=1`).

**Finding D1:** Production and Staging catalogs are **materially different
datasets** (1,256 vs 412). Staging is not a Production mirror; no
Staging-derived data conclusion transfers.

**Finding P1 (CRITICAL — security, pre-existing, not caused by this session):**
`schema_migrations` is **readable by the anonymous key in Production**
(HTTP 206 with full rows). Migration `0036_protect_schema_migrations` — which
locks that table down — is one of the six missing from Production. The
ledger contents are therefore world-readable to anyone holding the public
anon key (which ships in the client bundle by design). This is how this
reconciliation read the Production ledger at all. Not data-destructive, but
it discloses schema/migration history publicly and should be closed by
applying `0036` under the normal approval path.

## 6. TestFlight build-5 provenance

GitHub Actions run **30958647881** (`iOS TestFlight`, conclusion `success`,
2026-08-04 23:02 UTC) built at head SHA
**`6ec5e5d7ad1d60bf434e2fef05735843be8e907c`** — reconfirmed, matches the
attended session record and the current Production serving SHA. The
prior run `30957753147` at `4b06ed6` failed, consistent with the recorded
history. No new dispatch occurred.

## 7. Release-candidate implications

- The current branch tip **cannot** be the RC (confirmed): it contains the
  census work (`f5d1579`, `9480fb1`, `48f9f93`) and pins (`deffdd1`) as
  ancestors, plus 0041 which is Staging-only.
- The RC must be built from reconciled `main` (`6ec5e5d`) — which the local
  branch does **not** contain (6 commits behind on that line).
- **Blocking prerequisite (M1):** the RC's migration compatibility must be
  decided first. Either (a) Production takes `0033`–`0036` under separate
  explicit approval, or (b) the RC excludes every code path depending on
  them. `0037`/`0041` remain census-scoped and out of Production regardless.
- **Blocking prerequisite (S1):** no Staging deployment currently serves, so
  acceptance and rollback rehearsal cannot proceed.

## 8. Status of the go/no-go gate

**NOT GO.** Two hard blockers (M1 schema gap, S1 no serving Staging), one
CRITICAL security finding (P1), and two MEDIUM environment findings
(E1, E2) are open. The next actions all require separate approvals and are
not taken here.

## 9. Session-boundary confirmation

Reads only: `git fetch`, `gh run list`, `vercel whoami/projects/ls/inspect/env
ls/env pull`, HTTPS GETs to the Production site and its Supabase REST
endpoint, and one `SELECT`-only Staging database window. **Production was not
written to in any way**; no migration, no deploy, no env change, no workflow
dispatch, no TestFlight action, no push. The pulled Production env file lives
only in the session scratchpad (outside the repo) and contains secrets that
were never printed — delete it at session end. Remote-write lock: armed.
