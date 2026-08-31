-- Next Bar — 0024: allow 'osm' as an hours_source (goal g-3eedd7a1, H3)
--
-- OpenStreetMap `opening_hours` is the cheapest non-Google hours source: free,
-- ODbL-licensed, structured, and needs no scraping. It is the second opinion
-- that makes a `verified` claim possible at all — src/lib/hoursResolution.ts
-- requires TWO independent agreeing sources for `verified`, so without a
-- corroborator every scraped venue would sit at `reported` forever.
--
-- Modelled as its OWN source rather than folded into 'user' or 'official_site'.
-- OSM is neither our users nor the venue, and provenance that lies is precisely
-- what this schema exists to prevent. Keeping it distinct also keeps the ODbL
-- attribution obligation attached to the rows it applies to.
--
-- Widening an allowed set, so no existing row can violate it: every row today is
-- ('google','unverified') or (NULL, NULL).
--
-- Interaction with 0022 checked: bars_google_hours_never_trusted keys off
-- `hours_source <> 'google'`, so 'osm' is automatically eligible to carry a
-- 'reported' or 'verified' claim. That is intended.
--
-- Idempotent: drop-then-add, so re-running replaces rather than skipping. An
-- `if not exists` guard would leave the OLD narrower predicate in place and the
-- migration would silently do nothing — the same trap 0021 fell into.

alter table public.bars
  drop constraint if exists bars_hours_source_check;

alter table public.bars add constraint bars_hours_source_check
  check (
    hours_source is null
    or hours_source in ('google', 'venue', 'nextbar', 'user', 'official_site', 'osm')
  );

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   alter table public.bars drop constraint if exists bars_hours_source_check;
--   alter table public.bars add constraint bars_hours_source_check
--     check (hours_source is null or hours_source in
--       ('google','venue','nextbar','user','official_site'));
--   -- Any rows already written as 'osm' must be cleared first, or the narrower
--   -- constraint will fail validation.
------------------------------------------------------------------------------
