# Next Bar — v0.3.1 PRD

**Status:** Draft for council review
**Date:** 2026-05-16
**Author:** Connor (with Claude Code)
**Prior PRD:** v0.2 shipped (`docs/PRD.md` v5) — Manhattan-only matcher, Where-next mode, mobile-first, Beli-style restructure (home = Where-next, /quiz = vibe quiz).

---

## 1. Why v0.3.1

v0.2 proves the matcher works. The product is now in "I picked the bar" or "I took the quiz, here are 3 results" mode — single-shot. To become Beli-like (the user's stated north star), it needs three things:

1. **Memory of where the user has been.** A user who picked Death & Co in Where-next last Friday should be able to say "I went, here's what I thought" and have that persist.
2. **A list view of those judgments** — what they liked, didn't, want to go back to.
3. **Persistent navigation** so Where-next isn't the only screen they see.

v0.3.1 builds the bones for all of that, **without** the social/cloud-sync layer. Ratings live in localStorage on the user's device. v0.3.2 adds Supabase + optional cloud sync + social discovery.

## 2. Goals (must achieve in v0.3.1)

- **G1:** Persistent bottom nav across `/`, `/quiz`, and a new `/saved` route. Tabs: **Where next · Quiz · Saved**.
- **G2:** Every bar (in result cards, BarPicker, anywhere visible) gets a rating action. User picks one of: **Loved · Liked · Meh · Pass**.
- **G3:** Rated bars are stored in localStorage and surface in `/saved`, sorted by rating (Loved → Liked → Meh → Pass) then by most-recently-rated descending.
- **G4:** Rating state shows on the bar wherever it appears — a small badge on result cards, in the bar detail view, in `/saved`.
- **G5:** Existing routes and v0.2 flows continue to work — `/quiz`, `/`, `/join`, `/where-next` (redirects).

## 3. Non-goals (deferred to v0.3.2 or later)

- Cloud-sync of ratings via Supabase.
- Auth (magic link or otherwise).
- Social discovery — "what others rated" is out.
- Profiles, friends, follow graphs.
- Photo galleries of bars (separate v0.3 stream — needs Google Places API).
- Real walk/Uber time from routing API.
- Outer-borough expansion.
- Editing or deleting bars from the user's history (just rate over to change).
- Sharing a saved list via URL.

## 4. Decisions (for council to debate)

### D1 — Rating taxonomy

Three candidates:
- **(a) 4-tier discrete:** Loved · Liked · Meh · Pass. Beli's exact pattern. Forces clear judgment.
- **(b) 5-star numeric:** classic but encourages 3-star "fine" defaults that have no signal.
- **(c) Thumbs up/down:** simplest but loses the "Pass" (never going back) signal that's actually useful for matching.

**Recommended:** (a) — matches the Beli reference, gives the matcher useful tag-weighting later (Loved boosts; Pass excludes).

### D2 — Where the rating UI lives

Three options for where the user actually taps a rating:
- **(a) Inline on every result card.** A small row at the bottom of each ResultCard: "Been here? [Loved] [Liked] [Meh] [Pass]". Always visible.
- **(b) Dedicated bar detail screen at `/bar/[id]`.** Tap a result card → opens a detail view with blurb, address, map, and a big rating control. Card itself becomes a tap-to-open-detail link.
- **(c) Modal sheet on long-press / "Rate" button.** Pin-style action menu.

**Recommended:** (b) **with a small inline rating chip** on cards for previously-rated bars (read-only badge). The card is already a Google-Maps anchor — change it to navigate to `/bar/[id]` internally; add a "View on Maps →" button inside the detail view for external map. Detail view = focus = better rating UX.

### D3 — Default sort + filter in `/saved`

- **(a) By rating tier, then recency.** Loved first, then Liked, then Meh, then Pass.
- **(b) By recency only.** Most recently rated at top.
- **(c) By neighborhood groupings.** Like BarPicker.

**Recommended:** (a) — primary axis is "what did you love." A small filter chip row above can toggle: All · Loved · Liked · Meh · Pass.

### D4 — Bottom nav implementation

- **(a) Plain `<nav>` element at the bottom, position:fixed, only on mobile viewports.** Renders inside the root layout. Three tabs.
- **(b) Slide-out drawer triggered by a hamburger.** More room but worse discoverability.
- **(c) Top tabs.** Common on Android, less common on iOS.

**Recommended:** (a) — Beli, Instagram, every modern mobile app uses this. Fixed bottom, ~64px tall, three tabs centered.

## 5. Success criteria

- `npm run typecheck` clean.
- `npm run test` — new vitest coverage for `ratings` lib (CRUD + sort), plus existing 64 still pass.
- `npm run build` — 5 → 6 routes (`/saved` added).
- `npm run test:e2e` — existing 10 still pass + 2 new specs:
  - User rates a bar from `/bar/[id]`, returns to `/saved`, sees it there.
  - Bottom nav navigates between Where next / Quiz / Saved without remounting state unexpectedly.
- Manual iPhone Safari: bottom nav stays pinned during scroll, doesn't fight Safari's own bottom URL bar (`safe-area-inset-bottom` respected).

## 6. Implementation outline

1. **Architecture pass:**
   - Define `Rating` type (`'loved' | 'liked' | 'meh' | 'pass'`) and `BarRating` record (`barId`, `rating`, `ratedAt`).
   - Define `ratings.ts` lib: `loadRatings`, `setRating(barId, rating)`, `getRating(barId)`, `clearRating(barId)`. localStorage key `next-bar:ratings:v1`.
   - Define `useRatings` hook for reactive read/write (subscribe to localStorage changes for in-tab updates).
   - Decide root layout vs per-page bottom nav placement.

2. **Test-first (vitest):**
   - `ratings.test.ts` — CRUD, sort by tier-then-recency, malformed-JSON resilience.
   - Hook test for `useRatings` (mocked localStorage).

3. **Implementation:**
   - `src/lib/ratings.ts` + `src/hooks/useRatings.ts`.
   - `src/components/RatingControl.tsx` — 4-tier picker, active state, ~44pt buttons.
   - `src/components/RatingBadge.tsx` — small read-only chip showing current rating on result cards.
   - `src/components/BottomNav.tsx` — fixed 3-tab nav with active route highlighting (uses `usePathname`).
   - `src/app/bar/[id]/page.tsx` — bar detail screen: name, neighborhood, price, blurb, map, big rating control, "View on Maps →" link.
   - `src/app/saved/page.tsx` — list rated bars, filter chips, sort by tier+recency.
   - Root layout (`src/app/layout.tsx`) gets the BottomNav + safe-area inset padding.
   - Update ResultCard: tap navigates to `/bar/[bar.id]` instead of Google Maps directly; shows RatingBadge if rated.
   - Update BarPicker: same — tap navigates to detail (Where-next flow still picks bars to seed the search via a separate "Use this one" CTA on the detail page, OR keep BarPicker's direct pick action distinct from "view detail").

4. **E2E pass:** 2 new specs.

5. **Review pass:** typescript-reviewer + a11y check (focus order, screen reader nav landmarks).

## 7. Risks

- **R1:** BarPicker is used in 2 modes: "pick this bar to seed Where-next" and "tap to see detail." Mixing in /bar/[id] is a real UX question. Mitigation: BarPicker stays single-purpose (tap = pick for search). Detail view is reached from ResultCard taps + a Saved tab tap.
- **R2:** Bottom nav covers the bottom 64px on iPhone Safari, conflicting with the home indicator and Safari's URL bar. Mitigation: use `padding-bottom: env(safe-area-inset-bottom)` and reserve a matching gutter at the bottom of scrollable content.
- **R3:** localStorage clears if the user wipes Safari data. Mitigation: copy reads "Ratings stored on this device" so users understand. v0.3.2 adds optional cloud sync.
- **R4:** State sync across tabs/windows. Mitigation: `useRatings` subscribes to the `storage` event so a rating made in one tab updates other open tabs.
- **R5:** Result card's "View on Maps →" affordance is lost when it becomes a detail-view link. Mitigation: detail view has the external Maps link prominently.

## 8. Open questions for council

- Q1: For BarPicker (Where-next flow), should tapping a bar still pick it for search, OR should it open detail first with a "Use this for Where-next" CTA on the detail screen? (Affects funnel friction.)
- Q2: Should the rating control be a 4-button grid (~80% solution) or a slider/segmented control? Segmented is space-efficient but discrete buttons signal "this is a choice."
- Q3: What does Saved-tab empty-state copy say to a brand-new user?
- Q4: Should the bottom nav also show a badge on Saved when there are unviewed updates? (Probably not for v0.3.1 — no notion of "viewed.")

---

*End of v0.3.1 PRD draft. Council debate next.*
