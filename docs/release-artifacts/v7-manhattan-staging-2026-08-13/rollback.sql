-- Generated before apply. Run only after a successful application of this exact payload.
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.bars WHERE source = 'census' AND id IN ('osm-node-10874836805', 'osm-node-12982612201', 'osm-node-13375040754', 'osm-node-13550914367', 'osm-node-13567251701', 'osm-node-1706037451', 'osm-node-2542549644', 'osm-node-2555126634', 'osm-node-2555128954', 'osm-node-2567557167', 'osm-node-2702802602', 'osm-node-2703424308', 'osm-node-2709479288', 'osm-node-3618200208', 'osm-node-3676873363', 'osm-node-3822484904', 'osm-node-4113144390', 'osm-node-4319001989', 'osm-node-4832284232', 'osm-node-4848257931', 'osm-node-4947754523', 'osm-node-5812743217', 'osm-node-5957624985', 'osm-node-5978792897', 'osm-node-5981570885', 'osm-node-6222318519', 'osm-node-6367931785', 'osm-node-6622046385', 'osm-node-7097867545', 'osm-node-7159193384', 'osm-node-7951261386', 'osm-node-8272848251', 'osm-node-9978637391')) <> 33 THEN
    RAISE EXCEPTION 'rollback target mismatch';
  END IF;
END $$;
DELETE FROM public.bars WHERE source = 'census' AND id IN ('osm-node-10874836805', 'osm-node-12982612201', 'osm-node-13375040754', 'osm-node-13550914367', 'osm-node-13567251701', 'osm-node-1706037451', 'osm-node-2542549644', 'osm-node-2555126634', 'osm-node-2555128954', 'osm-node-2567557167', 'osm-node-2702802602', 'osm-node-2703424308', 'osm-node-2709479288', 'osm-node-3618200208', 'osm-node-3676873363', 'osm-node-3822484904', 'osm-node-4113144390', 'osm-node-4319001989', 'osm-node-4832284232', 'osm-node-4848257931', 'osm-node-4947754523', 'osm-node-5812743217', 'osm-node-5957624985', 'osm-node-5978792897', 'osm-node-5981570885', 'osm-node-6222318519', 'osm-node-6367931785', 'osm-node-6622046385', 'osm-node-7097867545', 'osm-node-7159193384', 'osm-node-7951261386', 'osm-node-8272848251', 'osm-node-9978637391');
COMMIT;
