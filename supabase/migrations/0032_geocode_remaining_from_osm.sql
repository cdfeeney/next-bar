-- Next Bar — 0032: re-source 124 coordinates from OSM address geocodes.
--
-- AUTHORED, NOT APPLIED.
--
-- ─── THE LAST GROUP ───────────────────────────────────────────────────────
--
-- 0030 and 0031 re-sourced every venue the OSM witness could match to a named
-- node. These 140 had NO same-name OSM node at all, so the witness returned
-- INCONCLUSIVE and their coordinates stayed Google-derived — which Google's
-- terms permit for at most 30 consecutive days.
--
-- With no venue node available, the only OSM-derived option is to geocode each
-- venue's own curated address through Nominatim. That is a weaker instrument
-- than a venue node, so it is filtered hard:
--
--   * the geocode must be HOUSE-LEVEL (place_rank >= 30). A lower rank means
--     Nominatim fell back to a street or suburb centroid, which is exactly how
--     diamond-dogs appeared to be 1.2km from itself in 0030.
--   * it must land within 100m of the position we already hold. Beyond that we
--     have two sources disagreeing and no third to break the tie.
--
-- 124 of 140 pass both. They move a median of 5m and at most 39m — 95 of them
-- move 10m or less — so this is a provenance change, not a relocation. 34 of the
-- geocodes resolved to an `amenity` (the venue itself) rather than merely a
-- building, which is stronger still.
--
-- Source: Nominatim / OpenStreetMap, queried 2026-07-29.
-- Data (c) OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright
--
-- Idempotent: guarded on actually moving the row.

begin;

create temporary table _geo_fix (
  id        text primary key,
  lat       double precision not null,
  lng       double precision not null,
  osm_type  text not null,
  moves_m   integer not null
) on commit drop;

insert into _geo_fix (id, lat, lng, osm_type, moves_m) values
  ('25-hours', 40.7484498, -73.9455441, 'place', 15),
  ('56709', 40.7489917, -73.9406592, 'amenity', 11),
  ('amity-hall-uptown', 40.8022004, -73.9646799, 'place', 8),
  ('angel-of-harlem', 40.8080588, -73.9524756, 'amenity', 5),
  ('archer-and-goat', 40.8043400, -73.9484167, 'building', 6),
  ('ardesia', 40.7661486, -73.9917908, 'place', 7),
  ('automatic-slims', 40.7363112, -74.0081723, 'place', 2),
  ('bar-at-the-modern', 40.7611893, -73.9770093, 'building', 31),
  ('bar-centrale', 40.7600274, -73.9890699, 'building', 6),
  ('bar-toto', 40.6668505, -73.9847174, 'amenity', 9),
  ('bar-veloce-chelsea', 40.7425853, -73.9970408, 'building', 5),
  ('barrio-chino', 40.7179789, -73.9900488, 'amenity', 2),
  ('beauty-and-essex', 40.7204577, -73.9870469, 'amenity', 16),
  ('becketts-bar-grill', 40.7041426, -74.0103450, 'amenity', 2),
  ('black-forest-brooklyn', 40.6867676, -73.9751062, 'amenity', 1),
  ('botanica-bar', 40.7246346, -73.9947669, 'building', 3),
  ('buvette', 40.7325720, -74.0042831, 'building', 7),
  ('caledonia-uws', 40.7841695, -73.9779188, 'building', 9),
  ('cantina-on-lenox', 40.8089115, -73.9449819, 'place', 5),
  ('club-room', 40.7220039, -74.0043561, 'tourism', 28),
  ('coppelia-bar', 40.7389335, -73.9999688, 'building', 6),
  ('copper-still-chelsea', 40.7433226, -73.9963314, 'place', 10),
  ('corner-social', 40.8086783, -73.9451552, 'place', 6),
  ('cowgirl-seahorse', 40.7081827, -74.0004889, 'building', 7),
  ('crown-shy-bar', 40.7064733, -74.0077415, 'building', 36),
  ('dante-west-village', 40.7352204, -74.0062506, 'shop', 2),
  ('death-and-co', 40.7259358, -73.9846566, 'amenity', 2),
  ('death-avenue-brewing', 40.7510637, -74.0019532, 'amenity', 4),
  ('dk-public', 40.7537038, -73.9345493, 'building', 6),
  ('donna', 40.7108795, -73.9677352, 'place', 9),
  ('dont-tell-mama', 40.7606215, -73.9894759, 'building', 3),
  ('dorrians-red-hand', 40.7763756, -73.9525898, 'amenity', 3),
  ('drunken-munkey', 40.7808767, -73.9475894, 'building', 5),
  ('earls-beer-and-cheese', 40.7873079, -73.9515642, 'building', 7),
  ('es-bar', 40.7866605, -73.9753833, 'building', 10),
  ('fanelli-cafe', 40.7245736, -73.9987984, 'building', 7),
  ('felice-83', 40.7748986, -73.9510710, 'amenity', 2),
  ('fourth-avenue-pub', 40.6822839, -73.9800150, 'amenity', 1),
  ('fraunces-tavern', 40.7033938, -74.0113353, 'amenity', 4),
  ('fresh-salt', 40.7070684, -74.0024555, 'building', 3),
  ('g-lounge', 40.7421953, -73.9984967, 'place', 13),
  ('guild-bar', 40.7199536, -74.0023558, 'shop', 27),
  ('gym-sportsbar', 40.7426384, -74.0007919, 'building', 4),
  ('harlem-hops', 40.8144407, -73.9447772, 'building', 5),
  ('harlem-nights', 40.8172204, -73.9419721, 'place', 4),
  ('hide-and-seek', 40.7229297, -73.9506173, 'building', 14),
  ('hide-rooftop', 40.7095828, -74.0087901, 'building', 4),
  ('house-of-yes', 40.7067833, -73.9235822, 'amenity', 2),
  ('icon-bar', 40.7616223, -73.9237342, 'building', 0),
  ('industry-bar', 40.7644871, -73.9868683, 'amenity', 12),
  ('jimmy-modernhaus', 40.7226154, -74.0048499, 'building', 17),
  ('karasu', 40.6894585, -73.9732657, 'building', 11),
  ('kashkaval-garden', 40.7667740, -73.9861802, 'building', 3),
  ('kind-regards', 40.7208163, -73.9877831, 'building', 2),
  ('la-contenta', 40.7187462, -73.9869705, 'building', 9),
  ('la-esquina', 40.7213614, -73.9976340, 'amenity', 5),
  ('lanterns-keep', 40.7558514, -73.9819341, 'tourism', 9),
  ('le-fanfare', 40.7362299, -73.9554968, 'building', 2),
  ('lic-bar', 40.7470331, -73.9528887, 'building', 7),
  ('little-ways', 40.7225966, -74.0034583, 'place', 9),
  ('loki-lounge', 40.6735505, -73.9828440, 'amenity', 12),
  ('loreley-beer-garden', 40.7212189, -73.9928717, 'building', 1),
  ('maison-premiere', 40.7142594, -73.9616513, 'building', 2),
  ('malachys-donegal-inn', 40.7777590, -73.9789864, 'building', 2),
  ('maries-crisis-cafe', 40.7332202, -74.0033821, 'building', 2),
  ('mess-hall', 40.8058400, -73.9539968, 'amenity', 10),
  ('miladys', 40.7259071, -74.0014471, 'shop', 16),
  ('mulberry-street-bar', 40.7200327, -73.9967677, 'building', 12),
  ('no-fun', 40.7251946, -73.9469800, 'building', 2),
  ('nothing-really-matters', 40.7614927, -73.9844598, 'place', 7),
  ('olivers-astoria', 40.7596133, -73.9197620, 'building', 3),
  ('onieals', 40.7196999, -73.9978532, 'building', 3),
  ('parcelle', 40.7143770, -73.9911555, 'building', 0),
  ('pdt', 40.7271337, -73.9837348, 'building', 1),
  ('pearl-box', 40.7228997, -74.0029880, 'building', 4),
  ('peter-mcmanus-cafe', 40.7418314, -73.9975703, 'amenity', 4),
  ('pianos', 40.7210032, -73.9876202, 'building', 10),
  ('pj-clarkes', 40.7589826, -73.9682301, 'amenity', 3),
  ('place-des-fetes', 40.6868620, -73.9628840, 'building', 4),
  ('playa-bettys', 40.7807434, -73.9803323, 'amenity', 12),
  ('porchlight', 40.7520063, -74.0049953, 'amenity', 4),
  ('radegast-hall-biergarten', 40.7167493, -73.9615241, 'building', 12),
  ('rockaway-brewing', 40.7471977, -73.9549525, 'craft', 3),
  ('rosevale-cocktail-room', 40.7612015, -73.9871805, 'place', 34),
  ('ruffian', 40.7265409, -73.9840094, 'building', 15),
  ('rustik-tavern', 40.6907461, -73.9582900, 'building', 1),
  ('seamstress', 40.7701470, -73.9549571, 'building', 16),
  ('session-73', 40.7684626, -73.9557479, 'amenity', 2),
  ('shrine', 40.8142704, -73.9440239, 'amenity', 5),
  ('silvana', 40.8043641, -73.9557598, 'building', 16),
  ('sisters', 40.6828902, -73.9652113, 'building', 2),
  ('smithereens', 40.7277911, -73.9841702, 'place', 10),
  ('stone-street-tavern', 40.7042777, -74.0102730, 'amenity', 3),
  ('t-b-d', 40.7332695, -73.9575782, 'amenity', 39),
  ('temkins-bar', 40.7304501, -73.9535674, 'building', 5),
  ('the-bar-room-at-the-beekman', 40.7111949, -74.0069009, 'building', 2),
  ('the-baroness', 40.7449404, -73.9535142, 'place', 1),
  ('the-commodore', 40.7139075, -73.9557995, 'building', 8),
  ('the-diamond', 40.7267521, -73.9574759, 'building', 2),
  ('the-edge-harlem', 40.8198671, -73.9460727, 'amenity', 4),
  ('the-flower-shop', 40.7180663, -73.9921340, 'amenity', 14),
  ('the-gaf-west', 40.7624495, -73.9901091, 'place', 13),
  ('the-ginger-man', 40.7494367, -73.9826415, 'place', 9),
  ('the-gutter-lic', 40.7465899, -73.9518102, 'leisure', 4),
  ('the-happiest-hour', 40.7348180, -73.9996406, 'place', 4),
  ('the-local-bar', 40.7495886, -73.9476285, 'place', 17),
  ('the-malt-house-fidi', 40.7096090, -74.0093344, 'amenity', 6),
  ('the-nephew', 40.8061264, -73.9531736, 'place', 9),
  ('the-press-room', 40.7078495, -74.0089818, 'building', 12),
  ('the-ready-rooftop-bar', 40.7314070, -73.9894371, 'tourism', 13),
  ('the-spaniard', 40.7327579, -74.0021665, 'amenity', 3),
  ('the-supply-house', 40.7775952, -73.9523010, 'building', 2),
  ('the-wayland', 40.7250870, -73.9777631, 'amenity', 9),
  ('the-waylon', 40.7647444, -73.9914324, 'building', 4),
  ('three-diamond-door', 40.7034900, -73.9261998, 'amenity', 5),
  ('tia-pol', 40.7472667, -74.0048327, 'building', 3),
  ('ues-speakeasy', 40.7795690, -73.9508352, 'building', 0),
  ('ulysses-folk-house', 40.7043800, -74.0100088, 'amenity', 8),
  ('uva', 40.7721739, -73.9555966, 'building', 2),
  ('valerie', 40.7563451, -73.9811329, 'building', 1),
  ('vinateria', 40.8066189, -73.9543158, 'amenity', 22),
  ('westside-tavern', 40.7460895, -74.0009506, 'building', 4),
  ('wildair', 40.7201415, -73.9890980, 'place', 14),
  ('woodbines', 40.7452249, -73.9534998, 'building', 2);

do $$
declare
  missing text;
  outside integer;
begin
  select string_agg(f.id, ', ') into missing
    from _geo_fix f left join public.bars b on b.id = f.id
   where b.id is null;
  if missing is not null then
    raise exception '0032: ids not present in public.bars: %', missing;
  end if;

  select count(*) into outside from _geo_fix
   where lat not between 40.45 and 41.0 or lng not between -74.30 and -73.60;
  if outside > 0 then
    raise exception '0032: % replacement coordinate(s) outside the NYC bbox', outside;
  end if;

  -- Nothing here may be a relocation. The filter capped moves at 100m; anything
  -- larger means the input was rebuilt without the precision filter.
  if exists (select 1 from _geo_fix where moves_m > 100) then
    raise exception '0032: a correction exceeds 100m — regenerate with the precision filter';
  end if;
end $$;

update public.bars b
   set lat        = f.lat,
       lng        = f.lng,
       updated_at = now()
  from _geo_fix f
 where b.id = f.id
   and (abs(b.lat - f.lat) > 1e-6 or abs(b.lng - f.lng) > 1e-6);

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
    from public.bars b join _geo_fix f on f.id = b.id
   where abs(b.lat - f.lat) > 1e-6 or abs(b.lng - f.lng) > 1e-6;
  if remaining > 0 then
    raise exception '0032: % row(s) did not take the new coordinates', remaining;
  end if;
  raise notice '0032: 124 venues re-sourced to OSM address geocodes';
end $$;

commit;

------------------------------------------------------------------------------
-- HELD BACK — 16 venues, grouped by cause
--
-- A. NOMINATIM CANNOT READ HYPHENATED QUEENS HOUSE NUMBERS (10 venues)
--
--    This is the dominant failure and it is systematic, not incidental. NYC's
--    Queens grid uses "34-07", "11-01", "38-34" style numbers, and Nominatim
--    either degrades to the street (place_rank 26, type=road) or returns nothing:
--
--      street-centroid fallback: pencil-factory, record-room, flemings-pub,
--                                lost-in-paradise, doha-bar-lounge
--      no result at all:         tootles-and-french, sweet-afton, wylies,
--                                vista-sky-lounge
--      un-geocodable by nature:  bar-sixtyfive ("30 Rockefeller Plaza, 65th fl"
--                                — a floor in a tower, not a ground address)
--
--    flemings-pub is moot regardless; 0028 marked it CLOSED_PERMANENTLY.
--
-- B. GEOCODE DISAGREES AND IS ITSELF LOW-CONFIDENCE (3 venues)
--
--      the-paris-cafe        88,882m away, type=place — a wrong match entirely
--      the-ides-bar           1,179m away, type=place
--      der-schwarze-kolner      346m away, type=place
--
--    All three resolved to `place` rather than a building, so the geocode is the
--    less trustworthy side of the disagreement. Left alone.
--
-- C. PRECISE GEOCODE THAT GENUINELY DISAGREES — WORTH A HUMAN (2 venues)
--
--      jacobs-pickles  '509 Amsterdam Ave, New York, NY 10024'  739m, type=building
--      sea-wolf        '179 Starr St, Brooklyn, NY'             312m, type=building
--
--    These are the interesting ones. Both geocodes are house-level, so unlike
--    group B the geocode is credible — and it puts the venue a long way from
--    where we have it. Either our stored position is wrong (as it was for the 34
--    in 0029), or the address is. Both also appeared in the original
--    audit-places-matches suspect list with photo attribution matching the venue
--    name, which argues the Google match was right and the ADDRESS may be the
--    error. Not resolvable from the data to hand.
--
-- D. NOT IN public.bars (1 venue)
--
--    One of the 140 has no database row, the same class as vazacs in 0030.
--
-- STILL OWED AFTER THIS:
--   * src/lib/bars.places.ts continues to SHIP Google lat/lng to the client.
--     Dropping those fields is what actually ends the 30-day exposure; every
--     migration so far has fixed the stored value, not the shipped one.
--   * 29 stale sidecar rows in neither the catalog nor the bars table.
------------------------------------------------------------------------------
