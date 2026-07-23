-- Next Bar — 0004 backfill profiles for pre-existing auth users
--
-- 0001's handle_new_user trigger only fires for NEW signups. The live project
-- has auth users created before 0001 was actually applied (see 0000 header),
-- so their profile rows must be backfilled or ratings sync FK inserts fail.
--
-- Idempotent: ON CONFLICT DO NOTHING.

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

------------------------------------------------------------------------------
-- Rollback (in comments): delete only rows this created, i.e. profiles with
-- no user data yet:
--   delete from public.profiles where handle is null and display_name is null;
------------------------------------------------------------------------------
