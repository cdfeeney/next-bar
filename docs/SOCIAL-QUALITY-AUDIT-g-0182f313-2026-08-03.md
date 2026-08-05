# Social-features quality audit — g-0182f313 (2026-08-03, operator priority)

Fable-lane static audit of every social surface at source state `0c8e62a`
(docs HEAD `5dcab5f`), commissioned by the operator: "I want to make sure
the social features are good." Verification alongside: the social e2e
bundle (claim-handle, friends-flow, friends-real, lists-flow, night-page,
nights-history, rankings-lists, share-card) ran **107 passed / 2 known
clipboard skips / 0 failed** on iPhone 13 + Pixel 7 at this source state.

## Verdict in one paragraph

The social core is in genuinely strong shape — consensus/suggestions,
night archive/unshare privacy (verified down to the SQL: unshare is a real
DELETE, no leak-after-unshare), the anonymous shared-night page, and the
/share/[barId] recipient-vote loop are defensively written and honestly
tested. **One CRITICAL product gap breaks the viral loop for real
accounts:** a signed-out recipient of a real user's /u/[handle] link is
told "No one here — they may not be on Next Bar yet," which is false and a
dead end. The fix is half-built already (migration 0015 `get_public_ratings`
+ `src/lib/publicList.server.ts`, unit-tested, wired into zero pages).
Close Friends remains correctly parked (a client-only tier flag would be a
fake privacy control — deliberate omission, not a gap).

## Findings (file-grounded; CODE defect vs PRODUCT gap)

| # | Sev | Kind | Finding | Anchor |
|---|-----|------|---------|--------|
| 1 | CRITICAL | product | Signed-out visitor on a REAL /u/[handle] gets the demo-only lookup → false "no one here" dead end; `get_profile_by_handle` is anon-revoked by design (0007) and `fetchPublicRatings` (0015, opt-in, anon-readable) is built but unused. Interim honest fallback: "sign in to see @handle's list" copy — needed even after 0015 lands (non-opted-in profiles). | `src/app/u/[handle]/page.tsx:82,135-137`; `src/lib/publicList.server.ts`; `supabase/migrations/0015_public_shared_list.sql` (UNAPPLIED) |
| 2 | CRITICAL | test gap | No e2e covers signed-out + real (non-demo) handle — exactly how #1 shipped unseen (`friends-real.spec.ts` is signed-in-only by design; `share-card.spec.ts` uses a demo handle). | `e2e/friends-real.spec.ts` |
| 3 | HIGH | product | `list_my_shared_nights` RPC missing: share a night → sign out/in (or switch device) → live world-readable token with NO in-app way to see/revoke it. Dogfooders sign in/out constantly. Needs the next attended migration session. | `src/lib/sharedNightsLocal.ts`; `docs/NIGHTS-OUT-NOTES-g-919dae84-2026-08-03.md` |
| 4 | MEDIUM | ops | Migration 0035 (`share_night` ±2-day bound) authored, reviewed, NOT applied — unbounded write-amplification live until the attended apply. Ride the same migration session as #3. | `supabase/migrations/0035_...` |
| 5 | MEDIUM | test gap | Unshare privacy proven at SQL level but no end-to-end chain test: share → capture link → unshare → visit link → "gone". | `e2e/nights-history.spec.ts` + `e2e/night-page.spec.ts` |
| 6 | LOW | code | `ShareNightButton` re-entrancy guard reads React state (stale-closure window) instead of the `inFlight` ref pattern `ShareButton` uses; harmless today (idempotent upsert). | `src/components/ShareNightButton.tsx:67` |
| 7 | LOW | product | When #1's opt-in ships, surface what "public list" means in settings/privacy copy (currently silent because unwired). | settings/privacy copy |

## Explicitly solid (audited, no action)

- Consensus/TonightSuggestions: the most defensively written surface
  audited (busy-through-refetch, distinct loading/empty/error, honest
  unrated-friends state).
- `useFollows`: placeholder-entry race guards, epoch-guarded writes,
  demo/server isolation. `claim_handle` collision handling race-safe.
- Night archive rollover snapshot semantics; per-night busy independence;
  orphaned-shared-night rows stay revocable.
- Shared-night page: handle-spoof → "gone" (page AND OG route), no viewer
  location on the map, share-onward.
- Link canonicalization: server metadata via `siteIdentity` (env switch),
  client shares via `window.location.origin` — correct under next-bar.com
  post-cutover with NO code change (deliberate, sound split).
- Close Friends: parked deliberately; do NOT ship a client-only tier flag
  before server enforcement exists.

## Sequencing for the hardening goal

Phase A (no migration, safe any session): #1 interim honest fallback copy
+ #2 the missing e2e (asserting the new honest state) + #6 ref guard.
Phase B (attended migration session): apply 0015 + settings opt-in +
wire `fetchPublicRatings` (#1 full fix, #7 copy) and author+apply
`list_my_shared_nights` (#3) + apply 0035 (#4) together (same tables) +
#5 round-trip e2e once real RPCs are live.
