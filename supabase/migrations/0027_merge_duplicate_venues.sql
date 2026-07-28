-- Next Bar — 0027: remove 9 duplicate venues, then make the bug impossible
--
-- Nine pairs of rows shared a Google place_id AND are the same real bar under two
-- names. Unlike the three mis-resolutions in 0026, these ARE duplicates: users saw
-- the same venue twice in pickers, results and lists, and it is what broke
-- e2e/lists-flow ("Death & Co" resolving to two buttons).
--
-- SAFE TO DELETE, checked before writing rather than assumed. Across every
-- bar-referencing column in the schema — ratings.bar_id, bar_rsvps.bar_id,
-- bar_suggestions.bar_id, shared_nights.loved_bar_id, shared_nights.bar_ids,
-- bar_photos.bar_id, bar_change_queue.bar_id — ZERO rows reference any of the
-- nine ids being removed. The only real foreign keys (bar_photos,
-- bar_change_queue) are ON DELETE CASCADE and have no matching rows. No user data
-- is orphaned or lost.
--
-- Which id survives: the canonical/shorter form in each pair. All nine losers
-- carry zero ratings, so there is no user-data reason to prefer either side.
--
--   kept                          removed
--   death-and-co                  death-and-company
--   sunshine-laundromat           sunshine-laundromat-pinball
--   boxers-chelsea                boxers-nyc          (boxers-hk is a DIFFERENT
--                                                      location and is untouched)
--   blind-tiger                   blind-tiger-ale-house
--   kcbc-taproom                  kings-county-brewers-collective
--   empire-hotel-rooftop          the-empire-rooftop
--   pieces-bar                    pieces
--   7b-horseshoe-bar              vazacs              (genuinely one bar, two names)
--   slate                         slate-ny
--
-- Known minor cost: a shared or bookmarked URL containing a removed id (e.g.
-- /share/boxers-nyc) will no longer resolve. Acceptable — these ids were only
-- created by the recent sweeps and carry no ratings, so nothing was shared from
-- them in practice. A redirect table would be over-engineering for nine rows.
--
-- Idempotent: deleting an absent id is a no-op.

delete from public.bars
 where id in (
   'death-and-company',
   'sunshine-laundromat-pinball',
   'boxers-nyc',
   'blind-tiger-ale-house',
   'kings-county-brewers-collective',
   'the-empire-rooftop',
   'pieces',
   'vazacs',
   'slate-ny'
 );

------------------------------------------------------------------------------
-- THE GUARD: one place_id, one row. This is the root cause fix.
------------------------------------------------------------------------------
-- Detection scripts find this bug after it ships; a unique index makes it
-- unrepresentable. The next sweep that tries to attach an already-claimed
-- place_id to a second row now FAILS LOUDLY instead of quietly creating a
-- duplicate or a mis-resolution.
--
-- Partial on `place_id is not null`, because plenty of venues legitimately have
-- no place_id and NULLs must not collide with each other.
--
-- THE CARVE-OUT, and why it is explicit rather than hidden: dominies-astoria and
-- flemings-pub still share ChIJUzyXVUdfwokRYzS5v4AZpYw. They are two DIFFERENT
-- real bars, and 0026 deliberately left them alone because no evidence exists for
-- which one owns the id — OpenStreetMap has neither, and Google is out of bounds.
-- Excluding exactly that pair lets the guard protect all 1,254 other rows today
-- instead of waiting on an operator decision. When the pair is resolved, drop
-- this index and recreate it without the exclusion; the ids are named here so
-- that step cannot be forgotten.
--
-- Note this index also would have caught the 0026 mis-resolutions, not just
-- duplicates — the two failure modes share one cause.

drop index if exists public.bars_place_id_unique;

create unique index bars_place_id_unique
  on public.bars (place_id)
  where place_id is not null
    and id not in ('dominies-astoria', 'flemings-pub');

comment on index public.bars_place_id_unique is
  'One Google place_id per venue. Excludes the unresolved dominies-astoria/flemings-pub pair; remove that exclusion once their place_id ownership is settled.';

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop index if exists public.bars_place_id_unique;
--   -- The nine deleted rows are not restorable from here; they are recoverable
--   -- from the catalog sweep scripts if ever needed, but they were duplicates.
------------------------------------------------------------------------------
