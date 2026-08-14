# V7 final baseline — 2026-08-13

## Release definition

V7 is the Manhattan catalog, compliant live Google media, account-safe catalog
delivery, and the final small UI correction pass. V8 work is explicitly outside
this release. V7 is an internal TestFlight release only; App Store submission is
deferred until a later version (currently expected around V11).

## Included in V7

- Supabase-first catalog delivery; no generated Places catalog in client chunks.
- 1,667 staging venues: 1,519 Manhattan, 109 Brooklyn, 39 Queens.
- Google Places UI Kit runtime photos with the existing runtime kill switch.
- Home result cards and Map bar lightboxes both use the live Google photo path.
- Map search, marker tiers, location behavior, and the expanded Manhattan map.
- Map controls show `Tweak the vibe` as one collapsed disclosure. Neighborhood
  is a matching accordion row beside Drink, Energy, Setting, Scene, Sound, and
  Spend. Map has no distance controls.
- Next Bar has no neighborhood or `Pick my bar` controls. `Walkable`, `Worth a
  cab`, and `Anywhere` remain visible and are true non-overlapping bands:
  0–1.5 miles, >1.5–4 miles, and >4 miles respectively.
- Rankings no longer expose the `All / Loved / Liked / Pass / Want to go`
  filter row or tier badges.
- Ranking entry is numeric-first: one exact score from 0.0–10.0, one decimal,
  and ties are allowed.
- Want to Go lives under `Your lists`; named-list creation remains there.
- Existing v6 ratings, scores, lists, account cache, night history, and pairwise
  transcript are preserved. V7 does not rename or clear their storage keys.
- Numeric ranking reuses the existing `ratings.score` column and the existing
  rating sync path; it does not require a database migration.

## Verification snapshot

- Unit tests: 1,025 / 1,025 passed.
- TypeScript: passed (`tsc --noEmit`).
- Production build: passed; root first-load JS 195 KB on Vercel.
- Focused distance-band Pixel 7 flow: 1 / 1 passed, retries 0. The test checks
  every returned bar against the actual band boundaries.
- Focused Map Pixel 7 flows: 9 / 9 passed, retries 0.
- Earlier focused V7 flows: 16 / 16 passed, retries 0.
- Matching WebKit 2287 is installed under `D:/PlaywrightBrowsers`; no browser
  files were installed on C:.
- Full sharded Pixel 7 sweep (148 tests): 104 passed, 44 intentionally skipped,
  0 failed, retries 0.
- Full sharded iPhone 13/WebKit sweep (148 tests): 102 passed, 44 intentionally
  skipped, 2 parallel-load failures, retries 0. Both failures are documented
  Next dev-server/WebKit navigation races and each passed once serially with
  retries 0; no functional product failure reproduced.
- One stale heading assertion was corrected from `Rankings` to the shipped
  `Bar Rankings`; its focused WebKit check passed 1 / 1 with retries 0.
- The earlier four-worker WebKit failures came from Next dev-server route
  compilation forcing full-page reloads during navigation. Release evidence now
  sets `PLAYWRIGHT_RELEASE=1`, which runs `next build` / `next start`; the
  four-worker iPhone app-shell pack passed 13 / 13 with retries 0.
- Focused release-mode iPhone closure checks passed 4 / 4 with retries 0: Home
  and Map have no document-level horizontal overflow, visible Home buttons meet
  the 44px minimum, and the V7 continuity fixture retains ratings, tied scores,
  a named list, and night history across navigation and reload.
- Public staging renders five cards for each distance selection. Exact public
  distance correlation could not be extracted reliably because Places UI Kit
  lazily mounts identity inside its widget; the deterministic local Playwright
  band assertion is the current exact evidence.
- Deployed staging read-only WebKit smoke: 9 / 9 passed, retries 0. Pages, OG
  images, Supabase reachability, and build identity passed. `/api/health`
  reports `7959007b5ca3`, the deployed commit prefix.

## Promotion state

- Local integration worktree: `D:/harness-worktrees/nb-v7-integration-20260813`
- Branch: `harness/nb-v7-integration-20260813`
- Integrated V7 source commit: `2ce81c158bd4bc8c99d2aed138cfb042488c099a`
- Deployed staging commit: `7959007b5ca3853391334d16542a65386a7744a6`
- Staging deployment: `dpl_6onbFMFk9VbHKeHcjsrFv2WrKZ5t`
- Staging alias: `https://next-bar-staging.vercel.app`
- Internal TestFlight upload: version/build `1.0 (7)`, GitHub run
  `31760573887`, successful from the integrated V7 source commit with the
  staging alias as its server URL.
- Physical upgrade: the operator installed `1.0 (7)` over the existing V6 app
  without uninstalling it and confirmed that the existing account remained
  signed in. This is direct evidence that the V7 update did not clear the
  installed authentication state.
- No App Store submission, production database write, Vercel production-project
  change, or Supabase migration was performed.

## Final attended release checklist

- [x] Deploy the frozen V7 code candidate to the staging Vercel project.
- [ ] Confirm Map has no horizontal page overflow on the physical iPhone.
- [x] Add and pass a release-mode WebKit guard for document-level Map overflow.
- [x] Confirm `Tweak the vibe` and all three distance bands in focused automation.
- [x] On Tester 1 / Conor Feeney, confirm authentication remains valid and Bar
  54 is still present (operator verified 2026-08-13).
- [ ] Confirm the remaining existing lists, scores, night history, and shared
  state on Tester 1.
- [ ] Add two bars with the same numeric score and confirm both retain it.
- [ ] Force-close/reopen and confirm sign-in, Bar 54, lists, and numeric scores.
- [x] Add and pass a V7 continuity fixture covering tied numeric scores, a named
  list, night history, navigation, and reload without changing storage keys.
- [x] Clear obsolete V7 fixtures and run both complete device matrices.
- [x] Remove Next dev-server compilation from the release gate and pass the
  iPhone app-shell pack 13 / 13 under four workers with retries 0.
- [x] Run the complete deployed staging smoke suite (9 / 9, retries 0).
- [x] Restore staging build identity and confirm `/api/health` reports the
  deployed commit prefix.
- [x] Upload V7 `1.0 (7)` to internal TestFlight without changing the movable
  Vercel alias.
- [x] Install `1.0 (7)` over V6 without uninstalling and confirm the existing
  account remains signed in (operator verified 2026-08-13).
- [ ] Complete the deeper V7-to-V8 continuity fixture: lists, scores, night
  history, shared state, and tied numeric scores. Authentication continuity is
  verified; these additional objects are not claimed as physically rechecked.
- [x] Freeze V7 as the internal TestFlight baseline for V8. Do not submit V7 to
  App Store review or public production.
