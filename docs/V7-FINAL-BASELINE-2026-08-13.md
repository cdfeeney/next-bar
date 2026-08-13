# V7 final baseline — 2026-08-13

## Release definition

V7 is the Manhattan catalog, compliant live Google media, account-safe catalog
delivery, and the final small UI correction pass. V8 work is explicitly outside
this release.

## Included in V7

- Supabase-first catalog delivery; no generated Places catalog in client chunks.
- 1,667 staging venues: 1,519 Manhattan, 109 Brooklyn, 39 Queens.
- Google Places UI Kit runtime photos with the existing runtime kill switch.
- Map search, marker tiers, location behavior, and the expanded Manhattan map.
- Map controls now show `Tweak the vibe` as one collapsed disclosure.
- `Walkable`, `Worth a cab`, and `Anywhere` remain visible and wrap within the
  phone viewport; neighborhood and vibe choices open inside the disclosure.
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

- Unit tests: 1,022 / 1,022 passed.
- TypeScript: passed (`tsc --noEmit`).
- Production build: passed; root first-load JS 193 KB.
- Focused Pixel 7 flows: 16 / 16 passed, retries 0.
- Pixel 7 score-render regression correction: 3 / 3 passed, retries 0.
- WebKit/iPhone automation: not run; matching WebKit executable is absent.
- In-app browser visual inspection: unavailable because no browser backend was
  exposed to this session. Phone-sized Playwright interaction checks passed.

## Promotion state

- Local integration worktree: `D:/harness-worktrees/nb-v7-integration-20260813`
- Branch: `harness/nb-v7-integration-20260813`
- Previously deployed staging commit: `e239915b2184b600b60e309a4374649ade8ca7d4`
- The UI correction commit documented here is not deployed by this work item.
- No TestFlight upload, App Store submission, production database write, Vercel
  alias change, or Supabase migration was performed.

## Final attended release checklist

- [ ] Deploy the frozen V7 candidate to the staging Vercel project.
- [ ] Confirm Map has no horizontal page overflow on the physical iPhone.
- [ ] Confirm `Tweak the vibe` expands/collapses and all three distances work.
- [ ] On Tester 1 / Conor Feeney, confirm Bar 54 and existing account data remain.
- [ ] Add two bars with the same numeric score and confirm both retain it.
- [ ] Force-close/reopen and confirm sign-in, Bar 54, lists, and numeric scores.
- [ ] Run the complete staging smoke suite against the deployed candidate.
- [ ] Upload a new TestFlight build without changing the movable Vercel alias.
- [ ] Repeat the physical-phone continuity check on that TestFlight build.
- [ ] Only then promote V7 to App Store review/production.
