# Production migration packet — 0033–0036 (prepared, NOT applied)

Prepared under the attended read-only authorization of 2026-08-05. **Nothing
was applied. No approval is implied by this document.** It exists so the
operator can approve or reject an exact, mechanically-verified action.

Fixes blocker **M1** and closes the CRITICAL finding **P1** from
`docs/RELEASE-RECONCILIATION-2026-08-05.md`.

## 1. The candidate

- **Branch:** `release/prod-migrations-0033-0036` @ **`3134a97`**
- **Worktree:** `C:\Users\cdfee\projects\nb-release-migrations` (local only,
  never pushed)
- **Base:** `origin/main` @ **`6ec5e5d`** — the exact SHA Production is
  serving right now, so the branch introduces **no application-code delta**.
- **Contents:** main's 20 migration files (0000–0019) **+ exactly four added
  files**, and nothing else. `git status` on the branch is clean.

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

`planMigrations()` — the runner's own planner — executed over the branch's
files against Production's **actual** ledger (read live):

```
prod ledger rows: 33 (0000_reconcile_v01_schema.sql .. 0032_geocode_remaining_from_osm.sql)
branch migration files: 24
WOULD APPLY (4): 0033_vibe_profiles.sql, 0034_revoke_first_grants.sql,
                 0035_share_night_date_bound.sql, 0036_protect_schema_migrations.sql
skip: 20        DRIFT: 0        exactly-four-and-correct: true
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
3. Point the runner at Production **from the clean worktree only**, and
   confirm its plan prints exactly the four names above before it proceeds.
4. Apply. Then re-run for idempotency — expect "24 already applied".
5. Verify (all must pass):
   - ledger has **37 rows**, ending `0036`, with the four checksums above;
   - `schema_migrations` is **no longer readable by the anon key** (the P1
     probe that succeeded today must now be denied);
   - `bars` still has exactly **1,256** rows and its source distribution is
     unchanged (`curated=401`, `import=855`, others 0);
   - `vibe_profiles` exists with RLS enabled and expected policies;
   - core-table grants match the revoke-first posture of `0034`;
   - a share-night date outside ±2 days is rejected, inside is accepted;
   - Production `/api/health` still reports `ok` and SHA `6ec5e5d7ad1d`;
   - no other schema or data delta.
6. Re-arm the remote-write lock immediately after the apply window.

## 6. Rollback and abort

- **Abort before applying** on: ledger not ending at 0032; plan not exactly
  the four; any drift row; missing backup/restore point; unresolved
  reconciliation blocker.
- **Rollback:** `0033` (drop table), `0034`/`0036` (re-grant — note `0036`'s
  header warns this reopens the security finding and must not be routine),
  `0035` (restore prior function bound). Because `0036` is itself the fix for
  a live exposure, prefer **fix-forward** over rolling it back.
- The web tier is untouched by this packet, so no deployment rollback is
  involved; the Production deployment stays at `6ec5e5d` throughout.

## 7. Review status

**T0 — not yet independently reviewed.** Per policy this packet requires a
fresh Fable + Codex panel plus a risk-routed specialist before the operator
should act on it, and the operator additionally asked that behavior be
verified against a **restored Staging** first (blocked on S1 — see the
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
