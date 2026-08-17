# Migration revert files

A round-1 reviewer found that `0059_night_outs_respond_revision.sql` line 42
says `Revert: REVERT-0059-staging-20260817.sql` — and that file existed nowhere
in this repository. An operator reaching for the revert under pressure would
follow the committed migration's own pointer and find nothing.

That is true of **every** revert file, not just `0059`. All of them were written
into the harness docs directory (`~/.claude/docs`) and none were ever committed.
This directory starts closing that.

## Why the files are here and not next to the migrations

`scripts/apply-migration-set.ts` reads migrations by explicit filename from
`supabase/migrations/` (`join(MIGRATIONS_DIR, name)`), so it does not glob and a
subdirectory cannot be swept into a migration set by accident. Verified: the
top-level `.sql` count is unchanged by this directory's existence.

A revert is **not** a migration. It is deliberately not numbered into the
sequence, because applying it is a rollback, not a forward step, and the ledger
row for the migration it reverses is deleted rather than added to.

## How to run one

The revert must restore the bodies **and** delete the ledger row **in one
transaction**. If those come apart, the ledger claims `0059` while the installed
bodies are `0058`, and a ledger-aware runner will then act on a false picture.

Nothing outside this repository is required:

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i supabase/migrations/revert/REVERT-0059-staging-20260817.sql
DELETE FROM public.schema_migrations WHERE name = '0059_night_outs_respond_revision.sql';
COMMIT;
SQL
```

Check the target first — `DATABASE_URL` names the serving database, and the
label identifies it rather than protecting it:

```
psql "$DATABASE_URL" -Atc "select current_setting('server_version'), current_user"
```

There is also a harness-local helper, `apply-single-migration.mjs`, which does
the same two steps atomically. It is **not committed here** and must not be the
only path you know: a round-2 reviewer correctly pointed out that a T0 rollback
runbook whose sole execution path lives outside the repository repeats — one
level removed — the very problem this directory was created to fix. The psql
recipe above is the repository-sufficient path; the helper is a convenience.

Do not use `npm run db:migrate` — it is ledger-blind and would replay every file.

## `0059` — read this before reverting it

**Reverting `0059` loses data, and `0058`'s revert did not.**

Dropping `response_revision` discards every stored revision. Re-applying `0059`
afterwards re-adds the column at `0` for every row.

**There is no "wait for it to recover" boundary.** An earlier draft of this file
said the guard was weakened only until rows moved past `0`. That was wrong, and a
reviewer supplied the counterexample: a delayed accept carrying `(declined, 1)`
against a row that is `accepted` at revision `2`; revert and re-apply resets that
row to `0`; an honest decline then moves it to `(declined, 1)` — past `0` — and
the delayed accept now matches and applies. The reset counter re-walks values it
has already issued, so **any** historical pair can collide again as it climbs.

The real boundary is time, not revision: the guard is fully sound again only once
no request holding a pre-revert pair can still arrive. Bound that by the client
and network timeouts of the surfaces that call `respond_night_out`, not by
watching the counter.

**So: do not revert and re-apply while responses are in flight.** If you must,
do it in a genuinely quiet window.

Reverting also reinstates the ABA hole itself: `repro-aba-cases-20260817.mjs`
cases 1 and 2 go RED again. That is the expected consequence, not a surprise.

Order matters inside the file: the trigger is dropped **before** the column,
because the trigger function references it.

## Still outstanding

`0044`–`0058` have revert files, but they live only in `~/.claude/docs` and are
**not** committed here:

```
REVERT-0044 REVERT-0045 REVERT-0046 REVERT-0047 REVERT-0048 REVERT-0049
REVERT-0050 REVERT-0051 REVERT-0052 REVERT-0053 REVERT-0054 REVERT-0057
REVERT-0058
```

Bringing those in is deliberately **not** done in this goal — its scope is the
ABA fix, and a thirteen-file import is someone else's reviewed change. Recorded
here so the gap is visible from the repository rather than only from a handoff
document.

Two of them carry warnings worth repeating before anyone imports them:
`REVERT-0044` is a drop of the entire Night Out feature and deletes every plan,
member, suggestion, vote and event row (it ships commented out), and
`REVERT-0054` discards every stored idempotency key.
