# UX-E — Tonight's Vibe Vote (design, authored night-5 2026-07-27)

**Status: AUTHORED, NOT APPLIED.** Migration `0017_vibe_votes.sql` is
written and adversarially reviewed but **must not be applied overnight**
(standing rule). Morning: attended `apply-one-migration` ×2 + an
rpc-smoke-style behavioral cycle, then the UI lights up on its own (dark
pattern below).

## What it is

A one-tap nightly poll on the Plan Night Out board (/friends/consensus):
each circle member casts **one vibe vote per night** ("Dancey", "Chill",
"Dive-y", …). The board shows the tally poll-style (names + counts, the
iPhone-Messages register the operator asked for on People's Choice), and
the **winning vibe seeds Group Favorites**: favorites matching the
winner get a stable-sorted boost, with an honest "Tonight: 🎶 Dancey"
chip explaining why.

## Decisions

1. **Vote = one `VibeTag`** from a curated 8-option poll (VOTE_OPTIONS in
   `src/lib/vibeVotes.ts`): dance, live, chill, dive, cocktail, karaoke →
   NO (not in vocab) — final set: `dance · live · chill · dive · cocktail
   · beer · rooftop · speakeasy`. Full 33-tag polls are unusable at a
   glance (minimum-reading principle); the axis surface (VibeTweak) stays
   the personal-search tool. The server stores any lowercase tag-shaped
   text (regex-bounded) so the option set can evolve client-side without
   a migration; unknown tags are display-filtered (0008 tolerance
   precedent, same as vibeNightCache).
2. **One vote per user per night, declaratively**: PK `(user_id, night)`
   — a re-vote is an upsert MOVE (0012 lesson: procedural invariants need
   a constraint backstop). Tap your own choice again = rescind (own-row
   RLS DELETE, 0011 precedent).
3. **Night key**: client-computed `nycNightKey` (6am rollover), server
   bounds ±2 days — identical to 0011/0012.
4. **Reads are circle-scoped**: `get_circle_vibe_votes` definer returns
   own + followed users' votes only, `with ... as materialized` fence
   (0016 house style), p_ params, revoke-first grants. No table SELECT.
5. **Winner**: computed client-side (`tallyVibeVotes`): highest count;
   deterministic tie-break = earliest first-vote (a tie shouldn't jitter
   between renders or devices). Pure + unit-tested.
6. **Seeding Group Favorites**: client-side stable partition — favorites
   whose bar carries the winning tag float above those that don't,
   original consensus order preserved within each partition. No score
   surgery; reversible; unit-tested (`boostByWinningVibe`).
7. **Dark pattern** (0008 precedent): the poll UI renders ONLY after a
   successful `get_circle_vibe_votes` fetch. Until 0017 is applied the
   RPC doesn't exist → fetch returns null → the board renders exactly as
   today. No flag needed.

## Not in v1

- Vibe vote's winner does NOT pre-fill anyone's personal search
  (vibeNightCache stays personal — a group poll silently rewriting your
  solo search vibe is spooky action).
- No push/notification on votes (push layer still dark, 0009).
- No vote history / streaks.

## Adversarial review (routed DeepSeek, 2026-07-27 night — pre-apply)

Five findings; four applied, one refuted:

1. **Applied** — upsert is now a no-op when the tag is unchanged
   (`where ... is distinct from excluded.tag`): a repeated same-tag cast
   must not reset `created_at` (it anchors the winner tie-break) nor
   churn WAL. (DeepSeek framed this as a rate-guard gap; there's no cap
   invariant here — the single-statement upsert is atomic — but the
   no-op variant is strictly better semantics.)
2. **Refuted** — "add a deny-all SELECT policy or a future blanket grant
   exposes every vote": with RLS enabled and NO select policy, a table
   grant alone returns zero rows (RLS default-deny). The definer
   function reads as table owner regardless. No change; 0011 precedent.
3. **Applied** — `auth.uid() is not null` short-circuit inside the
   definer read's fence.
4. **Applied** — ASCII backstop on `p_tag`
   (`octet_length = char_length`): `[a-z]` ranges follow cluster
   collation on glibc.
5. **Applied** — PK constraint named explicitly in the DDL so the
   `ON CONSTRAINT vibe_votes_pkey` reference survives refactors.

## Morning checklist (operator / attended session)

1. `npx tsx scripts/apply-one-migration.mts supabase/migrations/0017_vibe_votes.sql` ×2 (re-runnable proof).
2. Behavioral cycle (rpc-smoke pattern, throwaway confirmed user): cast →
   read shows it → re-cast different tag (MOVE — old gone) → rescind →
   read empty. Function existence ≠ function works (42702 lesson).
3. Merge the PR; post-merge /api/health sha smoke.
