-- Next Bar — 0003 demo cleanup (sample-night pollution)
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/<id>/sql/new
--
-- What this does:
--   1. Deletes `ratings` rows that are verbatim copies of the sample-night
--      demo seed. Before the client-side merge guard landed (isSeededDemoRating
--      in src/lib/demo/seed.ts), useRatings merged localStorage into Supabase
--      on first sign-in INCLUDING seeded demo ratings, so real accounts got
--      polluted with the demo "night out".
--
-- The sample-night bar_ids (source of truth: SAMPLE_NIGHT in
-- src/lib/demo/seed.ts, surfaced via src/lib/demo):
--   death-and-co, employees-only, attaboy, little-branch, smalls-jazz-club,
--   buvette, holiday-cocktail-lounge, white-horse-tavern, the-frying-pan
--
-- Rows are matched on the full (bar_id, tier, rated_at) tuple, NOT bar_id
-- alone: these are real bars a user can genuinely rate, but the seeder writes
-- fixed literal timestamps, so only exact seed copies match. A genuine rating
-- of the same bar (rated at its own moment) is untouched.
--
-- Idempotent: safe to re-run — a second run deletes zero rows.

------------------------------------------------------------------------------
-- 1. Delete merged sample-night demo rows
------------------------------------------------------------------------------

delete from public.ratings
where (bar_id, tier, rated_at) in (
  ('death-and-co',            'loved', '2026-05-27T02:30:00.000Z'::timestamptz),
  ('employees-only',          'loved', '2026-05-23T03:15:00.000Z'::timestamptz),
  ('attaboy',                 'loved', '2026-05-20T03:00:00.000Z'::timestamptz),
  ('little-branch',           'loved', '2026-05-17T04:00:00.000Z'::timestamptz),
  ('smalls-jazz-club',        'loved', '2026-05-14T05:10:00.000Z'::timestamptz),
  ('buvette',                 'liked', '2026-05-09T23:30:00.000Z'::timestamptz),
  ('holiday-cocktail-lounge', 'liked', '2026-05-05T02:20:00.000Z'::timestamptz),
  ('white-horse-tavern',      'liked', '2026-05-02T01:40:00.000Z'::timestamptz),
  ('the-frying-pan',          'pass',  '2026-04-28T22:50:00.000Z'::timestamptz)
);

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   Structural: nothing to undo — this migration creates/drops no objects.
--   Data: the DELETE is not self-reversible. To restore, re-insert the rows
--   from a pre-migration backup, e.g.:
--     insert into public.ratings (user_id, bar_id, tier, score, rated_at)
--     select user_id, bar_id, tier, score, rated_at
--     from backup.ratings_pre_0003
--     on conflict (user_id, bar_id) do nothing;
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- Verification (run manually):
--   select count(*) from public.ratings
--   where bar_id in ('death-and-co','employees-only','attaboy','little-branch',
--                    'smalls-jazz-club','buvette','holiday-cocktail-lounge',
--                    'white-horse-tavern','the-frying-pan')
--     and rated_at < '2026-06-01';
--   -- remaining rows for these bars should be genuine (user-chosen timestamps)
------------------------------------------------------------------------------
