-- Next Bar — 0026: strip another venue's data from two mis-resolved rows
--
-- The catalog sweeps assigned ONE Google place_id to TWO different real bars.
-- These are not duplicates and must not be merged — both venues exist. What
-- happened is that one row in each pair inherited the OTHER venue's place_id,
-- and with it its coordinates, hours, and photo files.
--
-- Which row is wrong was established from the cached OpenStreetMap data as an
-- independent witness (no Google call, no quota spend):
--
--   ChIJQb5C75NZwokR2L_YzXx6g04
--     the-four-faced-liar        OSM same-name node  6m from its coords  -> CORRECT
--     the-slaughtered-lamb-pub   no OSM match at those coords            -> WRONG
--
--   ChIJBRQ8aftZwokRCRC2mv0dPkY
--     plug-uglies                OSM same-name node 12m from its coords  -> CORRECT
--     bar-coastal                no OSM match at those coords            -> WRONG
--
-- Corroborated independently: in both pairs the CORRECT row is the one the OSM
-- hours sweep matched on its own (hours_source='osm'), while the wrong row sits
-- on google/unverified.
--
-- WHAT THIS CLEARS on the two wrong rows, and why each:
--   place_id          — it is not this venue's identifier.
--   hours + source + confidence — they are the other venue's opening hours.
--   photo_count, photo_attributions — the /bar-photos/<id>.webp files for these
--     ids were downloaded from the other venue's Google photos, so zeroing the
--     count stops them rendering. The FILES are left on disk; deletion belongs
--     with M2, not here.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * lat/lng are LEFT ALONE and remain suspect — they are the other venue's
--     coordinates. Correcting them needs a source for where these two bars
--     actually are, which OSM does not have and Google is out of bounds for.
--     Recorded as an operator action rather than guessed at. Setting them null
--     is not an option: distance ranking and the map both require coordinates.
--   * The THIRD mis-resolved pair (dominies-astoria / flemings-pub, place_id
--     ChIJUzyXVUdfwokRYzS5v4AZpYw) is UNTOUCHED. Neither row has an OSM
--     same-name match, so there is no evidence for which is wrong, and clearing
--     the wrong one would strip a correct venue. Operator decision.
--
-- Both rows carry zero ratings, so no user data is affected.
--
-- Idempotent: the WHERE clause makes a re-run a no-op.

update public.bars
   set place_id = null,
       hours = null,
       hours_source = null,
       hours_confidence = null,
       hours_verified_at = null,
       photo_count = 0,
       photo_attributions = null
 where id in ('the-slaughtered-lamb-pub', 'bar-coastal')
   and place_id is not null;

------------------------------------------------------------------------------
-- Rollback: none, and none is wanted. The cleared values described a different
-- venue. Re-populating these rows means resolving each bar's real place_id
-- attended, which is the operator action noted above.
------------------------------------------------------------------------------
