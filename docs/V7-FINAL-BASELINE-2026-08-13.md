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

- Unit tests: 1,024 / 1,024 passed.
- TypeScript: passed (`tsc --noEmit`).
- Production build: passed; root first-load JS 195 KB on Vercel.
- Focused distance-band Pixel 7 flow: 1 / 1 passed, retries 0. The test checks
  every returned bar against the actual band boundaries.
- Focused Map Pixel 7 flows: 9 / 9 passed, retries 0.
- Earlier focused V7 flows: 16 / 16 passed, retries 0.
- Complete two-device Playwright attempt exceeded the five-minute command limit
  before producing a final report. This gate remains open; focused green runs
  are not a substitute for its final result.
- WebKit/iPhone automation: not run; matching WebKit executable is absent.
- Public staging renders five cards for each distance selection. Exact public
  distance correlation could not be extracted reliably because Places UI Kit
  lazily mounts identity inside its widget; the deterministic local Playwright
  band assertion is the current exact evidence.

## Promotion state

- Local integration worktree: `D:/harness-worktrees/nb-v7-integration-20260813`
- Branch: `harness/nb-v7-integration-20260813`
- Deployed staging commit: `6ee4885e8dd6d4cfa2b57ff54d5962c4c51bcd2c`
- Staging deployment: `dpl_Ai5jzfm3Y3ikmWj7dadPxWpf3M68`
- Staging alias: `https://next-bar-staging.vercel.app`
- No TestFlight upload, App Store submission, production database write, Vercel
  production-project change, or Supabase migration was performed.

## Final attended release checklist

- [x] Deploy the frozen V7 code candidate to the staging Vercel project.
- [ ] Confirm Map has no horizontal page overflow on the physical iPhone.
- [x] Confirm `Tweak the vibe` and all three distance bands in focused automation.
- [ ] On Tester 1 / Conor Feeney, confirm Bar 54 and existing account data remain.
- [ ] Add two bars with the same numeric score and confirm both retain it.
- [ ] Force-close/reopen and confirm sign-in, Bar 54, lists, and numeric scores.
- [ ] Run the complete staging smoke suite against the deployed candidate.
- [ ] Upload a new TestFlight build without changing the movable Vercel alias.
- [ ] Repeat the physical-phone continuity check on that TestFlight build.
- [ ] Freeze V7 as the internal TestFlight baseline for V8. Do not submit V7 to
  App Store review or public production.
