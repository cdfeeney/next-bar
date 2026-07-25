-- Next Bar — 0013 unrsvp_bar RPC (serialized "I'm out")
--
-- PR #14 review follow-up (N2b): "I'm out" was an own-row table DELETE,
-- which does NOT take the per-user advisory lock rsvp_bar serializes
-- writes under. Cross-tab race: tab A taps "I'm out" while tab B taps
-- "I'm in" elsewhere — the unserialized DELETE can land between tab B's
-- delete-then-insert (deleting nothing, since the old row is already
-- gone) and the user ends up IN at the new bar despite intending OUT;
-- the interleaving decides, not the user's last tap.
--
--   1. unrsvp_bar(bar, night) RPC — same validation + advisory-lock key
--      as rsvp_bar ('bar_rsvps:' || uid), so every RSVP write for a user
--      is serialized through one lock. Idempotent: deleting an absent
--      row still returns true (toggle-off stays safe to re-tap).
--
-- The own-row DELETE grant + policy from 0012 are RETAINED for the
-- deploy window (already-loaded clients still table-delete until the
-- lib-swap deploy replaces them). Candidate for revocation in a later
-- migration once the swap is verified in prod — at that point the two
-- RPCs become the only write paths and the lock covers everything.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. unrsvp_bar(bar, night) — serialized own-RSVP withdrawal
------------------------------------------------------------------------------

create or replace function public.unrsvp_bar(bar text, night date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or bar is null or night is null then
    return false;
  end if;
  if night < (current_date - 2) or night > (current_date + 2) then
    return false;
  end if;
  if bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;

  -- Same lock key as rsvp_bar (0012): all of a user's RSVP writes are
  -- serialized through one advisory lock, closing the cross-tab race.
  perform pg_advisory_xact_lock(hashtextextended('bar_rsvps:' || uid::text, 0));

  delete from public.bar_rsvps r
   where r.user_id = uid
     and r.bar_id = unrsvp_bar.bar
     and r.night = unrsvp_bar.night;

  -- True even when no row matched: "I'm out" of a bar you're not in is
  -- a satisfied request, and the client treats false as a shown error.
  return true;
end;
$$;

revoke all on function public.unrsvp_bar(text, date) from public, anon;
grant execute on function public.unrsvp_bar(text, date) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.unrsvp_bar(text, date) from authenticated;
--   drop function if exists public.unrsvp_bar(text, date);
------------------------------------------------------------------------------
