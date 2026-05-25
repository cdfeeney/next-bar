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

SQL migrations live in `supabase/migrations/` as numbered `.sql` files. Apply
them with `npm run db:migrate` — the runner reads `DATABASE_URL` from
`.env.local` and applies every file in lexical order. Migrations must be
idempotent (`CREATE ... IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc.) —
there's no schema_migrations ledger yet.

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
