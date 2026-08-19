# Next Bar — agent operating notes

Project context lives in `docs/PRD.md`, `docs/PRD-v0.3.1.md`, `docs/PRD-v0.5.md`,
and `docs/ARCHITECTURE-v0.2.md`. Read those before making non-trivial changes.

## Testing principle: every interactive feature gets an e2e test

Connor caught a "rating a bar pushes me back to home" bug manually that should
have been caught by Playwright. Don't repeat that.

**Before claiming a feature works:**

1. **Smoke**: at minimum, an e2e test that visits the route and asserts a
   recognizable heading / control renders. See `e2e/app-shell-smoke.spec.ts`
   for the pattern. Add a new entry whenever you add a route.
2. **Interaction**: every button or control that does something user-visible
   gets an e2e assertion on the resulting state — including the *negative*
   state, e.g. "tapping this does NOT change the URL" / "tapping this does
   NOT close the modal." Negative assertions catch the bugs unit tests miss.
3. **Both viewports**: Playwright config runs against `iPhone 13` and
   `Pixel 7`. Don't add a test that only passes on one. Same e2e is run
   against both — make assertions viewport-agnostic.
4. **Both auth modes** when behavior diverges: signed-in vs signed-out paths
   for `useRatings` / `/rankings` / `/settings` should each have at least one
   test. Server-mode and local-mode are different code paths and have
   regressed independently.

**Known dev-server flake to expect, not chase:** the Next.js dev server
cold-compile of `/quiz` occasionally races with `page.goto('/quiz')` from
Playwright workers. Failure signature: `Error: page.goto: Navigation to
"http://localhost:3000/quiz" is interrupted by another navigation to "/"`.
Production builds are unaffected. If you see ONLY this one flake, re-run
once before debugging.

## Database migrations

SQL migrations live in `supabase/migrations/` as numbered `.sql` files and must
be idempotent (`CREATE ... IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc.).

**There IS a `public.schema_migrations` ledger.** It records each applied file's
name and a checksum, and was created by `0036_protect_schema_migrations.sql`.
This section previously said no ledger existed — it was already wrong, and it
sat directly in front of a destructive operation.

**Do not run this worktree's `npm run db:migrate` against a shared database.**
`scripts/apply-migrations.ts` here is ledger-BLIND: it re-executes every file in
lexical order regardless of what the ledger says. `nb-overnight`'s runner is the
ledger-aware one (hashes each file, records it, refuses ambiguous partial state)
and is what should be used. A blind replay re-runs the base schema over a
database that has moved well past it — including re-granting privileges that
`0034_revoke_first_grants.sql` had tightened. That is reason enough; it does not
depend on any checksum claim.

**The ledger's checksum is NORMALISED — CRLF folded to LF, then whitespace
stripped from the END OF THE FILE (not per line) — not a hash of the raw bytes.**
The one implementation is `src/lib/effectiveMigration.ts`. Which function you
want depends on what you already hold: a caller with the bytes in hand — an
applier, which must certify exactly what it runs — calls `checksumOfSql(text)`,
as `scripts/apply-migration-set.ts` does; a caller naming a repository file calls
`migrationChecksum(file)`. Never reach for the file-taking one from a script that
has already read the file: its directory is resolved from the module's location,
so it can hash a different checkout's copy, and a second read is a second
snapshot regardless.

This paragraph previously said eleven `0000`–`0010` files "differ from the
checksums recorded in the live ledger" (verified 2026-08-16). Re-measured
against the serving staging ledger on 2026-08-19 with the ledger's own
algorithm: all eleven are present and all eleven MATCH, as do all 35 rows whose
file exists on this branch, with zero drift. The 2026-08-16 reading compared raw
bytes to a normalised ledger on a `core.autocrlf` checkout, which reports drift
for every multi-line file. Do not re-derive that claim by hashing raw bytes.

Before applying anything: read the ledger, apply only files absent from it, and
number new migrations ABOVE the live maximum. Two branches independently minted
a `0020` and a `0021`; ours were renumbered to `0043`/`0044` to clear it.

## Other ground rules

- **Connor is on Windows.** No Mac. The iOS App Store path uses PWABuilder +
  iTMSTransporter (Java, runs on Windows) or cloud Mac CI — never assume a
  local `xcodebuild`.
- **Marketing landing lives at `/install`,** not `/`. `/` is the app surface
  (Where-next BarPicker).
- **5-tab bottom nav** (Next Bar? · Map · Rankings · Friends · Settings) is
  hidden on `/install`, `/join`, `/api/*` only. If you add a new tool route,
  decide explicitly whether it gets a tab or sits outside the nav.
- **Ratings are 3-tier** (Loved · Liked · Pass) in code even though PRD-v0.3.1
  reads 4-tier. Don't reintroduce "Meh" without explicit confirmation.
- **Pre-existing dev-server cold-compile flake** on `/quiz` is documented in
  memory. Don't try to "fix" it by adding waits or restructuring — it's a
  Next.js dev artifact, not a product bug.
