# Fresh-database bootstrap review packet — 2026-07-31

## Decision requested

Review the local implementation of a deterministic, non-production database
bootstrap. Do not apply it until the review converges.

The incident was not a bad `0028` migration. Migration `0019_bars_catalog.sql`
creates an empty `public.bars` table, while data migrations `0026`–`0032`
operate on catalog rows that historically arrived through a separate import.
The first staging rehearsal therefore recorded `0026` and `0027` against an
empty table and then failed closed at `0028` when `dominies-astoria` was absent.

## Non-negotiable constraints

- Migrations `0000`–`0035` remain byte-for-byte unchanged in the worktree.
- Checksums continue to be calculated from the original files.
- `--baseline` is never part of a fresh-database build.
- Bootstrap is explicit (`npm run db:bootstrap`), attended, and non-production.
- It requires `NEXT_BAR_DATABASE_ENVIRONMENT=staging` (or `development`) and
  verifies that the public Supabase URL and database URI identify the same project.
- No Production export, user record, rating, review, hour, or photo enters the fixture.
- The currently partial staging database must be recreated/reset; it is not repaired in place.
- No push, deployment, database reset, or migration application is part of this code change.

## Adversarial design review

Rejected approaches:

1. **Edit old migrations.** Rejected because Production may already hold their
   checksums. Editing history creates drift and makes environments disagree.
2. **Use `--baseline`.** Rejected because it would record work that did not run.
3. **Insert only the three rows named by the first error.** Rejected because
   `0029`–`0032` have hundreds of additional catalog dependencies and the next
   failure would merely move down the sequence.
4. **Copy the Production catalog.** Rejected because it is non-deterministic,
   can copy licensed/provider or user-adjacent data, and turns staging rebuilds
   into a Production-access operation.
5. **Silently seed during ordinary `db:migrate`.** Rejected because ordinary
   migrations must not invent catalog data on an existing environment.

Selected design:

- `scripts/lib/catalogBootstrap.ts` mechanically extracts executable venue IDs
  from migrations `0026`–`0032`.
- It also parses `0027`'s checksummed `kept / removed` mapping. This matters:
  satisfying the DELETE targets alone could remove an alias without installing
  the canonical venue it is supposed to preserve.
- The fixture is the union of the repository's 403 public static catalog rows
  and those mechanically derived dependencies. Missing DB-only venues receive
  deterministic synthetic, non-user fields.
- Current inventory: 402 migration dependencies and 419 fixture rows. After
  `0027` removes nine aliases, the expected catalog count is 410.
- Current fixture SHA-256 fingerprint:
  `e87d3c85de9b7487775686102216d21620b17d0144b32983b46459ef181422e2`.
- The fixture is inserted once, immediately after `0019`, before `0020`.
- A private marker table records fixture ownership and fingerprint so an
  interrupted bootstrap can resume. An unmarked database with any migration
  after `0019` and work still remaining is refused as ambiguous. The marker is
  removed only after the build reaches the end.

## Second defect found during review

Migrations `0029`–`0032` contain their own top-level `BEGIN` / `COMMIT`, while
the migration runner also opens a transaction around each migration and its
ledger insert. PostgreSQL's inner `COMMIT` can detach the migration from that
ledger write, contradicting the runner's atomicity guarantee.

The historical files remain unchanged. `unwrapMigrationTransaction()` scans
top-level SQL, ignoring strings, comments, quoted identifiers, and dollar-quoted
PL/pgSQL bodies. It removes only a matched outer wrapper at execution time and
fails closed on any other top-level transaction-control shape. Checksums still
use the untouched file contents.

## Mechanical inventory

| Migration | Required fixture venues |
|---|---:|
| 0026 | 2 |
| 0027 | 18 (nine removed aliases + nine canonical survivors) |
| 0028 | 3 |
| 0029 | 34 |
| 0030 | 258 |
| 0031 | 2 |
| 0032 | 124 |
| Deduplicated union | 402 |

## Safety case for the operator

1. **Blast radius:** the command writes only the database in `DATABASE_URL`.
   The attended runbook requires a newly recreated staging project.
2. **Detection:** checksum drift, ambiguous resume state, missing migration
   dependencies, missing fixture rows, invalid fixture fingerprint, SQL errors,
   and ledger failures all stop the run.
3. **Recovery:** before review, no database is touched. During the attended
   proof, a failure means discard/recreate staging and keep the failure output;
   never patch the ledger or hand-apply SQL.
4. **Data:** fixtures contain public catalog identity/copy plus synthetic
   staging data, with no users, reviews, ratings, hours, or photos.
5. **Access:** only the attended local shell receives staging `DATABASE_URL`.
   Production credentials must not be present.
6. **Cost:** no external APIs are called. Supabase staging is the only service used.
7. **Compatibility:** historical migration bytes and checksums do not change.
   The resulting schema is still exactly migrations `0000`–`0035`.
8. **Ownership:** the operator runs and observes the staging proof; any failure
   stops before release work continues.
9. **Business value:** repeatable staging rebuilds unlock migration rehearsal,
   RLS tests, profile-sync tests, restore drills, and safe release practice.

## Local evidence available to reviewers

- Focused tests cover the SQL inventory, fixture completeness, arbitrary
  missing-target refusal, duplicate survivors, schema constraints, bootstrap
  boundary, interrupted-run states, fixed fingerprint, and transaction unwrapping.
- `npm run typecheck` is clean.
- `git diff -- supabase/migrations` is empty.
- No real database execution has been claimed by this packet.

## Multi-model review lanes

Run each reviewer read-only against the same diff and require file/line evidence:

1. **Claude lead:** trace the empty-database sequence from `0019` through `0035`;
   challenge resume behavior and whether fixture installation occurs exactly once.
2. **Codex:** audit parser completeness, SQL transaction scanning, parameterized
   inserts, and whether any historical checksum can change.
3. **DeepSeek:** attack fail-closed properties—partial ledgers, absent markers,
   forged markers, interrupted commits, duplicate IDs, and missing targets.
4. **GLM:** audit PostgreSQL semantics, grants/RLS interaction, transaction
   ownership, and fresh/stale connection behavior.
5. **Kimi:** challenge data minimization and whether the fixture meaningfully
   preserves `0027`/`0028` business semantics rather than merely making tests green.

Required verdict: no reviewer may claim the staging build passes until the
attended procedure in `FRESH-STAGING-BOOTSTRAP-RUNBOOK-2026-07-31.md` completes.

## Panel round 1 — findings accepted and fixed (2026-07-31)

The full five-family panel ran read-only against the local diff. Six findings
were confirmed against repository evidence and fixed in this worktree:

1. **Fully-ledgered but never-seeded database reported success** (Claude HIGH,
   DeepSeek independently). `assertBootstrapResumeState`'s `!migrationWorkRemaining`
   fast path never looked at `barsCount`, so a `--force-baseline`d database
   printed "Database is up to date" over an empty catalog — the exact silent
   no-op this command exists to prevent. Now refused.
2. **Forged/stale marker over an empty catalog** (DeepSeek, Claude). With every
   catalog migration already in the ledger, `pendingCatalogDependencyIds` returns
   `[]` and the live-row check was skipped entirely. The marker is committed in
   the same transaction as the fixture rows, so a marker with zero bars is now
   refused outright. (DeepSeek's literal suggestion, `barsCount === required_count`,
   was **not** adopted: 0027 deletes 9 rows, so 419 becomes 410 and that equality
   would break every legitimate resume.)
3. **Unsupported transaction control failed OPEN** (Codex HIGH).
   `transactionCommand` recognised only `BEGIN`/`COMMIT`, so a top-level
   `ROLLBACK`, `START TRANSACTION`, `SAVEPOINT`, or the `COMMIT` alias `END`
   yielded zero controls and was passed through verbatim — ending the runner's
   transaction before its ledger INSERT. This is on the ordinary `db:migrate`
   path, not just `--bootstrap`. Now enumerated and rejected. No checked-in
   migration used these forms; the `end;` tokens in 0001–0007 are inside
   dollar-quoted PL/pgSQL bodies, which the scanner correctly skips.
4. **Environment label was an honour system** (Codex HIGH). The guard proved the
   two URLs identified the *same* project but never that the project was not
   Production. `NEXT_BAR_PRODUCTION_PROJECT_REF` is now required and the target
   is refused if it matches.
5. **Fixture boundary used a different comparator than file ordering** (Codex,
   GLM, lead). Files are ordered by code-unit `.sort()`; the boundary used
   `localeCompare`. They disagree — `.sort()` puts `0019-bars.sql` before
   `0019_bars_catalog.sql`, `localeCompare` puts it after — which would install
   the fixture before `public.bars` exists. Now one comparator.
6. **`CATALOG_DATA_MIGRATIONS` had no mechanical cross-check** (Claude HIGH, GLM,
   Kimi). The list of *which* migrations to scan was hand-maintained — the same
   drift risk the id extraction was built to avoid. A test now scans every
   post-0019 migration and fails if one targets bars by id without being listed.
   The list is complete as of 0035.

Also fixed: nested block comments (PostgreSQL block comments nest, and the
scanner exited on the first `*/`) and backslash escapes inside `E'...'` strings.

## Panel round 2 — findings accepted and fixed

Round 2 reviewed the round-1 fixes themselves. Four more confirmed, all fixed:

7. **`stripSqlComments` was not nesting-aware** (Codex HIGH). PostgreSQL block
   comments nest. The non-greedy `/\*[\s\S]*?\*\//` stopped at the first `*/`,
   so the statement `/* outer /* inner */ outer */ rollback;` was reduced to
   `outer */ rollback`, which no longer matched `^rollback` — the executable
   `ROLLBACK` became invisible to `transactionCommand` and was passed through
   verbatim. Reproduced before fixing; now a depth walk. Note this is a *second*
   nesting bug: round 1 fixed nesting in `topLevelStatements` but not here.
8. **`COMMIT AND CHAIN` and friends still failed open** (Codex HIGH, DeepSeek).
   Round 1 rejected an enumerated list of exact spellings, so
   `COMMIT AND CHAIN`, `COMMIT WORK AND NO CHAIN` and
   `BEGIN ISOLATION LEVEL SERIALIZABLE` matched neither the accepted forms nor
   the rejected list, returned null, and executed verbatim. Reproduced
   (`select 1; commit and chain;` passed through unchanged). Detection now keys
   on the leading verb, which closes the class rather than chasing spellings;
   bare `set` and bare `prepare` are deliberately excluded so
   `set search_path = ...` and `PREPARE name AS ...` still pass.
9. **Production denylist was case-sensitive** (Codex HIGH, Claude LOW).
   `NEXT_BAR_PRODUCTION_PROJECT_REF=PRODREF` silently disabled the guard against
   project `prodref`. All three refs are now trimmed and lowercased.
10. **The round-1 drift test was the wrong detector** (GLM, Codex, Claude).
    Asking "does this migration name venue ids?" is a proxy for the wrong
    invariant: `update public.bars set ...` with a predicate WHERE, a
    `delete ... where region = ...`, a `truncate`, or
    `update public.bars b ... from (values (...)) v(id) where b.id = v.id` all
    mutate the catalog while naming no ids, and sailed through. It is now a
    DML-target scan: every post-0019 migration that writes to `public.bars` must
    be either in `CATALOG_DATA_MIGRATIONS` or in an explicit
    `ROW_AGNOSTIC_CATALOG_WRITERS` allowlist with a stated reason. This already
    bit — `0020` and `0023` both write to `bars` without naming ids and were
    invisible to the old detector; both are genuinely predicate-driven and are
    now allowlisted with that reason recorded.

## Panel rounds 3 and 4 — the comment scanner, four versions deep

Round 3 reviewed the round-2 fixes and found that the nesting fix had itself
introduced a regression. The scanner went through four versions, each fixing the
last, and every intermediate failure was in the same direction — **hiding
executable transaction control, which fails OPEN**:

| Version | Defect | Found by |
|---|---|---|
| 1 — non-nesting regex | `/* a /* b */ c */ rollback` reduced to `c */ rollback`; the ROLLBACK stopped matching `^rollback` and was executed verbatim | Codex r2 |
| 2 — nesting, block comments stripped before line comments | `-- /* x` opened a block comment that never closed and swallowed the rest of the file, hiding a ROLLBACK on the next line. **This was a regression I introduced**; the original regex pair did not have it | lead probe, then Codex r3 and Claude r3 independently |
| 3 — nesting + correct precedence, but string-unaware | `select '/* /* */'` left the depth counter elevated forever. Nesting WITHOUT string-awareness is strictly worse than neither, because a lone `/*` in a literal used to self-heal at the first `*/` | Codex r3 |
| 4 — one state machine: line / nested-block / single / double / dollar, plus `E'...'` backslash escapes | current | — |

Also fixed in these rounds:

11. **`SET SESSION CHARACTERISTICS AS TRANSACTION` was unclassified** (Codex r3).
    It is transaction control and would have changed transaction defaults for
    every later migration on the reused connection.
12. **The DML-target scan missed quoted identifiers** (Kimi r3, Codex r3,
    Claude r3). `update "public"."bars"` names the same table. The pattern now
    tolerates optional quotes while still excluding `bars_archive`, `barsx` and
    `bar_rsvps`.
13. **`stripSqlComments` and `topLevelStatements` disagreed about `E'...'`**
    (GLM r3). Two hand-rolled lexers over the same text disagreeing is the
    recurring shape of every bug in this area, so they were brought into step.
14. **The scanner now refuses SQL that ends mid-literal or mid-comment**
    (DeepSeek r4, defence in depth). Ending in such a state means the scanner
    lost sync with PostgreSQL and every later boundary is a guess. A trailing
    `--` comment at EOF is explicitly still legal — every migration here ends
    with rollback notes that way. This can only ever over-reject, never fail
    open, and the exhaustive 36-file test proves it rejects none of them.

**Regression evidence for the scanner rewrite:** `expectedTablesFromMigrations`,
the other consumer of `stripSqlComments`, returns a byte-identical 19-table
result for all 36 migrations when compared against
`git show HEAD:src/lib/migrationPlan.ts`. The `--baseline` premise check is
therefore unaffected.

## Panel round 4 — one CRITICAL, and why the round mattered

Four of five lanes returned CONVERGED. Codex returned **NOT CONVERGED** with a
CRITICAL that the other four missed, and it was right:

15. **`$` is legal INSIDE an unquoted PostgreSQL identifier**, so
    `SELECT 1 AS foo$tag$;` is ONE identifier `foo$tag$` — not the alias `foo`
    followed by a dollar-quote opener. Both lexers treated any `$tag$` as an
    opener. Reproduced before fixing:
    `SELECT 1 AS foo$tag$; ROLLBACK; SELECT 2 AS bar$tag$;` was returned
    unchanged, hiding an executable ROLLBACK — **fail open** — while the valid
    single statement `SELECT 1 AS foo$tag$;` was wrongly refused as an
    unterminated body. Separately, `$é$` was not recognised as a tag at all,
    though tags follow identifier rules which admit non-ASCII letters.

    Fixed with a single `dollarQuoteTagAt()` helper now shared by BOTH lexers:
    a `$` cannot open a dollar-quote when preceded by an identifier character,
    and the tag charset is Unicode-aware. Sharing it also removes the last place
    the two scanners kept their own copy of the same rule.

16. **`expectedTablesFromMigrations` lacked the fail-closed guard**
    `topLevelStatements` had just gained (Claude r4). It silently dropped every
    `CREATE TABLE` after an unterminated comment and handed the baseline check a
    short list. It now runs the same guard.

**Convergence:** new findings per round ran 6 → 4 → 3 → 2. Kimi called the trend
"decay, not oscillation"; DeepSeek round 4 reported no residual fail-open. The
round-4 CRITICAL is the reason the panel ran a fifth round rather than stopping
at four — four lanes agreeing is not proof, and the one dissenting lane was the
correct one.

**A note on where the bugs were.** Every defect after round 1 was in the SQL
lexer, and each fix exposed the next. Kimi's structural read is on the record:
three hand-rolled partial parsers over the same text, hardened repeatedly, is
the wrong long-term shape. The parsing is now shared and heavily tested, but the
durable answer is to stop parsing SQL in the runner — either by using
PostgreSQL's own parser, or by moving enforcement into the engine (a catalog
write guard, or running non-allowlisted migrations under a read-only default) so
that any future lexer blind spot fails closed instead of open. That is recorded
as the recommended follow-up, not done here.

## Reviewer claims examined and REFUTED

Recorded because a rejected finding is evidence too, and the next reviewer
should not have to re-derive these:

- **DeepSeek:** "`barsCount === required_count` should be asserted." Rejected —
  0027 deletes 9 rows, so 419 becomes 410 and that equality would break every
  legitimate resume. Used `barsCount === 0` instead.
- **DeepSeek:** "a completed run re-invoked throws on the `some(n > 0019)`
  gate." Rejected — `migrationWorkRemaining` is `plan.apply.length > 0`, and
  `planMigrations` puts already-applied files in `plan.skip`, never `plan.apply`,
  so that state has `migrationWorkRemaining === false` and returns earlier.
- **DeepSeek:** "`process.exitCode = 1; return` can exit 0." Rejected — the
  `return` exits `main()` itself; the `finally` closes the client and Node exits
  with the set code. Nothing afterwards resets it.
- **GLM:** "an `E'...'` at offset 0 is misclassified because `sql[i-2]` is
  undefined." Rejected — the code reads `sql[i - 2] ?? ''`. GLM's underlying
  observation that `/[A-Za-z0-9_$]/.test(undefined)` is `true` is correct and is
  now pinned by a regression test.
- **GLM:** "`U&'...'` needs backslash-escape handling." Rejected — PostgreSQL
  `U&` strings escape a quote by DOUBLING it; the backslash only introduces
  `\XXXX`. Treating `'` as a terminator is correct, and adding escape handling
  would swallow a real terminator.
- **Kimi:** "0026 might pattern-match `ChIJ%` and skip the synthetic place_ids."
  Rejected — `0026_clear_misresolved_place_ids.sql` uses
  `and place_id is not null`; the branch does fire.
- **Kimi:** "the new refusals could deadlock the `--force-baseline` recovery
  path." Rejected — every new refusal is inside `if (BOOTSTRAP)`; `db:migrate`,
  `--baseline` and `--force-baseline` are untouched.
- **GLM:** "`E'O\'Brien'` closes the literal early and swallows a following
  ROLLBACK — a concrete fail-open." Rejected as stated: both cases throw, and
  `expectedTablesFromMigrations` still finds the table after. The reason is a
  property not visible from the packet — the string modes still APPEND every
  character, so a mis-parsed literal boundary can only affect whether a comment
  is stripped; it can never delete real SQL. The underlying inconsistency GLM
  pointed at was real and was fixed anyway (item 13).
- **DeepSeek:** "`0029`–`0032` unwrapping is fine because `unwrapMigrationTransaction`
  runs before `client.query('begin')`." Rejected — it runs after, inside the
  per-migration `try`. The behaviour is still correct because the `catch` issues
  a `rollback`, but the stated reason was wrong.
- **Kimi (round 5, NOT CONVERGED):** "`dollarQuoteTagAt`'s identifier guard also
  applies to the CLOSING delimiter, so `SELECT $$x$$; ROLLBACK;` conceals the
  ROLLBACK." Rejected — the helper recognises OPENERS only; both lexers close a
  body with `sql.startsWith(dollarTag, i)`, a plain tag match with no guard.
  Tested: that input and `SELECT $body$x$body$; COMMIT;` both throw correctly,
  while `SELECT $$x$$;` and a ROLLBACK genuinely inside a body are accepted.
- **DeepSeek (round 5, NOT CONVERGED):** "adjacent dollar-quotes
  `$tag$hello$tag$$another$` conceal transaction control." Rejected — that input
  throws (unterminated body), and juxtaposed string literals are not valid
  PostgreSQL in the first place. The realistic `$tag$a$tag$ || $another$b$another$;
  ROLLBACK;` throws correctly. Its secondary case (`SELECT 1$$;ROLLBACK;$$`) also
  throws, i.e. fail-closed, which DeepSeek itself conceded.

Both round-5 dissents came from packet-only reasoning about how the closing
delimiter is matched — a detail the packets had not stated. Adding one sentence
about it removed the whole class. **A reviewer's confident NOT CONVERGED is a
hypothesis until it is run.**

Kimi's warning against the *proposed* fix for the open item below was accepted:
offsetting fixture coordinates would make the fixture lie in order to make a
test feel honest. Its suggestion — assert the expected rows-affected instead —
is the better shape and is recorded as a follow-up.

## Open item requiring an operator decision

**Migrations 0029–0032 will update zero rows.** Measured, not inferred: all
34 + 258 + 2 + 124 = 418 coordinate targets are already bit-identical to the
values those migrations set, because `src/lib/bars.ts` was corrected in the same
historical commits. Each guarded `UPDATE ... WHERE abs(diff) > 1e-6` no-ops and
each migration's own "0 remaining" assertion passes trivially. The end state is
correct and nothing errors, so this does not block the build — but four of the
seven catalog migrations get no rehearsal, which is uncomfortably close to the
failure mode that started this. Fixing it means deliberately offsetting fixture
coordinates from the migration targets (as the `the-slaughtered-lamb-pub`
carve-out already does for 0028), which changes the fixture fingerprint and
makes staging start from a state that never existed. That trade is the
operator's call, not the reviewer's, so it is recorded here rather than applied.

## What this review cost, and what it says about the panel

Seven rounds, five families each. Findings per round: **6 → 4 → 3 → 2 → 1 → 1 → 0**.

Rounds 5 and 6 each closed with Codex alone dissenting, and Codex was right both
times — first that the dollar-quote guard read a UTF-16 code unit rather than a
code point (so a non-BMP identifier letter's low surrogate slipped through), then
that `/[\p{L}\p{N}_$]/u` is narrower than PostgreSQL's actual identifier rule.
PostgreSQL's own `scan.l` defines `ident_cont` as `[A-Za-z\200-\377_0-9\$]` —
**every** non-ASCII byte, so emoji, symbols, punctuation and combining marks all
count. `foo😀$tag$` therefore opened a dollar quote and hid an executable
ROLLBACK. The guard now models `scan.l` directly instead of approximating it with
Unicode properties.

Worth recording precisely because it is uncomfortable: on that final round
DeepSeek returned CONVERGED with the explicit reasoning that the guard and
PostgreSQL "both target exactly letters, digits, underscore, and `$`" — the very
premise that was false. A correct verdict reached through a wrong premise is not
evidence, and it agreed with two other lanes.

Two observations worth keeping:

- **The dissenting lane was right both times.** Rounds 4 and 5 each closed with
  four lanes voting CONVERGED and Codex alone voting NOT CONVERGED, and on both
  occasions Codex had found a genuine fail-open CRITICAL that the other four
  missed. Majority agreement was not evidence; the repository-grounded lane that
  could actually execute the code was. Had the panel stopped at "4 of 5 agree",
  both defects would have shipped.
- **Packet-only confidence produced the only false findings.** Every incorrect
  finding in this review came from a tool-disabled lane reasoning about an
  implementation detail it could not see — most sharply in round 5, where two
  independent lanes both returned NOT CONVERGED because neither packet had
  mentioned that the closing dollar delimiter is a plain tag match. One added
  sentence removed the entire class. Routed reviewers are hypothesis generators;
  the lead runs the code.

Process notes for the next reviewer: routed packets MUST state "you have no
tools" — reusing a repo-grounded Codex brief for GLM/DeepSeek/Kimi in round 5
produced three degenerate responses (hallucinated tool calls). And a routed
`exit 124` is a timeout, not an outage: GLM was declared unavailable once and
answered a health probe immediately afterwards.

## Residual risk

- `main()`'s bootstrap sequencing (install-exactly-once, `finishBootstrap`
  timing) is still verified only by code reading and the attended runbook; the
  pure helpers are unit-tested but the orchestration is not. A `pg` mock or an
  extracted pure decision function would close this.
- `npm run secret-scan` covers **tracked** files only (501). The new
  `scripts/lib/catalogBootstrap.*` files are untracked and were scanned by hand
  for this review; they will enter the automated gate when committed.
- Kimi's data-minimisation point stands in reduced form: only **16** of the 419
  fixture rows are synthetic, and 7 survive `0027` to persist in staging with
  `source = 'curated'` and placeholder coordinates. 0019's CHECK constraint
  restricts `source` to four values, so a `synthetic-bootstrap` discriminator is
  not available without editing a frozen migration; the synthetic blurb is
  currently the only tell.
- Plain `npm run db:migrate` against a fresh non-production database still
  reproduces the original incident (0026/0027 no-op, 0028 aborts). The redirect
  to `db:bootstrap` appears only in the failed-baseline message.
- **The runner still parses SQL by hand.** Ten of the sixteen findings were in
  that lexer. It is now shared, Unicode-correct, and covered by ~50 targeted
  tests, but the durable fix is to stop parsing: use PostgreSQL's own parser, or
  move enforcement into the engine (a catalog-write guard trigger, or running
  non-allowlisted migrations under a read-only default) so a future blind spot
  fails closed instead of open. Kimi made this the one thing it would require
  before a release-gating rebuild; it is a design change, not a review fix, so it
  is recorded here for the operator rather than applied.

## Final verdict — round 7, five-family quorum

| Lane | Round 7 verdict |
|---|---|
| Codex (gpt-5.6-sol, repository-grounded) | 0 findings, no remaining defects |
| DeepSeek | CONVERGED |
| GLM | CONVERGED |
| Kimi K3 (deep) | CONVERGED |
| Claude / Sonnet | CONVERGED |

**Quorum met: 5/5 on the final code.** No lane was counted on silence: every
degraded run (three routed timeouts, three degenerate tool-call responses, one
1-byte reply) was re-run with a corrected packet and only the completed response
counted.

**This review approves the CODE. It does not approve the staging build.** No
database was contacted. The attended procedure in
`FRESH-STAGING-BOOTSTRAP-RUNBOOK-2026-07-31.md` — including the two-browser
profile proof and the RLS/grants inspection — remains entirely ahead, and the
fresh-database goal cannot be marked complete until it passes.

## Verification evidence for this review

- `npm test` — **1653/1653** across 103 files (baseline before this work: 1598,
  so this review added 55 tests). Run 8 times.

  **One unrelated flake, disclosed rather than re-rolled away.** In 1 of those 8
  runs a single test failed:
  `src/lib/catalog.test.ts > perf budget (B1: full match over 5k bars) >
  matches() over 5,000 synthetic bars stays under 50ms`, with
  `expected 106.13 to be less than 50`. It is a wall-clock performance budget in
  `src/lib/catalog.ts` — a file this change does not touch — and it failed while
  several review subagents were saturating the machine. It is load-sensitive,
  not a regression from this work, but it is a real flake in the gate and an
  operator running the runbook's preflight under load may hit it. Re-run once
  and confirm the only failure is that same perf budget before proceeding; any
  other failure is a stop.
- `npm run typecheck` — clean. `npm run secret-scan` — clean (501 tracked files;
  the two new untracked `scripts/lib/catalogBootstrap.*` files were scanned by
  hand for this review and enter the automated gate on commit).
- `git diff --exit-code -- supabase/migrations` — empty, and
  `git status --porcelain -- supabase/migrations` — zero entries. Migrations
  0000–0035 are byte-for-byte unchanged and no new file was added there.
- `git diff --check` — clean.
- Fixture arithmetic re-derived independently of this packet's claims: 403 static
  catalog rows + 402 mechanically-derived dependencies = 419 fixture rows;
  SHA-256 recomputes to `e87d3c85…422e2`; 0027's `kept/removed` table yields 9
  pairs with all 9 removed ids present, giving 410.
- `expectedTablesFromMigrations` byte-identical (19 tables) against
  `git show HEAD:src/lib/migrationPlan.ts` — the `--baseline` premise check is
  unaffected by the lexer rewrite.
- `.sort()` and code-unit `>` proven equivalent over 200,000 random filename
  pairs, zero mismatches.

**No database was contacted at any point.** Nothing was applied, reset,
baselined, pushed, deployed, or merged. The staging proof in the runbook remains
entirely ahead of us.
