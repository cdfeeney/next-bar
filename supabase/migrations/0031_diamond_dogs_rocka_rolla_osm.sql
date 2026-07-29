-- Next Bar — 0031: adopt OSM coordinates for diamond-dogs and rocka-rolla.
--
-- AUTHORED, NOT APPLIED.
--
-- ─── WHY THESE TWO WERE HELD BACK, AND WHY THAT WAS WRONG ─────────────────
--
-- 0030 re-sourced 258 coordinates from OpenStreetMap and held five venues whose
-- OSM node sat more than 50m from our stored position. Each was arbitrated by
-- geocoding the venue's own curated address via Nominatim and asking which point
-- it landed nearer.
--
-- That arbiter was the wrong tool. For diamond-dogs it reported the address as
-- 1,249m from the OSM node, which looked like a different venue sharing a name.
-- It was not. Nominatim returned a result of type `residential` — it could not
-- resolve the hyphenated Queens house number "34-04" and fell back to the
-- CENTROID OF 31ST AVENUE, over a kilometre away. The geocoder failed; the data
-- was fine.
--
-- The stronger check was available offline the whole time: compare OSM's own
-- addr:* tags against our curated address.
--
--   diamond-dogs   ours '34-04 31st Ave, Astoria, NY 11106'
--                  osm  addr:housenumber=34-04  addr:street=31st Avenue
--   rocka-rolla    ours '486 Metropolitan Ave, Brooklyn, NY 11211'
--                  osm  addr:housenumber=486    addr:street=Metropolitan Avenue
--
-- Exact house number AND street agreement, from a source that never had to guess.
-- There is also exactly one "Diamond Dogs" in the entire NYC extract, so the
-- same-name-different-venue theory had nothing behind it either.
--
-- Moves: diamond-dogs 86m, rocka-rolla 81m. Same provenance rationale as 0030 —
-- Google permits caching lat/lng for 30 consecutive days; OSM carries no clock.
--
-- Source: OpenStreetMap via Overpass, extract cached 2026-07-28.
-- Data (c) OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright
--
-- ─── STILL HELD, and why ──────────────────────────────────────────────────
--
--   230-fifth-rooftop-bar  ours '230 5th Ave', OSM node tagged '1150 Broadway'.
--                          Those are plausibly two addresses of the same corner
--                          building, which the 61m gap supports — but "plausibly"
--                          is not evidence. Operator call.
--   rivercrest             OSM node carries no addr:* tags at all. 148m.
--   watermark-bar          OSM node carries no addr:* tags at all. 111m, and it
--                          sits on Pier 15, where a street address is a poor
--                          proxy for where the bar is.
--
-- Idempotent: guarded on actually moving the row.

begin;

do $$
begin
  if not exists (select 1 from public.bars where id = 'diamond-dogs') then
    raise exception '0031: diamond-dogs not present in public.bars';
  end if;
  if not exists (select 1 from public.bars where id = 'rocka-rolla') then
    raise exception '0031: rocka-rolla not present in public.bars';
  end if;
end $$;

update public.bars
   set lat = 40.7630102, lng = -73.9209969, updated_at = now()
 where id = 'diamond-dogs'
   and (abs(lat - 40.7630102) > 1e-6 or abs(lng - (-73.9209969)) > 1e-6);

update public.bars
   set lat = 40.7139355, lng = -73.952822, updated_at = now()
 where id = 'rocka-rolla'
   and (abs(lat - 40.7139355) > 1e-6 or abs(lng - (-73.952822)) > 1e-6);

do $$
declare
  bad integer;
begin
  select count(*) into bad from public.bars
   where (id = 'diamond-dogs' and (abs(lat - 40.7630102) > 1e-6 or abs(lng - (-73.9209969)) > 1e-6))
      or (id = 'rocka-rolla'  and (abs(lat - 40.7139355) > 1e-6 or abs(lng - (-73.952822)) > 1e-6));
  if bad > 0 then
    raise exception '0031: % row(s) did not take the new coordinates', bad;
  end if;
  raise notice '0031: diamond-dogs and rocka-rolla re-sourced to OpenStreetMap';
end $$;

commit;

------------------------------------------------------------------------------
-- LESSON WORTH KEEPING:
--
-- Three times in this work a geocoder disagreed with reality and was wrong each
-- time — the-ditty's postcode (11370 vs the corroborated 11105), pocket-bar's
-- ZIP (10019 vs the correct 10036), and diamond-dogs (a street centroid 1.2km
-- out). Reverse and forward geocoding are hints. Direct tag comparison, or
-- corroboration from neighbouring rows, is evidence.
------------------------------------------------------------------------------
