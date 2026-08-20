# Migration revert files

**This file is the single source of truth for reverting `0059` and `0064`.**
Nothing else — not the migration header, not the revert SQL, not the revert-point
doc — restates what a revert costs or when it is safe.

> **Order matters.** Each revert script refuses while any migration numbered
> above it is in the ledger. `0064` is the head, so it comes off first.

That rule exists because it was learned the hard way. Four review rounds on this
change were spent almost entirely on the same claim drifting between copies of
itself: the recovery boundary was stated three different ways in three files, and
each correction left a stale twin somewhere else. One statement, one place,
pointers everywhere else.

## Why the files are here and not next to the migrations

`scripts/apply-migration-set.ts` reads migrations by explicit filename from
`supabase/migrations/` (`join(MIGRATIONS_DIR, name)`), so it does not glob and a
subdirectory cannot be swept into a migration set by accident. Verified: the
top-level `.sql` count is unchanged by this directory's existence.

A revert is **not** a migration. It is deliberately not numbered into the
sequence, because applying it is a rollback and the ledger row for the migration
it reverses is deleted rather than added.

## How to run it (`0059`)

One command, **run from the repository root**. It works in PowerShell, cmd and
bash alike, which is the point — the operator is on Windows, and an earlier
version of this file documented a bash heredoc that PowerShell cannot parse:

```
psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/migrations/revert/revert-0059-transaction.sql
```

From anywhere else, pass an absolute path. `psql` resolves the `-f` argument
against **your current directory** — only the script's internal `\ir` include is
script-relative. An earlier version of this file claimed the command worked from
anywhere; a reviewer caught that it does not.

`revert-0059-transaction.sql` wraps the body restore and the ledger delete in one
transaction. It **refuses before touching anything** unless `0059` is actually in
the ledger and is the newest migration there — so a wrong target, a second run,
or a ledger that has moved past `0059` all stop up front rather than committing a
body downgrade. Its postcondition then confirms the row is gone and `0058`, whose
bodies are now installed, is still recorded.

Confirm the target first — the connection string names the serving database, and
the environment label identifies it rather than protecting it:

```
psql "<connection-string>" -Atc "select current_user"
```

**Do not** run `REVERT-0059-staging-20260817.sql` on its own: it restores the
bodies without unrecording `0059`, leaving the ledger describing a migration that
is no longer installed. **Do not** use `npm run db:migrate` — it is ledger-blind
and would replay every file.

There is also a harness-local helper, `apply-single-migration.mjs`, in
`~/.claude/docs`. It is **not committed here**, so it is a convenience and never
the path of record. In revert mode it now requires the migration name explicitly:

```
node ~/.claude/docs/apply-single-migration.mjs <revert-file> revert 0059_night_outs_respond_revision.sql
```

It previously hard-coded `0058` and would have deleted the wrong ledger row —
found by review on 2026-08-17 and fixed. Prefer the psql path above.

## What reverting `0059` costs

**It loses data, and `0058`'s revert did not.** Dropping `response_revision`
discards every stored revision. Re-applying `0059` afterwards re-adds the column
at `0` for every row.

**There is no waiting period that makes re-applying safe.** Two earlier drafts of
this file got that wrong in two different ways, and both are worth stating so
nobody re-derives them:

- *"The guard recovers once rows move past revision 0."* **False.** A delayed
  accept carrying `(declined, 1)` against a row that is `accepted` at `2` will
  match again after a reset, once an honest decline moves that row to
  `(declined, 1)` — which is past `0`. The reset counter re-walks values it has
  already issued, so **any** historical pair can collide as it climbs.
- *"Bound the window by client and network timeouts."* **Also false.** A stale
  pair is not only held by requests in flight. Both response surfaces
  deliberately pass the value they RENDERED and never re-fetch at click time —
  that is the design that keeps the replay window out of the client — so a tab or
  installed PWA left open across the revert holds a pre-revert pair with **no
  expiry** and can send it days later.

So: **expect stale open clients to survive any quiet period.**

**There is no cheap safe way to reintroduce this after a revert, and an earlier
version of this file claimed there was.** It said to bring the change back under
a new migration number "so the counter starts from a state no client has seen".
That is false, and the two bullets above disprove it: the migration number is
invisible to clients and to the CAS. Re-adding `response_revision` with
`default 0` under *any* number restarts every row at `0` — a state every
pre-revert client has seen — and the counter then re-walks `0, 1, 2 …` into
exactly the collisions described above.

**There is exactly one thing known to be sufficient**, and it has to be set up
*before* you revert:

> Seed the counter **above every value previously issued**, so no historical pair
> is reachable again.

That covers both populations of stale pair — sessions holding a rendered value,
and requests already emitted and still in flight — because neither can name a
revision the counter will ever reach again. The catch is that the revert destroys
the data needed to compute that maximum, so it must be **captured before
reverting**. If you did not capture it, this option is gone.

**A forced client re-sync is NOT sufficient**, and an earlier version of this file
said it was. Reloading every client means no *session* still holds a pre-revert
pair — but it cannot recall a request already **emitted**. A response sent moments
before the revert, delayed in the network or sitting in a retry queue, still
carries its old pair; after re-apply, a pending member's row is back at
`(pending, 0)`, which such a request matches immediately, with no counter climb
needed. A re-sync is worth doing and it is not a guarantee.

That is the honest state: **if you did not capture the high-water mark before
reverting, this document cannot tell you when the guard is sound again.** Treat
reintroduction as a design question for whoever does it, with the facts above as
the inputs — not as a procedure to follow from here.

Reverting also reinstates the ABA hole itself: `repro-aba-cases-20260817.mjs`
cases 1 and 2 go RED again. Expected, not a surprise.

Order inside the body file matters: the trigger is dropped **before** the column,
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
ABA fix, and a thirteen-file import deserves its own review. Recorded here so the
gap is visible from the repository rather than only from a handoff document.

Two of them carry warnings worth repeating before anyone imports them:
`REVERT-0044` is a drop of the entire Night Out feature and deletes every plan,
member, suggestion, vote and event row (it ships commented out), and
`REVERT-0054` discards every stored idempotency key.

---

## Reverting `0064` (friend-visible numeric score)

One command, from anywhere — `revert-0064-transaction.sql` includes no other
file, so nothing is resolved relative to the script:

```
psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/migrations/revert/revert-0064-transaction.sql
```

It restores `0007`'s tier-only `get_friend_ratings()` and deletes the `0064`
ledger row in ONE transaction, refusing up front unless `0064` is in the ledger
and is the newest row there. Its postconditions then confirm the row is gone, the
restored function returns no `score` column, and `anon` still holds no EXECUTE.

### What reverting `0064` costs

**No data is lost.** `0064` creates no table, drops no column and updates no row
— it replaces one function definition and re-states its grants. `ratings.score`
has existed since `0001` and is untouched, so a revert loses nothing that a
re-apply would not immediately restore.

**Re-applying afterwards is safe**, and this is the difference from `0059`: there
is no counter to re-walk and no client-held value that becomes reachable again.
Applying `0064` a second time is also safe on its own terms — it is
drop-if-exists plus create-or-replace.

**What a revert DOES break is the caller.** `src/lib/follows.server.ts` maps
`row.score` through `toScore()`, which turns the now-absent column into `null`
rather than throwing — so `fetchFriendRatings` keeps working and every score
silently becomes `null`. Anything that reads those scores (Group Favorites'
unanimous `>= 8.0` rule) will read them as unset, not as an error. Revert the
code half too, or expect that.

**The window is not zero.** The revert drops the function before recreating it,
so a concurrent call in that instant errors rather than returning wrong rows.
Prefer a quiet moment; the transaction holds the lock for milliseconds.
