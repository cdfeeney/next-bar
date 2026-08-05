# Production migration packet — 0033–0036 (prepared, NOT applied)

Prepared under the attended read-only authorization of 2026-08-05. **Nothing
was applied. No approval is implied by this document.** It exists so the
operator can approve or reject an exact, mechanically-verified action.

Fixes blocker **M1** and closes the CRITICAL finding **P1** from
`docs/RELEASE-RECONCILIATION-2026-08-05.md`.

## 1. The candidate

- **Branch:** `release/prod-migrations-0033-0036` @ **`7654cb5`**
- **Worktree:** `C:\Users\cdfee\projects\nb-release-migrations` (local only,
  never pushed)
- **Base:** `origin/main` @ **`6ec5e5d`** — the exact SHA Production is
  serving right now, so the branch introduces **no application-code delta**.
- **Contents:** main's 20 migration files (0000–0019) **+ exactly four added
  migration files**, plus the **ledgered-runner tooling** described in §1a.
  `git status` on the branch is clean.

### 1a. The ledgered runner had to be added — round-1 CRITICAL, verified

The first revision of this packet was **wrong in a way that would have
damaged Production.** It told the operator to run `npm run db:migrate` from
this worktree, while the branch — based on `6ec5e5d` — carried main's
**pre-ledger** runner, whose own header reads *"Migrations are NOT tracked in
a schema_migrations table."* Verified: `src/lib/migrationPlan.ts` and
`scripts/lib/migrationLedger.ts` did **not exist** on the branch. Running it
would have (a) re-executed **all 24** SQL files against live Production
including `0000_reconcile_v01_schema.sql`, and (b) written **no ledger rows**,
leaving Production's ledger claiming `0032` while the schema sat at `0036` —
precisely the "ledger lying about its own state" failure this packet forbids
elsewhere. The original proof used *this* repo's planner, which the branch did
not contain: **the proof and the instruction described different code.**

Fix (branch commit `7654cb5`): the runner's dependency closure **for the plain
apply path** was added,
extracted with `git checkout` (byte-faithful) from the ledgered version —
`scripts/apply-migrations.ts`, `scripts/lib/migrationLedger.ts`,
`scripts/lib/catalogBootstrap.ts`, `src/lib/migrationPlan.ts`. Tooling only:
no schema change and no shipped application code. `pg`, `tsx`, and `dotenv`
are already branch dependencies; the only cross-import on that path
(`src/types`) exists on the branch. The branch's complete non-migration delta
vs `6ec5e5d` is exactly those four tooling files. (The runner also has a lazy
`await import('../src/lib/bars')` reached **only** under `--bootstrap`, which
this window never uses; its transitive files happen to be present on the
branch regardless.)

**Consequence to know before approving:** the ledgered runner executes
`MIGRATION_LEDGER_DDL` at startup — `create table if not exists` **plus
`enable row level security` and `revoke all … from public, anon,
authenticated`** on `schema_migrations`. So the **P1 anon-read exposure closes
the moment the runner connects**, before `0036` itself runs; `0036` then
re-applies the same two statements idempotently, which is the designed overlap
its header describes.

Excluded by construction: `0037` + `0041` (census, protected-Staging only),
`drafts/0038` (venue pins, never applied anywhere), `0039`/`0040` (reserved,
no files exist), and every piece of overnight application code (pins,
census, matcher v1.1, incomplete social work).

**File-integrity note:** the four files were extracted with `git checkout
<sha> --`, not copied by shell. A first attempt using PowerShell
`Set-Content` silently added a UTF-8 BOM to all four (verified: all four
blob hashes differed); those copies were discarded. The committed files are
byte-identical to the versions Staging verified — `git hash-object` equality
confirmed per file.

## 2. Mechanical would-apply proof (already run, read-only)

**Re-run after the §1a fix using the BRANCH's OWN planner module** — the same
file the branch's runner imports at execution time, not this repo's copy:

```
planner source: BRANCH (C:/Users/cdfee/projects/nb-release-migrations/src/lib/migrationPlan.ts)
prod ledger rows: 33 (last 0032_geocode_remaining_from_osm.sql)
branch files: 24
WOULD APPLY (4): 0033_vibe_profiles.sql, 0034_revoke_first_grants.sql,
                 0035_share_night_date_bound.sql, 0036_protect_schema_migrations.sql
skip 20 | drift 0        exactly-four-and-correct: true
```

Checksums the ledger will record (runner-normalized SHA-256), each
**confirmed already recorded identically on Staging**:

| Migration | Checksum | Staging |
|---|---|---|
| `0033_vibe_profiles.sql` | `1337ea6e18f8daa50bb781c293ebabcb24d6ab8c401bec8a198fde8245cc9aae` | MATCH |
| `0034_revoke_first_grants.sql` | `4d5655cccf739a3145996b5dead0214d795afb4a16c47eb2ecccf52be4fe11ba` | MATCH |
| `0035_share_night_date_bound.sql` | `a18aa24c5eca882e2f21a2b5b99330a208123628ed990cd8ec276abd3d398e52` | MATCH |
| `0036_protect_schema_migrations.sql` | `f220f32f8ed9ea0adb094b5c7a2e062d281878fe303cf3d6e891d40eafd02222` | MATCH |

Why "exactly four" holds even though the branch lacks files 0020–0032:
`planMigrations` iterates **files**, not ledger rows — a ledger entry with no
corresponding file is ignored, never treated as drift. Verified in source
(`src/lib/migrationPlan.ts:554-581`) and by the run above.

## 3. What each migration does

| # | Change | Production risk |
|---|---|---|
| `0033` | `vibe_profiles` table + policies — cross-device authenticated vibe profile | Additive; new table only |
| `0034` | Revoke-first grants on core user tables | Tightens privileges; no data touched |
| `0035` | Bound `share_night` to a ±2-day window | Constrains a function's accepted range |
| `0036` | **Enable RLS + revoke all browser grants on `schema_migrations`** | **This is the P1 fix.** Runner-internal table; no app path reads it |

`0036`'s own header documents that no application client uses
`schema_migrations` — the only consumer is the privileged runner — so old and
new clients are unaffected.

## 4. Sequencing constraint (operator-stated, verified)

- **Do NOT run `npm run db:migrate` from the overnight branch** — its
  would-apply set against Production is **six**, silently including `0037`
  and `0041` (census).
- **Do NOT use `scripts/apply-one-migration.mts`** — it executes SQL without
  writing a ledger row, which would leave Production's ledger lying about its
  own state.
- **Only** the normal ledgered runner, **only** from the clean worktree above.

**Prerequisite:** the fresh worktree has no `node_modules`; the apply session
must run `npm ci` there first (git worktrees do not share dependencies).

## 5. If approved — exact execution plan

1. Record the revert point: current Production deployment
   `dpl_4kHrzs54Cm5j1Z1KdRaHGbTBngeR` @ `6ec5e5d`, and capture a database
   restore point/backup identifier before any DDL.
2. Pre-flight read: confirm the Production ledger still ends at **`0032`**
   with 33 rows. Any difference ⇒ **abort**.
3. **Pre-checks, in the window, before the apply** (these were prose in §5a
   and are steps because a mitigation that is not a step does not happen):
   - **Confirm the connecting role actually OWNS the ledger table.**
     `has_table_privilege(…,'INSERT')` is **not** an ownership test — a merely
     granted role passes it while still lacking the `ALTER TABLE … ENABLE RLS`
     and `REVOKE` rights the runner's startup DDL requires (re-verdict, both
     lanes). Use:
     ```sql
     select current_user,
            pg_get_userbyid(relowner) as ledger_owner,
            pg_get_userbyid(relowner) = current_user as is_owner
     from pg_class where oid = 'public.schema_migrations'::regclass;
     ```
     `is_owner` must be true, else **abort** — this is what proves the §5a
     premise rather than assuming it.
   - **Run the window at a low-traffic hour** (moved here from §5a so it is an
     actual step).
   - **Wait out long-running transactions** on the `0034` tables:
     ```sql
     select a.pid, a.state, now() - a.xact_start as age, c.relname
     from pg_stat_activity a
     join pg_locks l on l.pid = a.pid
     join pg_class c on c.oid = l.relation
     where c.relname in ('profiles','ratings','pairwise_comparisons')
       and a.xact_start is not null
     order by age desc;
     ```
     Proceed only when nothing old is holding those relations.
   - **Carry a lock timeout on the runner's own connection.** The runner sets
     none and exposes no flag, so a bare `SET` elsewhere does nothing. In
     PowerShell (this operator's shell):
     ```powershell
     $env:PGOPTIONS = '-c lock_timeout=5s'
     ```
     Or append to `DATABASE_URL` — `?options=-c%20lock_timeout%3D5s` if it has
     no query string, **`&options=…` if it already does** (re-verdict, Codex).
     Confirm with `show lock_timeout;` on that exact connection string first.
4. **Re-run the would-apply proof immediately before applying** — the exact
   command, from this repo (it reads the branch's files and planner and the
   live ledger, and writes nothing):
   ```
   npx tsx scripts/census/out/plan-sim-branchcode-2026-08-05.mts
   ```
   Require `exactly-four-and-correct: true` and `drift 0`.
   **Why this is the confirmation step:** the runner does **not** print a full
   plan and pause. It prints `N already applied, skipped.`
   (`scripts/apply-migrations.ts:464`) and then prints each filename **as it
   begins applying it** (`:483`). There is no built-in prompt, so this proof
   re-run is the only genuine pre-apply gate.
5. Apply — the exact command, from the clean worktree only, after `npm ci`:
   ```
   npm run db:migrate
   ```
   Then re-run the same command for idempotency — expect "24 already applied".
6. Verify (all must pass):
   - ledger has **37 rows**, ending `0036`, with the four checksums above;
   - `schema_migrations` is locked down on **every** browser surface, not just
     anon read (re-verdict): the P1 anon read must now be denied, **and** the
     `authenticated` role must also be denied read **and** write, **and** RLS
     must show enabled —
     ```sql
     select relrowsecurity from pg_class
     where oid = 'public.schema_migrations'::regclass;               -- true
     select has_table_privilege('anon','public.schema_migrations','SELECT'),
            has_table_privilege('authenticated','public.schema_migrations','SELECT'),
            has_table_privilege('authenticated','public.schema_migrations','INSERT');
     ```
     all three privilege checks must be **false**;
   - `bars` still has exactly **1,256** rows and its source distribution is
     unchanged (`curated=401`, `import=855`, others 0);
   - **`vibe_profiles` is the table `0033` describes, not merely a table with
     that name** (re-verdict, Codex HIGH): `0033` uses
     `create table if not exists`, so an existence-only check would pass a
     pre-existing malformed table. Verify columns and types, the unique
     constraint, RLS enabled, the expected policies, **and** that the trigger
     `vibe_profiles_lww` and function `public.vibe_profiles_lww_guard()` both
     exist:
     ```sql
     select column_name, data_type from information_schema.columns
     where table_name = 'vibe_profiles' order by ordinal_position;
     select tgname from pg_trigger
     where tgrelid = 'public.vibe_profiles'::regclass and not tgisinternal;
     select proname from pg_proc where proname = 'vibe_profiles_lww_guard';
     ```
   - core-table grants match the revoke-first posture of `0034`;
   - a share-night date outside ±2 days is **rejected — as an AUTHENTICATED
     caller, asserting SQLSTATE `22023` specifically** (re-verdict, Codex).
     An unauthenticated probe raises `28000` ("not signed in",
     `0035_share_night_date_bound.sql:76`) which looks like a rejection but
     proves nothing about the date guard — that false pass is the trap.
     **Do NOT run the positive "inside is accepted" case as a bare check:**
     `share_night` upserts and updates `shared_at` (`:106-115`), creating a
     data delta that contradicts the "no other delta" criterion below. If the
     positive path must be exercised, wrap it in an explicit
     `BEGIN … ROLLBACK` and record that it was rolled back;
   - Production `/api/health` still reports `ok` and SHA `6ec5e5d7ad1d`;
   - no other schema or data delta.
7. **Ledger-vs-schema mismatch is a HARD STOP (round-1 HIGH).** If the
   functional checks pass but the ledger does **not** end at `0036` with 37
   rows, do **NOT** call the window successful and do **NOT** re-run the
   apply. That state means DDL landed without its ledger rows: stop, report,
   and remediate deliberately (establish which files actually applied, then
   record the correct ledger rows) before any further migration work on that
   database.
8. Re-arm the remote-write lock immediately after the apply window.

## 5a. Live-traffic and lock behavior (round-3 DeepSeek specialist)

**Ledger lock-out: should not be possible — but the premise is an inference,
so step 3 now proves it (round-3).** The runner does not enforce which role
connects; it uses whatever `DATABASE_URL` resolves to
(`scripts/apply-migrations.ts:343`), and no repository document states which
Postgres role Production's `DATABASE_URL` authenticates as. **If** that is the
conventional Supabase owner role, then in PostgreSQL the owner is exempt from
privilege checks —
`REVOKE ALL … FROM public, anon, authenticated` has no effect on it — while RLS
is likewise skipped for the owner, and `service_role` additionally holds
`BYPASSRLS`. So `0036` (and the startup DDL) cannot lock the runner or a future
migration out of its own ledger. **§5 step 3 proves that premise** with a true
ownership test (`pg_get_userbyid(relowner) = current_user`). Note why a
privilege test would NOT do: run before the apply, `has_table_privilege(…,
'INSERT')` returns true for almost any role, because the revoke that would
remove that privilege has not happened yet — it cannot distinguish "exempt as
owner" from "still holds the default grant about to be revoked" (re-verdict,
Fable). Containment if the premise were somehow false: `MIGRATION_LEDGER_DDL`
runs at the top of the same invocation and each file is one transaction, so
the failure is a loud rollback on `0033`, not a silent partial state.

**`0034` is the one with live-traffic impact.** Its `REVOKE`/`GRANT` statements
take an `AccessExclusiveLock` on `profiles`, `ratings`, and
`pairwise_comparisons`, held until that file's transaction commits. Live
`authenticated` queries against those tables **queue and hang** for the
duration rather than erroring — to the iOS shell that reads as a spinner, and
as a client-side timeout if it runs long. The work itself is catalog-only and
sub-second; the real hazard is an unrelated long-running transaction already
holding a weaker lock, which makes the `AccessExclusiveLock` request queue —
and every subsequent reader then queues behind it.

Mitigations — **all three are now numbered steps in §5 step 3**, not advice:
- Run the window at a **low-traffic hour**, not mid-evening.
- Carry a short **`lock_timeout`** so `0034` fails fast and rolls back instead
  of stalling every read behind a lock queue. **The runner sets none and
  accepts no flag for it (verified)**, so a bare `SET lock_timeout` in some
  other session does nothing — it must ride the runner's own connection via
  `PGOPTIONS=-c lock_timeout=5s` or a `?options=` parameter on
  `DATABASE_URL`. A timed-out `0034` is a clean retry; a lock pile-up is a
  user-visible outage.
- Check `pg_stat_activity` for long-running transactions first and wait them
  out.

## 6. Rollback and abort

- **Abort before applying** on: ledger not ending at 0032; plan not exactly
  the four; any drift row; missing backup/restore point; unresolved
  reconciliation blocker.
- **ROLLBACK MUST ALSO DELETE THE LEDGER ROW (round-3 HIGH, verified).**
  Each file commits its DDL **and** its ledger row in one transaction
  (`scripts/apply-migrations.ts:487-499`). Reversing the schema alone leaves
  the ledger row behind, and because `planMigrations` skips any file whose
  recorded checksum matches (`src/lib/migrationPlan.ts:564-571`), **a later
  run would silently skip the very migration you rolled back** — the schema
  and the ledger would disagree permanently.

- **Ready-to-run rollback blocks — copy one whole block, do not assemble**
  (re-verdict, both lanes: the revert SQL and the ledger delete were stated
  separately, forcing manual assembly mid-incident). Each block is one
  transaction, revert **plus** ledger delete. Roll back in **reverse order**
  (0036 → 0033) if reverting more than one.

  `0033` — `DROP TABLE` alone would leave the guard function behind:
  ```sql
  begin;
  drop trigger if exists vibe_profiles_lww on public.vibe_profiles;
  drop function if exists public.vibe_profiles_lww_guard();
  drop table if exists public.vibe_profiles;
  delete from public.schema_migrations where name = '0033_vibe_profiles.sql';
  commit;
  ```

  `0034` — **all six** statements. The last two are load-bearing: without them
  `profiles` keeps a full table-level `UPDATE` grant instead of the
  column-scoped grant the pre-migration state had:
  ```sql
  begin;
  grant all on table public.profiles             to anon, authenticated;
  grant all on table public.ratings              to anon, authenticated;
  grant all on table public.pairwise_comparisons to anon, authenticated;
  revoke all on table public.ratings from anon;  -- restore 0015:96
  revoke update on table public.profiles from public, anon, authenticated;
  grant update (display_name, is_private) on table public.profiles
    to authenticated;                            -- restore 0006:82-83
  delete from public.schema_migrations where name = '0034_revoke_first_grants.sql';
  commit;
  ```

  `0035` — the revert itself is **prose in the source, not SQL**: re-apply the
  `share_night` body from `0016_shared_nights.sql` (identical to `0035`'s minus
  the `p_night` range guard). Do it in this shape:
  ```sql
  begin;
  -- paste the CREATE OR REPLACE FUNCTION share_night(...) body from
  -- supabase/migrations/0016_shared_nights.sql here, unmodified
  delete from public.schema_migrations where name = '0035_share_night_date_bound.sql';
  commit;
  ```

  `0036` — **emergency only**; this restores the insecure state `0036` exists
  to fix and re-opens the P1 public-ledger exposure:
  ```sql
  begin;
  alter table public.schema_migrations disable row level security;
  grant all on table public.schema_migrations to anon, authenticated;
  delete from public.schema_migrations where name = '0036_protect_schema_migrations.sql';
  commit;
  ```
  The migration's own header says no application rollback is expected or
  useful. Prefer **fix-forward**. Note too that the runner re-applies these
  protections at every startup via `MIGRATION_LEDGER_DDL`, so this rollback is
  undone by the next migration run — which is a feature, not a bug.
- The web tier is untouched by this packet, so no deployment rollback is
  involved; the Production deployment stays at `6ec5e5d` throughout.

## 7. Review status

**T0 — reviewed across four rounds** (fresh Fable + Codex each round, plus the
operator-authorized DeepSeek database/security specialist), under review goal
`g-697b00ec`. The review found and this packet fixed: a CRITICAL (the branch
originally carried main's ledger-less runner, so the documented apply would
have re-run all 24 files and written no ledger rows), and HIGHs covering the
truncated `0034` rollback, the missing ledger-row deletion on rollback,
mitigations that were prose instead of steps, an unactionable `lock_timeout`,
and a claim that the runner pauses to show its plan when it does not. Round-4
verdicts: Fable APPROVE, Codex BLOCK — its remaining items are folded in
above.

**This does not make the packet approved to run.** It remains CONDITIONAL: the
operator additionally requires behavior verified against a **restored
Staging** first (blocked on S1 — see the
companion Staging finding below).

## 8. Companion finding — why Staging is down (S1 root cause, read-only)

The failed Staging Production-target deployment
(`next-bar-staging-n3penyjfd…`, 2026-08-02) failed like this:

```
Extracted 9 deployment files...
Warning: Could not identify Next.js version...
Error: No Next.js version detected. Make sure your package.json has "next" in
either "dependencies" or "devDependencies". Also check your Root Directory
setting matches the directory of your package.json file.
```

A **successful** Staging preview deploy by contrast downloaded **4,009**
files and logged `Detected Next.js version: 14.2.35`. So this is **not** a
code or dependency defect: the failed run uploaded a 9-file fragment — a
partial/wrong-root CLI upload. Redeploying the full source at the agreed
baseline should restore it.

Also observed: Staging **preview** URLs are protected by Vercel
Authentication (they return an SSO HTML page, not JSON), so acceptance
testing needs the project's **production-target** URL to be serving, not a
preview link.

Restoring Staging is a **deployment + environment-scoping change** and is
**not** authorized by anything in this packet.
