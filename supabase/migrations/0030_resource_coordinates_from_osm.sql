-- Next Bar — 0030: re-source 259 venue coordinates from OpenStreetMap.
--
-- AUTHORED, NOT APPLIED.
--
-- ─── WHY, AND WHY IT IS NOT AN ACCURACY FIX ───────────────────────────────
--
-- Unlike 0029, these coordinates are not WRONG. The OSM witness classed all of
-- them AGREE: a same-name OSM node sits near both our stored position and the
-- one Google returned. Half of them move 6m or less.
--
-- This is a PROVENANCE change. Google Maps Platform terms permit caching
-- lat/lng for at most 30 consecutive days, after which the cached values must be
-- deleted; only place_id may be kept indefinitely. Our coordinates came from
-- Google via scripts/refresh-places.mjs and have been committed to
-- src/lib/bars.places.ts and the bars table far longer than that, with no expiry
-- mechanism. OpenStreetMap carries no such clock — ODbL asks for attribution,
-- not deletion — so re-sourcing from OSM removes the whole category of problem
-- rather than requiring a monthly refresh-and-delete job.
--
-- Same move already made for hours (0024). Coordinates were the remaining
-- instance of the same pattern.
--
-- ─── HOW THE FAR MOVERS WERE ARBITRATED ───────────────────────────────────
--
-- 207 of these move <=25m and 11 move 26-50m: at that scale adopting OSM cannot
-- meaningfully change accuracy, so provenance is the only effect.
--
-- 46 moved further (up to 148m, the matcher's radius cap), and for those there
-- was NO evidence our stored position was wrong — "agree" only means OSM found
-- the venue within 150m. Adopting OSM blind could have degraded accuracy to buy
-- provenance. So each was arbitrated against a third, independent source: its
-- own curated address, geocoded via Nominatim (also OSM, also storable).
--
--   41 of 46 — the address landed within 60m of the OSM node, corroborating it.
--              Included below.
--    5 of 46 — held back, listed at the foot of this file.
--
-- Source: OpenStreetMap via Overpass, extract cached 2026-07-28; Nominatim for
-- the arbitration pass. Data (c) OpenStreetMap contributors, ODbL 1.0.
-- https://osm.org/copyright
--
-- Idempotent: guarded on actually moving the row.

begin;

create temporary table _osm_resource (
  id        text primary key,
  lat       double precision not null,
  lng       double precision not null,
  osm_ref   text not null,
  moves_m   integer not null
) on commit drop;

insert into _osm_resource (id, lat, lng, osm_ref, moves_m) values
  ('161-lafayette', 40.7198136, -73.9990736, 'node/11447971796', 87),
  ('169-bar', 40.7139326, -73.9897603, 'node/6231529913', 6),
  ('2a', 40.7229624, -73.9859632, 'node/2555128948', 0),
  ('ace-bar', 40.7243649, -73.9829025, 'node/6709864873', 7),
  ('albatross-bar', 40.7701858, -73.9121836, 'node/1708721821', 0),
  ('alibi-lounge', 40.8178209, -73.9422219, 'node/7629823948', 0),
  ('alligator-lounge', 40.7139741, -73.9489283, 'node/10968324908', 8),
  ('alphaville', 40.7005262, -73.9258167, 'node/5420325030', 0),
  ('american-whiskey', 40.7493007, -73.9941316, 'node/3246839596', 10),
  ('amor-y-amargo', 40.7257034, -73.9842602, 'node/5932619925', 3),
  ('amsterdam-ale-house', 40.7813756, -73.9798992, 'node/2047267694', 5),
  ('arlenes-grocery', 40.7213285, -73.9883827, 'node/2567547059', 0),
  ('art-bar', 40.7384967, -74.0035172, 'node/5087638556', 4),
  ('arthurs-tavern', 40.7331992, -74.0034508, 'node/4305072305', 0),
  ('as-is', 40.7646909, -73.9915481, 'node/4843833624', 22),
  ('attaboy', 40.7188823, -73.9913742, 'node/4146280790', 0),
  ('auction-house', 40.7795415, -73.9499453, 'node/10896481012', 0),
  ('babys-all-right', 40.7099599, -73.9634234, 'node/12112521386', 1),
  ('back-room', 40.7187356, -73.9869338, 'node/4146329789', 3),
  ('bar-54', 40.7575137, -73.9840845, 'node/11079657105', 8),
  ('bar-americano', 40.7314241, -73.9576915, 'node/2275469171', 106),
  ('bar-francis', 40.683681, -73.9682409, 'node/10282968180', 110),
  ('barawine', 40.80454, -73.9474459, 'node/2765742254', 48),
  ('barbes', 40.6677889, -73.9838478, 'node/5528710489', 6),
  ('barcade', 40.7120257, -73.951117, 'node/484078905', 0),
  ('bathtub-gin', 40.7435663, -74.0031566, 'node/6139559484', 2),
  ('beer-authority', 40.7559874, -73.9910754, 'node/2649091999', 0),
  ('beer-culture', 40.759564, -73.9897134, 'node/3246839597', 35),
  ('bemelmans-bar', 40.7742561, -73.962989, 'node/4822836522', 1),
  ('berlin', 40.7230062, -73.9860348, 'node/7167147108', 0),
  ('berry-park', 40.7224689, -73.9552527, 'way/280118573', 0),
  ('bibi-wine-bar', 40.7238517, -73.983598, 'node/6484411496', 8),
  ('bin-71', 40.7765296, -73.9792214, 'node/11360985469', 3),
  ('birdland', 40.7590063, -73.9896838, 'node/3573482095', 10),
  ('birdys', 40.6975171, -73.9314536, 'node/5126913521', 9),
  ('black-horse-pub', 40.6651877, -73.9900027, 'way/249632922', 0),
  ('black-rabbit', 40.7300934, -73.9564221, 'node/2275479427', 20),
  ('blackbirds', 40.7634117, -73.9134101, 'node/2259025798', 2),
  ('blind-tiger', 40.7318556, -74.0032442, 'node/3157703734', 0),
  ('blondies-sports-bar', 40.7832747, -73.9791292, 'node/11583940165', 9),
  ('blue-and-gold-tavern', 40.7273351, -73.9862728, 'node/12542984188', 48),
  ('blueprint', 40.6768648, -73.980329, 'node/5182790887', 6),
  ('bohemian-hall', 40.7729547, -73.9158034, 'way/375930680', 0),
  ('bondurants', 40.7771345, -73.9518481, 'node/4945827921', 0),
  ('boobie-trap', 40.7001545, -73.9160836, 'node/2568686431', 0),
  ('bootleg-bar', 40.6988008, -73.9172377, 'node/10738353371', 3),
  ('bossa-nova-civic-club', 40.6979017, -73.9278919, 'node/3141134043', 10),
  ('boxers-chelsea', 40.7407461, -73.9931415, 'node/5607967821', 0),
  ('brandys-piano-bar', 40.7770063, -73.9534632, 'node/9029130049', 9),
  ('broadway-dive', 40.7978913, -73.9690987, 'node/2761444458', 0),
  ('broken-land', 40.7295259, -73.9576837, 'node/6684049777', 10),
  ('brooklyn-bowl', 40.7219806, -73.957629, 'node/2402042494', 11),
  ('brooklyn-public-house', 40.6895922, -73.969402, 'node/8613867470', 94),
  ('brouwerij-lane', 40.7297253, -73.9579297, 'node/10355265206', 0),
  ('burp-castle', 40.7283251, -73.9886573, 'node/879705916', 0),
  ('buttermilk-bar', 40.6648053, -73.9897664, 'node/5777945555', 9),
  ('caledonia-bar', 40.7762953, -73.9531193, 'node/9275881443', 6),
  ('capri-social-club', 40.7277065, -73.9542254, 'node/12730434027', 135),
  ('carousel', 40.7059005, -73.9220539, 'node/11334987760', 118),
  ('clandestino', 40.7147395, -73.9908755, 'node/5899626375', 2),
  ('clinton-hall', 40.7080962, -74.0146254, 'node/4762006023', 22),
  ('club-cumming', 40.7253473, -73.9834179, 'node/9147146733', 7),
  ('commonwealth', 40.6672125, -73.9877442, 'node/5777872160', 6),
  ('compagnie-des-vins', 40.7204999, -73.9980785, 'node/7075366387', 0),
  ('corner-bistro', 40.7380383, -74.0037627, 'node/3925051662', 0),
  ('cronin-phelans', 40.7589945, -73.9193771, 'node/11286207470', 0),
  ('dakota-bar', 40.7774878, -73.9785066, 'node/2745321892', 0),
  ('dba', 40.7243345, -73.9880064, 'node/3819787827', 1),
  ('dead-poet', 40.7849421, -73.9772607, 'node/7418121964', 8),
  ('dead-rabbit', 40.7032493, -74.0110052, 'node/4843854724', 3),
  ('dear-irving-on-hudson', 40.7561752, -73.9919029, 'node/12998414902', 19),
  ('diamond-lil', 40.7254359, -73.9461046, 'node/12730434030', 0),
  ('dive-75', 40.7796024, -73.9776732, 'node/8653253617', 0),
  ('dive-bar-uws', 40.7939248, -73.9707003, 'node/7159217185', 8),
  ('doc-watsons', 40.7722993, -73.9555674, 'node/9559184089', 5),
  ('dominies-hoek', 40.7435557, -73.9536593, 'node/8335033421', 0),
  ('doppelganger', 40.693244, -73.9692317, 'node/6434631784', 54),
  ('double-chicken-please', 40.7195842, -73.9904912, 'node/12366546101', 10),
  ('dram-shop', 40.6687941, -73.9851157, 'node/5706864741', 6),
  ('dublin-house', 40.7837467, -73.9792925, 'node/2592129931', 12),
  ('dutch-freds', 40.760714, -73.9879098, 'node/5181120222', 20),
  ('dutch-kills', 40.7477058, -73.9402242, 'node/5994163585', 6),
  ('eagle-nyc', 40.7517058, -74.0042924, 'node/4395618692', 0),
  ('eavesdrop', 40.7248795, -73.9512955, 'node/11517820569', 58),
  ('elsewhere', 40.7095211, -73.9232632, 'way/279780209', 5),
  ('employees-only', 40.7334339, -74.0060767, 'node/4146399196', 0),
  ('fifth-hammer', 40.7464921, -73.9515404, 'node/4995779511', 0),
  ('flaming-saddles', 40.7652832, -73.9878804, 'node/5414819121', 128),
  ('fleur-room', 40.7464637, -73.9909625, 'node/6375303885', 41),
  ('focal-point-beer', 40.7502415, -73.948481, 'node/13891314939', 103),
  ('four-horsemen', 40.7130756, -73.9572969, 'node/4015169994', 10),
  ('freddys-bar', 40.663297, -73.9911777, 'node/5455223694', 3),
  ('fresh-kills-bar', 40.7147284, -73.9615689, 'node/12743431907', 7),
  ('fritz', 40.6866941, -73.9750326, 'node/5866994006', 148),
  ('gebhards-beer-culture', 40.7790485, -73.9831265, 'node/11852588968', 7),
  ('george-keeley', 40.785875, -73.976089, 'node/5741364421', 10),
  ('gingers-bar', 40.6713308, -73.9843022, 'node/5182473281', 8),
  ('goldies', 40.7256462, -73.9451382, 'node/6818558685', 1),
  ('good-judy', 40.6652938, -73.989342, 'node/5984018676', 9),
  ('good-room', 40.7269085, -73.9528103, 'node/2842886527', 67),
  ('greenwood-park', 40.6594269, -73.9879188, 'way/647022893', 3),
  ('happyfun-hideaway', 40.6975004, -73.9316128, 'node/5743888501', 6),
  ('harlem-tavern', 40.8047935, -73.9555304, 'way/1115907819', 88),
  ('harrys', 40.7045634, -74.0098904, 'node/11208788096', 9),
  ('hart-bar', 40.6963535, -73.9299985, 'node/5743448065', 0),
  ('haswell-greens', 40.7629849, -73.9841773, 'node/13961021498', 5),
  ('high-dive', 40.6749501, -73.9812915, 'node/3737560400', 10),
  ('holiday-cocktail-lounge', 40.727916, -73.985742, 'node/10270699211', 7),
  ('hotel-delmano', 40.7197084, -73.9580192, 'node/2839699882', 0),
  ('iggys', 40.7711285, -73.9564384, 'node/9173102299', 110),
  ('international-bar', 40.7264673, -73.9858887, 'node/12368232318', 63),
  ('iona', 40.7142662, -73.9610178, 'node/12959524802', 8),
  ('jakes-dilemma', 40.7843285, -73.977698, 'node/7194308188', 8),
  ('jeremys-ale-house', 40.7076703, -74.0020534, 'node/4850227823', 7),
  ('jg-melon', 40.771073, -73.9593705, 'node/3448866514', 0),
  ('jimmys-corner', 40.7567033, -73.9847548, 'node/3974095816', 16),
  ('jones-wood-foundry', 40.7702874, -73.9536038, 'node/10982822004', 6),
  ('joyface', 40.723918, -73.9787909, 'node/11623463037', 0),
  ('judy-and-punch', 40.7655055, -73.918796, 'node/5136305517', 101),
  ('julius', 40.7345357, -74.00163, 'node/2562439843', 0),
  ('jungle-bird', 40.742595, -74.000177, 'node/2377128149', 9),
  ('jupiter-disco', 40.7081511, -73.9235714, 'node/5679659087', 8),
  ('katana-kitten', 40.7342532, -74.0064058, 'node/9655048217', 4),
  ('keg-and-lantern', 40.7240368, -73.9503056, 'node/2842613049', 51),
  ('kettle-of-fish', 40.7338361, -74.0024203, 'node/9138091002', 3),
  ('keys-and-heels', 40.7722433, -73.955622, 'node/9559075749', 0),
  ('killarney-rose', 40.7050656, -74.0086896, 'node/1585033979', 2),
  ('la-noxe', 40.7470484, -73.9931695, 'node/8614943073', 6),
  ('landmark-tavern', 40.7631922, -73.9963261, 'node/1873813892', 55),
  ('las-lap', 40.71766, -73.9903523, 'node/12729319283', 11),
  ('le-bain', 40.7412916, -74.0080457, 'node/2921544618', 0),
  ('le-dive', 40.7147362, -73.9909568, 'node/2567561003', 0),
  ('left-hand-path', 40.7051123, -73.9202649, 'node/5626983263', 4),
  ('letlove-inn', 40.7755381, -73.9147688, 'node/12216995926', 0),
  ('lions-head-tavern', 40.802193, -73.9641798, 'node/2761651148', 0),
  ('little-branch', 40.7301156, -74.0050252, 'node/5994163587', 0),
  ('lucky-dog', 40.7134988, -73.9617159, 'way/241837928', 0),
  ('madelines', 40.7302402, -73.9578047, 'node/2843008383', 71),
  ('magic-hour', 40.7523932, -73.9893008, 'node/2709702424', 1),
  ('manhatta', 40.7078151, -74.0086882, 'node/5801870934', 2),
  ('marquee-new-york', 40.7500931, -74.0028209, 'node/7050439887', 1),
  ('mcsorleys-old-ale-house', 40.7287612, -73.9897021, 'node/9036389119', 0),
  ('mehanata', 40.7194846, -73.9888709, 'node/6233725914', 2),
  ('metropolitan-bar', 40.7136339, -73.9494852, 'node/6379666403', 1),
  ('milanos-bar', 40.724629, -73.9946134, 'node/8000650772', 21),
  ('mister-paradise', 40.7267585, -73.9861797, 'node/12324923075', 73),
  ('monarch-rooftop', 40.7503902, -73.9867656, 'node/6943977885', 0),
  ('monas', 40.7291724, -73.9783661, 'node/2491343755', 9),
  ('mood-ring', 40.6977941, -73.9269769, 'node/2568592584', 0),
  ('moonlight-mile', 40.7321469, -73.9578047, 'node/2843008352', 83),
  ('mosaic', 40.7746159, -73.918453, 'node/2853184678', 0),
  ('mothers-ruin', 40.7213363, -73.9950075, 'node/3451050931', 46),
  ('mr-purple', 40.7218111, -73.9882321, 'node/4475036592', 22),
  ('niagara', 40.725928, -73.9834617, 'node/2549926891', 0),
  ('ninth-avenue-saloon', 40.7607594, -73.9906983, 'node/12177578856', 112),
  ('nobody-told-me', 40.8008066, -73.9651977, 'node/7159068915', 121),
  ('oak-and-iron', 40.7314664, -73.9580086, 'node/5082647022', 6),
  ('oharas-restaurant-and-pub', 40.709558, -74.012778, 'node/888527171', 49),
  ('old-stanleys', 40.7009726, -73.9139612, 'node/5365041384', 130),
  ('on-the-rocks', 40.7637689, -73.9922272, 'node/8542108505', 19),
  ('ornithology-jazz-club', 40.6955322, -73.9320225, 'node/6590061294', 0),
  ('ottos-shrunken-head', 40.7295158, -73.9786409, 'node/2901108443', 11),
  ('overstory', 40.7065765, -74.0080763, 'node/12366551501', 3),
  ('owl-farm', 40.6695398, -73.9866612, 'node/6296605532', 15),
  ('owls-tail', 40.7809547, -73.9808772, 'node/8651793617', 0),
  ('palace-cafe', 40.7254611, -73.944628, 'node/10307594984', 0),
  ('pearls-social-and-billy-club', 40.7071565, -73.9212797, 'node/5625524341', 0),
  ('petes-candy-store', 40.7181021, -73.9501774, 'node/6403009246', 9),
  ('pine-box-rock-shop', 40.7053329, -73.9326938, 'node/5750540226', 12),
  ('plug-uglies', 40.7718409, -73.9533011, 'node/9858440588', 43),
  ('pocket-bar', 40.7633931, -73.9923609, 'node/2709931391', 0),
  ('pony-bar', 40.76977, -73.954316, 'node/2629371900', 0),
  ('press-lounge', 40.7645137, -73.9958411, 'node/6457983889', 54),
  ('prohibition', 40.7852443, -73.9728265, 'node/6606909410', 7),
  ('purgatory', 40.6872341, -73.9057389, 'way/250422727', 0),
  ('putnams-pub', 40.6932326, -73.9690543, 'node/2605399150', 94),
  ('raines-law-room', 40.7387302, -73.9945926, 'node/5778906637', 3),
  ('rebeccas', 40.698215, -73.9342007, 'node/5744320023', 0),
  ('refinery-rooftop', 40.7522458, -73.9853353, 'node/6597932385', 9),
  ('reifs-tavern', 40.7814029, -73.9485796, 'node/5548115057', 109),
  ('royal-palms-shuffleboard', 40.6787406, -73.9868491, 'node/3743290030', 0),
  ('rudys-bar-and-grill', 40.759988, -73.9917263, 'node/5057079090', 5),
  ('rum-house', 40.7597407, -73.9861863, 'node/2717293852', 14),
  ('russian-vodka-room', 40.7634867, -73.9847984, 'node/2717355367', 0),
  ('ryan-maguires', 40.7081693, -74.0051431, 'node/3784213874', 145),
  ('ryans-daughter', 40.7762991, -73.9504574, 'node/10893590822', 6),
  ('sake-bar-decibel', 40.7292871, -73.9877312, 'node/9809110694', 6),
  ('scallywags', 40.7561041, -73.9940676, 'node/5819364580', 56),
  ('sea-witch', 40.6609017, -73.9936738, 'node/6037924843', 4),
  ('sid-golds', 40.7458591, -73.9936087, 'node/6407832772', 10),
  ('singlecut', 40.7782956, -73.9016716, 'way/241857450', 0),
  ('skin-contact', 40.7177244, -73.9903192, 'node/12719181899', 10),
  ('skinny-dennis', 40.7158872, -73.9621335, 'node/2465888776', 0),
  ('smalls-jazz-club', 40.7343811, -74.0027295, 'node/4483787091', 2),
  ('smithfield-hall', 40.7447503, -73.993589, 'node/4680472389', 112),
  ('somewhere-nowhere-nyc', 40.7442513, -73.9925123, 'node/12998364101', 20),
  ('sonnys-corner', 40.729763, -73.9574255, 'node/2015482687', 102),
  ('sophies', 40.7247462, -73.9838567, 'node/6473236071', 10),
  ('split-eights', 40.7058839, -74.0102847, 'node/11208744396', 35),
  ('spring-lounge', 40.7219227, -73.9964156, 'node/6568795185', 44),
  ('st-jardim', 40.7343508, -74.0028751, 'node/10885671406', 15),
  ('stonewall-inn', 40.7338163, -74.0021613, 'node/368043598', 2),
  ('stout-nyc-fidi', 40.7081144, -74.0065237, 'node/4387094640', 118),
  ('stumble-inn', 40.771213, -73.9563888, 'node/2723782890', 0),
  ('sugar-monk', 40.8089408, -73.9518174, 'node/11580920969', 31),
  ('sunshine-laundromat', 40.7292524, -73.9537238, 'node/5057358326', 10),
  ('sunswick-3535', 40.7565734, -73.9254957, 'node/2846596408', 0),
  ('tanner-smiths', 40.7643596, -73.9815651, 'node/11384449991', 51),
  ('the-alibi', 40.6893642, -73.9694855, 'node/6402886957', 53),
  ('the-beast-next-door', 40.748908, -73.9408313, 'node/4995839498', 0),
  ('the-bonnie', 40.774704, -73.9136014, 'node/5487117025', 0),
  ('the-campbell', 40.752605, -73.9778482, 'node/5319150021', 0),
  ('the-ditty', 40.774834, -73.9086149, 'node/12037259035', 0),
  ('the-double-windsor', 40.6605732, -73.9804283, 'node/1039613744', 0),
  ('the-emerson', 40.6940535, -73.9618019, 'node/9583805198', 0),
  ('the-four-faced-liar', 40.7321644, -74.0013984, 'node/10606691227', 0),
  ('the-frying-pan', 40.7523006, -74.0094145, 'node/2981930233', 0),
  ('the-full-shilling', 40.7057985, -74.0075564, 'node/4844071325', 8),
  ('the-garret', 40.7323251, -74.0038428, 'node/4305056427', 6),
  ('the-gate', 40.6725755, -73.9832656, 'node/1932902780', 0),
  ('the-gin-mill', 40.7847131, -73.9774249, 'node/7192228729', 11),
  ('the-hoptimist', 40.7840717, -73.9779024, 'node/11541696469', 61),
  ('the-jeffrey', 40.7609957, -73.9630765, 'node/4945939321', 8),
  ('the-johnsons', 40.7058302, -73.9237933, 'node/5623442598', 11),
  ('the-last-word', 40.7753994, -73.9099221, 'node/12164467268', 0),
  ('the-levee', 40.7163751, -73.9615756, 'node/2465889352', 0),
  ('the-narrows', 40.7040364, -73.9307858, 'node/5490145121', 0),
  ('the-penrose', 40.7754854, -73.953238, 'node/6377007361', 14),
  ('the-sampler', 40.7055984, -73.9224758, 'node/5624790243', 0),
  ('the-scratcher', 40.7275668, -73.9905608, 'node/4846659021', 12),
  ('the-skylark', 40.7541745, -73.9888207, 'node/5752764087', 10),
  ('the-ten-bells', 40.7179116, -73.9898326, 'node/5209387823', 10),
  ('the-tippler', 40.7423493, -74.0061823, 'node/2702831820', 0),
  ('the-wolfhound', 40.7639277, -73.9154228, 'node/5136306087', 0),
  ('threes-brewing-gp', 40.7303713, -73.9578334, 'node/7424179953', 15),
  ('tiki-chick', 40.7868369, -73.9753999, 'node/2757387164', 0),
  ('tir-na-nog', 40.7499443, -73.9943348, 'node/663102624', 0),
  ('toad-hall', 40.7221836, -74.0035553, 'node/10090538380', 67),
  ('torst', 40.7234245, -73.9507393, 'node/13372867017', 7),
  ('trailer-park-lounge', 40.7452301, -73.9978783, 'node/11844522999', 12),
  ('treadwell-park', 40.7614626, -73.9608387, 'node/3446705496', 87),
  ('trinity-place', 40.7090297, -74.0114731, 'node/4324282097', 10),
  ('troost', 40.7334503, -73.9549611, 'node/4109867475', 6),
  ('twins-lounge', 40.7262762, -73.9520758, 'node/12730434024', 43),
  ('union-hall', 40.6760065, -73.980132, 'way/248158548', 5),
  ('union-pool', 40.7150021, -73.9516171, 'node/2465884892', 0),
  ('valhalla', 40.765979, -73.9873999, 'node/4030939257', 122),
  ('vazacs', 40.7250128, -73.9813915, 'node/2454126844', 0),
  ('vers', 40.7626147, -73.9893366, 'node/10212457222', 118),
  ('vig-bar', 40.7211586, -73.9946239, 'node/12365512172', 52),
  ('warsaw', 40.7223925, -73.9484695, 'way/280077713', 21),
  ('welcome-johnsons', 40.7196706, -73.9873004, 'node/4282785789', 12),
  ('westland-roe', 40.7783615, -73.9815253, 'node/2745119754', 5),
  ('westlight', 40.7223271, -73.9567564, 'node/4406520514', 5),
  ('white-horse-tavern', 40.7356943, -74.0061832, 'node/4284531651', 0),
  ('white-horse-tavern-fidi', 40.7036814, -74.0123807, 'node/5337272121', 10),
  ('wonderville', 40.6924111, -73.9275164, 'node/2565070775', 2),
  ('young-ethels', 40.6671642, -73.988172, 'node/6953017126', 13),
  ('yours-sincerely', 40.7028281, -73.929185, 'node/6126008888', 119);

do $$
declare
  missing text;
  outside integer;
begin
  select string_agg(f.id, ', ') into missing
    from _osm_resource f left join public.bars b on b.id = f.id
   where b.id is null;
  if missing is not null then
    raise exception '0030: ids not present in public.bars: %', missing;
  end if;

  select count(*) into outside from _osm_resource
   where lat not between 40.45 and 41.0 or lng not between -74.30 and -73.60;
  if outside > 0 then
    raise exception '0030: % replacement coordinate(s) outside the NYC bbox', outside;
  end if;

  -- Nothing here should be a large move; 0029 already handled the genuinely
  -- wrong ones. A big jump means the input was built from the wrong sweep.
  if exists (select 1 from _osm_resource where moves_m > 150) then
    raise exception '0030: a correction exceeds the 150m matcher radius — regenerate the input';
  end if;
end $$;

update public.bars b
   set lat        = f.lat,
       lng        = f.lng,
       updated_at = now()
  from _osm_resource f
 where b.id = f.id
   and (abs(b.lat - f.lat) > 1e-6 or abs(b.lng - f.lng) > 1e-6);

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
    from public.bars b join _osm_resource f on f.id = b.id
   where abs(b.lat - f.lat) > 1e-6 or abs(b.lng - f.lng) > 1e-6;
  if remaining > 0 then
    raise exception '0030: % row(s) did not take the new coordinates', remaining;
  end if;
  raise notice '0030: 259 venues re-sourced to OpenStreetMap coordinates';
end $$;

commit;

------------------------------------------------------------------------------
-- HELD BACK — five venues, each needing a human
--
--   diamond-dogs           the same-name OSM node is 1,249m from this venue's
--                          own address. That is not a placement quirk; it is
--                          probably a different venue sharing a name, or our
--                          address is wrong. Do not adopt either value blind.
--   rocka-rolla            address geocodes 81m from the OSM node.
--   230-fifth-rooftop-bar  address geocodes 61m from the OSM node (marginal).
--   rivercrest             no usable arbitration result.
--   watermark-bar          no usable arbitration result.
--
-- The last two are both waterfront/rooftop venues, where a street address is a
-- poor proxy for where the bar actually is — worth remembering before trusting
-- a geocode for that class of venue.
--
-- STILL OWED after this migration:
--   * 140 venues with no OSM node at all — their coordinates remain
--     Google-derived. Geocoding their addresses via Nominatim is the obvious
--     next step, at the cost of a building-level rather than venue-level point.
--   * 29 stale sidecar rows present in neither the catalog nor the bars table.
--   * src/lib/bars.places.ts still SHIPS Google lat/lng to the client. Dropping
--     those fields is what actually ends the 30-day exposure; this migration
--     fixes the stored value, not the shipped one.
------------------------------------------------------------------------------
