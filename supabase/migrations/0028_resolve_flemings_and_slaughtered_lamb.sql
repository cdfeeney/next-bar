-- Next Bar — 0028: resolve the two venue-identity questions 0026/0027 parked.
--
-- AUTHORED, NOT APPLIED. This migration performs live-catalog writes and is
-- attended work; it is committed for review, not run by an unattended loop.
--
-- Operator decisions this encodes (Connor, 2026-07-28):
--
--   D5 — Fleming's Pub is CLOSED. Dominie's Astoria owns the shared Google
--        place_id ChIJUzyXVUdfwokRYzS5v4AZpYw. 0027 could not decide between
--        them and carved BOTH ids out of the bars_place_id_unique guard, which
--        left 2 of 1,256 rows unprotected. With ownership settled, the carve-out
--        comes out and the guard covers the whole table.
--
--   D6 — The Slaughtered Lamb Pub is at 182 West 4th Street, Greenwich Village.
--        It currently renders at another venue's coordinates.
--
-- NOT in this migration, deliberately:
--   bar-coastal. Connor's word was "seems closed", which is not confirmation.
--   Google's CLOSED_PERMANENTLY verdict has been right 42+ times, but Google is
--   out of bounds as a source here and OSM has no evidence either way. Marking a
--   live venue closed on a guess is the one error that cannot be noticed by a
--   user — the bar simply stops being recommended. It stays in the operator
--   queue until there is permissible positive evidence.
--
-- Idempotent: safe to re-run (project convention — there is no migrations
-- ledger).

------------------------------------------------------------------------------
-- Preconditions — fail LOUDLY rather than silently no-op.
--
-- A migration that quietly does nothing because a row moved is worse than one
-- that aborts: the operator believes the correction landed. 0026 and 0027 both
-- turned on exact ids, so assert them.
------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.bars where id = 'dominies-astoria') then
    raise exception '0028: dominies-astoria not found — catalog shape changed, review before applying';
  end if;
  if not exists (select 1 from public.bars where id = 'flemings-pub') then
    raise exception '0028: flemings-pub not found — was it already removed? review before applying';
  end if;
  if not exists (select 1 from public.bars where id = 'the-slaughtered-lamb-pub') then
    raise exception '0028: the-slaughtered-lamb-pub not found — review before applying';
  end if;
end $$;

------------------------------------------------------------------------------
-- D5a — Fleming's Pub is closed, and releases the contested place_id.
--
-- The place_id is cleared BEFORE the unique index is recreated below; doing it
-- in the other order would make the index creation fail on the live collision.
--
-- business_status uses Google's vocabulary because that is what the column
-- already stores (0019). Setting it here is OUR determination, not a Google
-- read — no Places call is made by this migration.
------------------------------------------------------------------------------

update public.bars
   set business_status = 'CLOSED_PERMANENTLY',
       place_id        = null,
       updated_at      = now()
 where id = 'flemings-pub';

------------------------------------------------------------------------------
-- D5b — Dominie's Astoria keeps the place_id.
--
-- Asserted rather than written: if it already holds the id this is a no-op, and
-- if it does NOT, something reassigned it since 0027 and a blind write would
-- paper over that.
------------------------------------------------------------------------------

do $$
declare
  actual text;
begin
  select place_id into actual from public.bars where id = 'dominies-astoria';
  if actual is distinct from 'ChIJUzyXVUdfwokRYzS5v4AZpYw' then
    raise exception
      '0028: dominies-astoria place_id is %, expected ChIJUzyXVUdfwokRYzS5v4AZpYw — resolve before applying',
      coalesce(actual, 'NULL');
  end if;
end $$;

------------------------------------------------------------------------------
-- D5c — Remove the carve-out. The guard now covers every row.
--
-- 0027's own comment named these ids precisely so this step could not be
-- forgotten. Recreating without the exclusion is the whole point of settling D5.
------------------------------------------------------------------------------

drop index if exists public.bars_place_id_unique;

create unique index bars_place_id_unique
  on public.bars (place_id)
  where place_id is not null;

comment on index public.bars_place_id_unique is
  'One Google place_id per venue. Carve-out removed in 0028 once dominies-astoria/flemings-pub ownership was settled.';

------------------------------------------------------------------------------
-- D6 — The Slaughtered Lamb Pub: correct coordinates.
--
-- PROVENANCE (this is the part that matters for compliance):
--   Source:   OpenStreetMap Nominatim, queried 2026-07-29
--             https://nominatim.openstreetmap.org/search?q=182+West+4th+Street,+New+York,+NY
--   Result:   osm_type=node osm_id=2562458252 place_id=357222470
--             lat=40.7323542 lon=-74.0018245
--             "182, West 4th Street, West Village, Manhattan, New York County,
--              New York, 10014, United States"
--   Licence:  Data © OpenStreetMap contributors, ODbL 1.0
--
-- Nominatim, NOT Google: OSM-derived geodata is what we are permitted to
-- persist. Google coordinates may be displayed but never stored.
--
-- West Village is within Greenwich Village, so this agrees with the operator's
-- stated address rather than contradicting it.
--
-- The bars_coord_bbox_check constraint (0019) independently backstops this:
-- 40.73/-74.00 is comfortably inside the NYC bounds, so a fat-fingered value
-- here would abort rather than land.
------------------------------------------------------------------------------

update public.bars
   set lat        = 40.7323542,
       lng        = -74.0018245,
       address    = '182 W 4th St, New York, NY 10014',
       updated_at = now()
 where id = 'the-slaughtered-lamb-pub';

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--
--   -- restore the 0027 carve-out
--   drop index if exists public.bars_place_id_unique;
--   create unique index bars_place_id_unique
--     on public.bars (place_id)
--     where place_id is not null
--       and id not in ('dominies-astoria', 'flemings-pub');
--
--   -- Fleming's prior state. NOTE: its original place_id was
--   -- ChIJUzyXVUdfwokRYzS5v4AZpYw (shared with dominies-astoria); restoring it
--   -- requires the carve-out above to exist FIRST or the index will reject it.
--   update public.bars
--      set business_status = null,
--          place_id = 'ChIJUzyXVUdfwokRYzS5v4AZpYw'
--    where id = 'flemings-pub';
--
--   -- The Slaughtered Lamb's prior coordinates were another venue's and are
--   -- deliberately not recorded here; they were wrong. Recover from git history
--   -- of src/lib/bars.*.ts if ever needed.
------------------------------------------------------------------------------
