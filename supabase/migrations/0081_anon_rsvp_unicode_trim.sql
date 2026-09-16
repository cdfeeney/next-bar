-- 0081 — a guest's name is trimmed the way the browser trims it, and the board
-- reads every link reply in ONE snapshot (R-04 items 3 and 4, out of G-01 r2).
--
-- TWO REPLACEMENTS, no schema change, no grant change. 0080 is already applied
-- to staging, so both are `create or replace` under the SAME signatures.
--
--   1. rsvp_night_out_by_token — 0080 stripped E' \t\n\r\f\v', which is what
--      the round-1 reviewer asked for and still not String.trim(): a name made
--      of U+00A0 non-breaking spaces passed the not-null check and stored an
--      effectively nameless Going (round-2 Codex, the same finding one layer
--      deeper). The trim is now a regex. Probed read-only against staging
--      (PostgreSQL 17.6, UTF8) on 2026-09-16: `\s` there matches U+0009-000D,
--      U+0020, U+00A0, U+2000-200A, U+2028/29, U+202F, U+3000 — everything
--      String.trim() strips EXCEPT U+FEFF, which the class names explicitly.
--      Everything else in the function is byte-for-byte 0080.
--
--   2. get_night_out_anon_guests — returns EVERY reply on the plan, guest_name
--      NULL for a nameless one, instead of the named rows alone. The board used
--      to subtract these rows from get_night_out_anon_rsvps' counts, and the two
--      were separate reads: a guest who changed Going to Maybe between them
--      could be rendered as a Maybe row AND counted in "2 going". One read,
--      one snapshot; the client derives both the rows and the remainder from
--      it. get_night_out_anon_rsvps stays defined (0068) and unused by this
--      client.
--
-- Applied to STAGING on the owner's word; production as its own authorised
-- step before any production deploy that carries this.

------------------------------------------------------------------------------
-- 1. rsvp_night_out_by_token — the trim matches String.trim().
------------------------------------------------------------------------------

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

  -- The same set String.trim() strips: Unicode White_Space (which `\s` covers
  -- under this database's UTF8 collation, U+00A0 included) plus U+FEFF, which
  -- Unicode does not class as space but JavaScript trims anyway.
  v_name := nullif(regexp_replace(p_guest_name, '^[\s\ufeff]+|[\s\ufeff]+$', '', 'g'), '');
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
  '0068''s bearer RSVP writer, replaced forward in 0080 (G-01) with an optional guest name and in 0081 (R-04) with a String.trim()-equivalent trim. Going / Maybe require a name (typed now or already on the row); declined may be nameless. Same token / key / cap rules as before.';

revoke all on function public.rsvp_night_out_by_token(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rsvp_night_out_by_token(uuid, uuid, text, text) to anon, authenticated;

------------------------------------------------------------------------------
-- 2. get_night_out_anon_guests — every reply, one snapshot.
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
     and public.night_out_role(p_night_out) is not null
   order by r.updated_at asc;
$$;

comment on function public.get_night_out_anon_guests(uuid) is
  'G-01 (0080), widened in 0081 (R-04). Members only (night_out_role): EVERY share-link reply and its answer, oldest first; guest_name is NULL for a nameless one. The board derives the named rows and the nameless remainder from this one read.';

revoke all on function public.get_night_out_anon_guests(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out_anon_guests(uuid) to authenticated;
