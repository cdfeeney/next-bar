# Next Bar — v0.5 PRD: Friends + Real Rankings

**Status:** Draft for council review
**Date:** 2026-05-16
**Author:** Connor (with Claude Code)
**Prior:** v0.4 shipped Beli-shape scaffold (5-tab nav: Next Bar? · Map · Rankings · Friends · Settings), top-10 quiz, PWA install. Friends and Rankings tabs are placeholders.

---

## 1. Why v0.5

v0.4 has the matcher, the visual scaffold, and the install path. It does not yet have what makes Beli actually work as a product:

1. **Memory across devices.** Ratings live in `localStorage` — they vanish when Safari clears site data, can't follow you to a phone, can't seed the social layer.
2. **A real ranking model.** Loved/Liked/Pass is a coarse three-bucket flag. Beli's actual product magic is *pairwise comparison* — "do you like Death & Co or Attaboy more?" — producing a stable 0–10 personal score per bar. That score is what makes the rankings tab interesting to a friend.
3. **A social graph.** The Friends tab is currently a placeholder. The whole "Beli for bars" pitch collapses without it. The killer use case — "where should *we* go?" — needs at least one friend.
4. **Identity.** All three above require an account.

v0.5 builds these four things. v0.6 layers feed / photos / push.

## 2. Goals (must achieve in v0.5)

- **G1 — Identity:** users can create an account in <30 seconds without writing a username or password.
- **G2 — Ratings persistence:** rating a bar writes to Supabase; the same rating shows on a different device after sign-in. localStorage becomes the fallback / unauthenticated mode only.
- **G3 — Pairwise ranking:** after rating a bar Loved or Liked, the user is prompted to compare it against one bar they previously rated in the same tier. The comparison produces a stable 0–10 personal score per bar.
- **G4 — Friends:** users can follow other users by handle or phone-contact. The Friends tab renders a real feed of friends' top 5 bars and recent ratings.
- **G5 — Consensus mode:** "Where should we go?" — pick 2+ friends, get a list of bars where the group's average score is highest. The first marketing-worthy demo moment.
- **G6 — Privacy default:** profiles are private by default — only people you follow back can see your full list. Loved/Liked counts may be public; specific bars and scores are not, until follow-back.

## 3. Non-goals (deferred to v0.6+)

- Feeds, posts, comments, replies. (Beli has Activity Feed; we skip until G4/G5 are proven.)
- Photos of bars. (Google Places integration is its own sprint.)
- Push notifications.
- Group chat / DMs.
- Reservation booking (Resy/OpenTable integration).
- Outer-borough expansion (Williamsburg, LIC, etc.).
- Sharing a single bar to an external app (intent share). Easy to add later but not core.
- Bar owner / business claim flow.
- Ranking explanations ("you ranked X above Y because…"). Black-box score is fine for v1.

## 4. Decisions (for council to debate)

### D1 — Auth mechanism

Three real options. Each has App Store implications:

- **(a) Email magic link** — Supabase native, free, works on web + native, no Twilio. UX is clunky (tab to mail, click, tab back). App Store loves it.
- **(b) Phone + SMS code** — feels native, matches Beli/Instagram/everything. Costs ~$0.01/code via Twilio or Supabase phone auth. App Store needs phone auth + at least one alternative (Apple requires an "account deletion" path either way).
- **(c) Sign in with Apple + Google** — zero friction on iOS, table stakes on App Store. Adds setup per provider but the user tap is `Continue with Apple` → done.

**Recommended: (a) email magic link for v0.5, layer (c) in v0.6 when we have the App Store wrapper.** Phone auth is great but every $ matters pre-revenue, and a single auth path is the cleanest first slice.

### D2 — Pairwise ranking algorithm

After a rating, prompt 1–2 comparisons against bars in the same tier. The output score is what the Rankings tab actually sorts by.

- **(a) Elo (chess rating)** — start at 1500, ±32 per matchup. Stable, well-known, easy to implement. Doesn't naturally produce 0–10 — needs a mapping (sigmoid / min-max).
- **(b) Bradley-Terry / Plackett-Luce** — probabilistic ranking model. More statistically sound for noisy human comparisons. Heavier math; library exists in Python, not JS off-shelf.
- **(c) "Beli aggregate"** — average position from N pairwise comparisons within tier; rescale to tier band (Loved: 8.0–10.0, Liked: 5.0–7.9, Pass: 0–4.9). Simplest, no rating-system theory, easy to explain to users.

**Recommended: (c) Beli aggregate.** Match the reference product. Trivially explainable. The score the user sees moves predictably when they make a comparison. Re-evaluate to Elo in v0.7 if needed for cross-user comparability.

### D3 — When does the pairwise prompt fire?

- **(a) Immediately after rating** — modal sheet appears, blocks UI until answered or dismissed. Highest data quality, most intrusive.
- **(b) Deferred queue** — rating saves silently; a "rank N bars" pill appears in the Rankings tab when 3+ comparisons are pending. Lowest friction, but most users will never tap it.
- **(c) Just one comparison inline, on rate** — modal asks one question, single tap to skip or answer. Compromise.

**Recommended: (c).** One inline prompt per rating, skippable, never modal-stacked. If a user rates 3 bars in a row, they're prompted 3 times — each takes ~2 seconds.

### D4 — Friend discovery

How does a user actually find their friends in this app?

- **(a) Phone-contacts upload** — Beli's core mechanic. Friction-heavy, privacy-heavy (PII), App Store sensitive.
- **(b) Handle-based + share link** — user picks a `@handle`, shares `nextbar.app/u/connor` to friends, friend taps link → follow. Twitter pattern.
- **(c) Both** — handles for the web/share flow, optional contacts upload for "find friends fast" in the native app.

**Recommended: (b) handle + share link for v0.5; (c) when the native app ships with contact-permission UI.** Web doesn't have a clean contacts API anyway.

### D5 — Privacy default

- **(a) Public profiles** — anyone can see your full rankings. Like Letterboxd.
- **(b) Private by default, full mutual-follow visibility** — protected accounts; followers see everything. Like Instagram private accounts.
- **(c) Tiered:** counts public, top-10 public, full list mutual-only.

**Recommended: (b) private by default.** Bar visits are sensitive (work events, dates, drinking patterns). Default-private earns trust. We can offer a "Make public" toggle for power users.

### D6 — Consensus algorithm

Two friends pick "where should we go?" The app surfaces bars where both have rated highly.

- **(a) Strict intersection** — only bars both have rated, ranked by average score.
- **(b) Predicted score** — collaborative filtering: predict what each user would score the other's bars, sum predicted scores. Lots more data needed; cold-start brutal.
- **(c) Loose union** — bars either friend Loved, surfaced with a "Connor loved · You haven't been" label.

**Recommended: (a) strict intersection for v0.5,** with empty-state copy "You don't overlap on any bars yet — try (c)?" → fallback to loose union as secondary list. (b) is v0.7+ once we have actual users.

## 5. Schema (Supabase — to be reviewed in architecture pass)

```sql
-- Identity
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,           -- @connor
  display_name text,
  created_at timestamptz default now(),
  is_private boolean default true,
  vibe_tags text[]                       -- migrated from localStorage profile
);

-- Ratings (replaces localStorage `next-bar:ratings:v1`)
create table ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  bar_id text not null,                  -- foreign key to static bars dataset (no `bars` table — dataset stays in code)
  tier text not null check (tier in ('loved','liked','pass')),
  score numeric(3,1),                    -- 0.0 to 10.0, NULL until pairwise produces one
  rated_at timestamptz default now(),
  unique (user_id, bar_id)
);

-- Pairwise comparisons (sparse — only what user actually answered)
create table pairwise_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  winner_bar_id text not null,
  loser_bar_id text not null,
  compared_at timestamptz default now()
);

-- Follows (asymmetric — Twitter-style)
create table follows (
  follower_id uuid references profiles(id) on delete cascade,
  followee_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- RLS sketch (full policy in architecture doc):
--   profiles: anyone can read public profiles + their own + ones they follow that follow back
--   ratings:  same rules as profiles
--   pairwise: only owner can read/write
--   follows:  owner can read all their follows; can read who follows them
```

## 6. Implementation outline

1. **Architecture pass** (`docs/ARCHITECTURE-v0.5.md`): full Supabase schema + RLS policies + score-computation function (SQL or edge function), API surface (client lib vs edge functions), data migration from localStorage on first sign-in.
2. **Auth — Supabase email magic link:**
   - `npm i @supabase/auth-ui-react @supabase/auth-helpers-nextjs`
   - `src/app/auth/page.tsx` — sign-in screen with single email input.
   - Middleware to attach session to requests.
   - `useAuth()` hook returning `{ user, profile, loading }`.
3. **Migrate `useRatings` hook** to read/write Supabase when signed-in, fall back to localStorage when not. Conflict resolution on first sign-in: server wins for existing entries, localStorage entries merge in.
4. **`/onboarding` route** — pick `@handle`, optional display name. Required after first sign-in.
5. **Pairwise comparison UI:**
   - `PairwiseSheet.tsx` — modal sheet, two bar cards side-by-side, "Which more?" buttons.
   - `src/lib/pairwise.ts` — pure functions for: pick-comparison-target (random other bar in same tier with fewest comparisons), compute-score (avg position rescaled to tier band), recompute-on-update.
6. **`/rankings` rewrite:**
   - Pull from Supabase when signed-in.
   - Sort by `score desc` not tier-then-recency.
   - Each row shows score (0.0–10.0, 1 decimal). Tier becomes a sub-badge.
7. **`/friends` rewrite:**
   - List of followed users with their top 5 ratings.
   - Search box → `/u/[handle]` profile pages.
   - "Where should we go?" entry → multi-select friends → consensus list.
8. **`/u/[handle]` public profile page** — top 10 if public, "Request to follow" CTA if private.
9. **Settings additions:** sign in/out, edit handle, privacy toggle, sign-in-on-other-device QR.
10. **E2E:** new specs for sign-in, rating-syncs-on-sign-in, pairwise-sheet-changes-score, follow-friend, consensus-shows-overlap.
11. **Review:** security-reviewer pass on RLS policies (this is the first sprint where wrong RLS = data leak), typescript-reviewer on the auth flow.

## 7. Success criteria

- `npm run typecheck` clean.
- New vitest suites: `pairwise.test.ts` (score computation), `ratingSync.test.ts` (localStorage ↔ Supabase merge).
- E2E (Playwright iPhone 13 + Pixel 7):
  - Sign-in flow: enter email → magic link mock → land on `/onboarding` → pick handle → land on `/`.
  - Sign-in syncs ratings: pre-seed localStorage with 2 ratings → sign in → those ratings exist in Supabase → log out → other device → sign in → see same 2.
  - Pairwise: rate Bar A as Loved → modal asks A vs B → pick A → A's score > B's score in `/rankings`.
  - Friends: add a seeded test friend → see their top 5 → consensus mode shows shared favorites.
- RLS audit: a user signed in as A cannot read user B's pairwise_comparisons. (Direct SQL test against Supabase as user A.)
- Manual iPhone Safari: sign-in works end-to-end on real device (magic link tap from Mail.app).
- Bias smoke: no behavior regression — existing v0.4 quiz/where-next paths still pass against the Supabase-backed `useRatings`.

## 8. Risks

- **R1 — Cold-start social.** First real user has zero friends. The Friends tab is dead empty. Mitigation: seed `/friends` with 2–3 "curator" profiles (you + 1–2 known beta users) that everyone is auto-suggested to follow. Optional follow, not forced.
- **R2 — App Store deletion requirement.** Apple Guideline 5.1.1(v): apps that let you create an account must let you delete it. Build account-delete from day one in `/settings` — not optional.
- **R3 — Email magic links land in spam.** Mitigation: use a domain you control for sending, set SPF/DKIM, plain-text email body. Supabase default sender works but is sometimes filtered.
- **R4 — Pairwise fatigue.** If we prompt every rating, users will stop rating. Hard cap: 1 prompt per rating, never two-deep modals, "skip" is a first-class button. Track tap-through rate; back off if < 30%.
- **R5 — RLS policy errors leak user data.** Highest-stakes mistake possible. Mandatory pre-launch step: write a security-reviewer agent task that crafts 5+ "as user A, try to read user B's data" attack tests. Block on those.
- **R6 — Handle squatting.** Someone signs up as `@elonmusk`. Mitigation: handle-reserved list for v0.5 launch (10–20 names). Real moderation is v0.6.
- **R7 — localStorage → Supabase migration drops ratings.** First sign-in conflict resolution is non-trivial. Mitigation: dry-run merge in a confirmation modal: "We found 7 ratings on this device. Add to your account?" with Yes / Discard.
- **R8 — Score volatility erodes trust.** A user rates a bar 9.0, makes 3 more comparisons, score drops to 7.5. They feel the algorithm is broken. Mitigation: smooth updates (don't apply >1.0 score change per pairwise event); show "Score will refine as you rank more bars" microcopy.

## 9. Open questions for council

- **Q1:** Phone-vs-email auth — do we really commit to email for the first 1k users, knowing every consumer app does phone? (D1)
- **Q2:** Should pairwise prompts only fire for Loved/Liked (not Pass)? Pass-vs-Pass ranking feels pointless. (D2/D3)
- **Q3:** What's the empty-state for someone who's rated 1 bar? The pairwise prompt has no second bar to compare against. Show a "rate one more to start ranking" nudge?
- **Q4:** Should the bars dataset (`src/lib/bars.ts`) stay in code, or move to a Supabase `bars` table so curators can edit without a deploy? In-code is faster for v0.5; tabling matters when we have a curator who isn't Connor.
- **Q5:** When two friends consensus-pick "Where should we go?", do we exclude bars one of them Pass-rated? Probably yes — but explicitly?
- **Q6:** Account deletion (R2): hard-delete all rows, or soft-delete + 30-day recovery window like most consumer apps? Soft is more user-friendly, harder to implement under RLS.

---

## 10. Sequencing — what ships first inside v0.5

This PRD is 4–6 sprints of work. Ship order:

1. **v0.5.0 — Auth + Ratings sync.** Magic link sign-in, Supabase profiles + ratings tables, ratings sync from localStorage on first sign-in. Rankings tab reads from Supabase. Pairwise UI not yet built — score column stays NULL, sort still tier-then-recency.
2. **v0.5.1 — Pairwise scoring.** Modal sheet + score computation. Rankings tab now sorts by score. Pre-existing ratings get migrated to scores via a batch backfill (compare top-ranked Loved vs next, etc.).
3. **v0.5.2 — Handles + public profiles.** `/onboarding`, handle picker, `/u/[handle]` page. Privacy toggle in settings.
4. **v0.5.3 — Follows + Friends tab real.** Follow/unfollow, see followee top-5s.
5. **v0.5.4 — Consensus mode.** "Where should we go?" multi-select friends → intersection list.

Each ships behind a feature flag (`process.env.NEXT_PUBLIC_FEATURE_AUTH` etc.) so a partial v0.5 is still deployable. Connor decides the cut line for the App Store submission build.

---

*End of v0.5 PRD draft. Council debate next (Skeptic + Critic + Architect roles, same pattern as v0.2 round 2).*
