-- 0080 — a share-link guest RSVPs with a name; who else is going needs an account (G-01).
--
-- Owner, 2026-09-16: "it should allow them to add their name, but ... to see
-- who else is going on a night out they need to make their account (organic
-- funnel to drive sign-ups)."
--
-- THREE CHANGES, all additive except one grant narrowing:
--   1. night_out_anon_rsvps.guest_name — nullable, ≤40 chars, what the guest
--      typed. Going and Maybe REQUIRE a name (server-side too); "Can't make it"
--      may stay nameless, and an existing named row keeps its name when the
--      answer changes without one.
--   2. rsvp_night_out_by_token gains p_guest_name. The 3-argument signature is
--      dropped and recreated with the 4th argument DEFAULTED so PostgREST has
--      exactly one candidate for either call shape (an overload beside the
--      old one would be ambiguous for a 3-key call). Behaviour of the old
--      shape is otherwise byte-for-byte the same, minus the name rule.
--   3. get_night_out_anon_guests — members read the named guests and their
--      answers. Counts stay in get_night_out_anon_rsvps, untouched.
--   4. preview_night_out_attendees is no longer executable by anon. The bearer
--      preview keeps the accepted COUNT (preview_night_out) — names are what the
--      account is for. Authenticated callers keep the grant.
--
-- Applied to STAGING on the owner's word; production as its own authorised
-- step before any production deploy that carries this.

alter table public.night_out_anon_rsvps
  add column if not exists guest_name text;

comment on column public.night_out_anon_rsvps.guest_name is
  'G-01 (0080). What the share-link guest typed, trimmed, ≤40 chars; NULL for a nameless "can''t make it". Members read it through get_night_out_anon_guests.';

------------------------------------------------------------------------------
-- 2. rsvp_night_out_by_token(p_token, p_key, p_response, p_guest_name default null)
------------------------------------------------------------------------------

drop function if exists public.rsvp_night_out_by_token(uuid, uuid, text);

create or replace function public.rsvp_night_out_by_token(
  p_token      uuid,
  p_key        uuid,
  p_response   text,
  p_guest_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  anon_rsvp_cap constant integer := 100;
  v_plan  uuid;
  v_count integer;
  v_name  text;
  v_has_name boolean;
begin
  if p_token is null or p_key is null or p_response is null
     or p_response not in ('going', 'maybe', 'declined') then
    return false;
  end if;

  -- btrim() with no second argument strips ORDINARY SPACES only, while the
  -- client's String.trim() strips tabs, newlines and other whitespace too
  -- (round-1 Codex): a name of tabs would have passed the "is not null" test
  -- and been stored as invisible whitespace. Strip the same set here.
  v_name := nullif(btrim(p_guest_name, E' \t\n\r\f\v'), '');
  if v_name is not null and char_length(v_name) > 40 then
    return false;
  end if;

  select n.id into v_plan
    from public.night_outs n
   where n.share_token = p_token
     and public.night_out_invite_live(n.id)
   limit 1;
  if v_plan is null then
    return false;
  end if;

  -- Going / Maybe carry a name: the one typed now, or the one already on the row.
  select (r.guest_name is not null) into v_has_name
    from public.night_out_anon_rsvps r
   where r.night_out_id = v_plan and r.rsvp_key = p_key;
  if p_response in ('going', 'maybe') and v_name is null and coalesce(v_has_name, false) = false then
    return false;
  end if;

  update public.night_out_anon_rsvps
     set response = p_response,
         guest_name = coalesce(v_name, guest_name),
         updated_at = now()
   where night_out_id = v_plan
     and rsvp_key = p_key;
  if found then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_anon_rsvps:' || v_plan::text, 0));

  update public.night_out_anon_rsvps
     set response = p_response,
         guest_name = coalesce(v_name, guest_name),
         updated_at = now()
   where night_out_id = v_plan
     and rsvp_key = p_key;
  if found then
    return true;
  end if;

  select count(*) into v_count
    from public.night_out_anon_rsvps
   where night_out_id = v_plan;
  if v_count >= anon_rsvp_cap then
    return false;
  end if;

  insert into public.night_out_anon_rsvps (night_out_id, rsvp_key, response, guest_name)
  values (v_plan, p_key, p_response, v_name)
  on conflict on constraint night_out_anon_rsvps_pkey
  do update set response = excluded.response,
                guest_name = coalesce(excluded.guest_name, public.night_out_anon_rsvps.guest_name),
                updated_at = now();
  return true;
end;
$$;

comment on function public.rsvp_night_out_by_token(uuid, uuid, text, text) is
  '0068''s bearer RSVP writer, replaced forward in 0080 (G-01) with an optional guest name. Going / Maybe require a name (typed now or already on the row); declined may be nameless. Same token / key / cap rules as before.';

revoke all on function public.rsvp_night_out_by_token(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rsvp_night_out_by_token(uuid, uuid, text, text) to anon, authenticated;

------------------------------------------------------------------------------
-- 3. get_night_out_anon_guests — members read the named guests.
------------------------------------------------------------------------------

create or replace function public.get_night_out_anon_guests(p_night_out uuid)
returns table (guest_name text, response text)
language sql
stable
security definer
set search_path = public
as $$
  select r.guest_name, r.response
    from public.night_out_anon_rsvps r
   where r.night_out_id = p_night_out
     and r.guest_name is not null
     and public.night_out_role(p_night_out) is not null
   order by r.updated_at asc;
$$;

comment on function public.get_night_out_anon_guests(uuid) is
  'G-01 (0080). Members only (night_out_role): each NAMED share-link guest and their answer, oldest first. Nameless answers stay in the counts (get_night_out_anon_rsvps).';

revoke all on function public.get_night_out_anon_guests(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out_anon_guests(uuid) to authenticated;

------------------------------------------------------------------------------
-- 4. Names are what the account is for: anon loses preview_night_out_attendees.
------------------------------------------------------------------------------

revoke execute on function public.preview_night_out_attendees(uuid) from anon;

comment on function public.preview_night_out_attendees(uuid) is
  '0068''s bearer attendee list, narrowed in 0080 (G-01): authenticated callers only. Anonymous link holders see the accepted COUNT (preview_night_out) and are asked to create an account to see who.';
