-- Next Bar — 0029: correct 32 venue coordinates from OpenStreetMap.
--
-- AUTHORED, NOT APPLIED. Live-catalog writes are attended work; this is
-- committed for review, not run by an unattended loop.
--
-- ─── WHY THESE ARE WRONG ───────────────────────────────────────────────────
--
-- scripts/refresh-places.mjs resolved every venue with a Google Text Search on
-- `"{name}, {address}"` and accepted `places[0]` blindly — no locationBias, no
-- locationRestriction, and no check that the result sits near where our catalog
-- said the bar was. The hand-authored coordinates in src/lib/bars.*.ts were
-- never validated against anything.
--
-- scripts/audit-osm-witness.mts cross-checked all 433 venues against a cached
-- OpenStreetMap extract, asking one question per venue: is there a same-name OSM
-- node near OUR coordinates, or near the ones Google returned?
--
--   Google matched the wrong venue ....   0   (the risk we went looking for)
--   OUR coordinates are wrong .........  34   <- this migration
--   Both agree ........................ 230
--   No OSM node, cannot rule .......... 140
--   In neither catalog nor DB .........  29
--
-- For all 34, OSM independently places the venue at Google's position and finds
-- nothing at ours. Errors run from 74m to 2,318m (The Ditty, ~1.44 miles).
--
-- ─── WHY IT MATTERS EVEN THOUGH NOTHING LOOKS BROKEN ──────────────────────
--
-- src/lib/bars.ts:53 (applyPlaces) overrides the hand-authored lat/lng with the
-- Google sidecar's, so the app currently renders the CORRECT position and no
-- user sees a bug. That masking is exactly the problem: the Phase-1 work removes
-- persisted Google data, and the moment the sidecar's coordinates go, these 34
-- venues snap back to their wrong hand-authored positions. Fixing them is
-- prerequisite work for that migration, not cosmetic tidying.
--
-- ─── WHY OSM AND NOT GOOGLE ───────────────────────────────────────────────
--
-- Google's Places policy exempts only place_id from its caching restrictions, so
-- their coordinates are not ours to persist. OSM's are (ODbL, attributed below),
-- and OSM agrees with Google to within 0–24m on every row here. Same reasoning
-- as 0028's Slaughtered Lamb correction.
--
-- Source: OpenStreetMap via Overpass, extract cached 2026-07-28.
-- Data (c) OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright
--
-- ─── DELIBERATELY EXCLUDED ────────────────────────────────────────────────
--
-- Two of the 34 are multi-location brands, where a same-name OSM node near
-- Google's coordinates does NOT prove our row is misplaced — it may simply be a
-- different branch. Applying these blind could move a correct venue:
--
--   boxers-chelsea: multi-location chain (Chelsea / Hell’s Kitchen / Washington Heights); the OSM node carries no address, so the branch cannot be confirmed.
--   tir-na-nog: multi-location chain; ours says W 39th St, OSM node is W 31st St 695m away. Applying OSM would MOVE our venue to a different branch.
--
-- They stay in the operator queue, on the same principle that left bar-coastal
-- alone in 0028: a venue moved to the wrong place is an error no user reports.
--
-- Idempotent: re-running is a no-op once the coordinates match (see the guard).

begin;

create temporary table _osm_fix (
  id          text primary key,
  lat         double precision not null,
  lng         double precision not null,
  osm_ref     text not null,
  was_off_m   integer not null
) on commit drop;

insert into _osm_fix (id, lat, lng, osm_ref, was_off_m) values
  ('albatross-bar', 40.7701858, -73.9121836, 'node/1708721821', 599),
  ('alibi-lounge', 40.8178209, -73.9422219, 'node/7629823948', 170),
  ('berlin', 40.7230062, -73.9860348, 'node/7167147108', 173),
  ('bohemian-hall', 40.7729547, -73.9158034, 'way/375930680', 404),
  ('broadway-dive', 40.7978913, -73.9690987, 'node/2761444458', 162),
  ('compagnie-des-vins', 40.7204999, -73.9980785, 'node/7075366387', 74),
  ('cronin-phelans', 40.7589945, -73.9193771, 'node/11286207470', 278),
  ('dakota-bar', 40.7774878, -73.9785066, 'node/2745321892', 177),
  ('diamond-lil', 40.7254359, -73.9461046, 'node/12730434030', 177),
  ('dominies-hoek', 40.7435557, -73.9536593, 'node/8335033421', 297),
  ('eagle-nyc', 40.7517058, -74.0042924, 'node/4395618692', 119),
  ('fifth-hammer', 40.7464921, -73.9515404, 'node/4995779511', 139),
  ('hart-bar', 40.6963535, -73.9299985, 'node/5743448065', 263),
  ('keys-and-heels', 40.7722433, -73.955622, 'node/9559075749', 172),
  ('letlove-inn', 40.7755381, -73.9147688, 'node/12216995926', 618),
  ('mosaic', 40.7746159, -73.918453, 'node/2853184678', 945),
  ('pocket-bar', 40.7633931, -73.9923609, 'node/2709931391', 210),
  ('purgatory', 40.6872341, -73.9057389, 'way/250422727', 540),
  ('rebeccas', 40.698215, -73.9342007, 'node/5744320023', 343),
  ('singlecut', 40.7782956, -73.9016716, 'way/241857450', 226),
  ('sunswick-3535', 40.7565734, -73.9254957, 'node/2846596408', 295),
  ('the-beast-next-door', 40.748908, -73.9408313, 'node/4995839498', 169),
  ('the-bonnie', 40.774704, -73.9136014, 'node/5487117025', 316),
  ('the-ditty', 40.774834, -73.9086149, 'node/12037259035', 2318),
  ('the-double-windsor', 40.6605732, -73.9804283, 'node/1039613744', 1052),
  ('the-emerson', 40.6940535, -73.9618019, 'node/9583805198', 170),
  ('the-frying-pan', 40.7523006, -74.0094145, 'node/2981930233', 289),
  ('the-last-word', 40.7753994, -73.9099221, 'node/12164467268', 210),
  ('the-levee', 40.7163751, -73.9615756, 'node/2465889352', 912),
  ('the-narrows', 40.7040364, -73.9307858, 'node/5490145121', 383),
  ('the-sampler', 40.7055984, -73.9224758, 'node/5624790243', 956),
  ('the-wolfhound', 40.7639277, -73.9154228, 'node/5136306087', 403);

------------------------------------------------------------------------------
-- Preconditions — fail LOUDLY rather than silently correcting nothing.
------------------------------------------------------------------------------

do $$
declare
  missing text;
  outside integer;
begin
  select string_agg(f.id, ', ') into missing
    from _osm_fix f left join public.bars b on b.id = f.id
   where b.id is null;
  if missing is not null then
    raise exception '0029: these ids are not in public.bars: % — review before applying', missing;
  end if;

  -- Every replacement must satisfy bars_coord_bbox_check (0019). Catching it
  -- here names the offender instead of failing on an opaque constraint.
  select count(*) into outside from _osm_fix
   where lat not between 40.45 and 41.0 or lng not between -74.30 and -73.60;
  if outside > 0 then
    raise exception '0029: % replacement coordinate(s) fall outside the NYC bbox', outside;
  end if;
end $$;

------------------------------------------------------------------------------
-- The correction.
--
-- Guarded on actually moving the row: a re-run after the fix has landed updates
-- nothing and does not churn updated_at. ~1e-5 degrees is a little over a metre,
-- well below the 74m smallest real error here, so it cannot mask a genuine miss.
------------------------------------------------------------------------------

update public.bars b
   set lat        = f.lat,
       lng        = f.lng,
       updated_at = now()
  from _osm_fix f
 where b.id = f.id
   and (abs(b.lat - f.lat) > 1e-5 or abs(b.lng - f.lng) > 1e-5);

------------------------------------------------------------------------------
-- Report what moved, so the apply log is evidence rather than a row count.
------------------------------------------------------------------------------

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
    from public.bars b join _osm_fix f on f.id = b.id
   where abs(b.lat - f.lat) > 1e-5 or abs(b.lng - f.lng) > 1e-5;
  if remaining > 0 then
    raise exception '0029: % row(s) did not take the correction', remaining;
  end if;
  raise notice '0029: all 32 venues now sit on their OpenStreetMap coordinates';
end $$;

commit;

------------------------------------------------------------------------------
-- NOT DONE HERE, and owed:
--
-- 1. The hand-authored coordinates in src/lib/bars.*.ts are still wrong. This
--    migration corrects the `bars` TABLE only. Until the source files are fixed
--    too, a fresh bundle still carries the bad values.
-- 2. Several rows also have a wrong ADDRESS, not merely imprecise coordinates —
--    the-ditty (21st St vs Ditmars Blvd), the-levee (N 14th St vs Berry St),
--    the-sampler (Central Ave vs Starr St), plus wrong ZIPs on mosaic and
--    pocket-bar. Addresses are curated, user-visible copy and OSM's are
--    inconsistently formatted, so overwriting them in bulk would trade one
--    quality problem for another. Operator queue.
-- 3. The 140 inconclusive and 29 unresolvable venues remain unchecked.
--
-- Rollback (in comments, per convention):
--   The previous coordinates were WRONG and are deliberately not preserved here.
--   Recover from git history of src/lib/bars.*.ts if ever needed.
------------------------------------------------------------------------------
