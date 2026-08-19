------------------------------------------------------------------------------
-- 0053_night_outs_nyc_rollover.sql — a night is an NYC night, in SQL too
------------------------------------------------------------------------------
-- Tenth file. 0044-0052 are applied and checksum-recorded, so they are
-- immutable and corrections are additive.
--
-- (Cold panel, BOTH lanes, HIGH) `is_past` in 0052 compares the plan's night to
-- UTC `current_date`. The product does not define a night that way. A night is
-- the NYC calendar date with a **6am rollover** — 1am Saturday still belongs to
-- Friday night — which is what `src/lib/nightKey.ts` implements and what
-- create_night_out is handed at creation time.
--
-- The consequence lands exactly when the feature is used. NYC is UTC-4 in
-- summer, so from 20:00 NYC the UTC date has already advanced. A plan created
-- for tonight is `night < current_date` from 8pm onward, so `is_past` goes true
-- and the invitation card renders "This invite has expired — already happened"
-- with nothing but a Dismiss button. **A pending invitee cannot accept an
-- invitation to tonight, on tonight**, even though respond_night_out would
-- still take it. That is the primary path of the whole feature.
--
-- This is a SWEEP, not a patch. Every `current_date` that means "which night is
-- it" is replaced, in both places it appears in a live definition:
--   * 0052 get_my_night_outs  — is_past
--   * 0044 create_night_out   — the accepted date range AND the per-owner
--                               live-plan cap window
--
-- One definition, shared. The client keeps nycNightKey() because it needs the
-- value before any round trip; the rule itself now exists once on each side and
-- both are pinned by tests, rather than the SQL silently meaning something else.
------------------------------------------------------------------------------

-- The 6am rollover, expressed once. `at time zone` resolves DST correctly, and
-- subtracting six hours before taking the date is precisely "before 6am counts
-- as yesterday".
-- The instant is a PARAMETER defaulting to now(). Without it this rule cannot
-- be tested: its whole failure mode lives in a three-to-four hour window each
-- evening, and a test that can only observe the current clock either passes by
-- accident or has to wait until 8pm to fail. Untestable time logic is what
-- produced the defect this file fixes.
create or replace function public.nyc_night_key(p_at timestamptz default now())
returns date
language sql
immutable
as $$
  select (((p_at at time zone 'America/New_York') - interval '6 hours'))::date
$$;

comment on function public.nyc_night_key(timestamptz) is
  'The current NYC night as a date, with a 6am rollover. Mirrors nycNightKey() '
  'in src/lib/nightKey.ts. Any comparison meaning "which night is it" uses this, '
  'never current_date, which is UTC and rolls over mid-evening in New York.';

revoke all on function public.nyc_night_key(timestamptz) from public, anon, authenticated;
grant execute on function public.nyc_night_key(timestamptz) to authenticated;

------------------------------------------------------------------------------
-- 1. get_my_night_outs — correct is_past, and stop returning your OWN plans
------------------------------------------------------------------------------
-- Second fix in the same function (cold panel, Codex, medium): this feeds an
-- INVITATION surface, and it was returning every membership row including the
-- one create_night_out writes for the owner. Your own plan appeared as an
-- invitation to yourself. Owners reach their plans by link; this list answers
-- "what am I invited to?", so it excludes rows where you are the owner.

create or replace function public.get_my_night_outs()
returns table (
  night_out_id uuid,
  night date,
  title text,
  status text,
  owner_handle text,
  owner_display_name text,
  my_status text,
  responded_at timestamptz,
  accepted_count integer,
  share_token uuid,
  plan_updated boolean,
  is_past boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.night,
    n.title,
    n.status,
    p.handle::text,
    p.display_name::text,
    me.invite_status,
    me.responded_at,
    (select count(*)::integer
       from public.night_out_members a
      where a.night_out_id = n.id and a.invite_status = 'accepted'),
    case when me.invite_status = 'accepted' then n.share_token end,
    exists (
      select 1 from public.night_out_events e
       where e.night_out_id = n.id
         and e.kind = 'plan_changed'
         and me.responded_at is not null
         and e.created_at > me.responded_at
    ),
    n.night < public.nyc_night_key()
  from public.night_out_members me
  join public.night_outs n on n.id = me.night_out_id
  join public.profiles p on p.id = n.owner_id
  where me.user_id = auth.uid()
    and n.owner_id <> auth.uid()   -- invitations, not your own plans
    and n.status <> 'cancelled'
  order by
    case when me.invite_status = 'pending' then 0 else 1 end,
    -- SOONEST first. 0052 said "soonest" in its comment and sorted DESC; the
    -- comment was right and the code was wrong (cold panel, Claude, medium).
    n.night asc,
    n.id desc
$$;

revoke all on function public.get_my_night_outs() from public, anon, authenticated;
grant execute on function public.get_my_night_outs() to authenticated;

------------------------------------------------------------------------------
-- 2. create_night_out — the accepted range and the cap window are NYC nights
------------------------------------------------------------------------------
-- Otherwise, for the same three or four evening hours, creating a plan for
-- tonight is rejected as "night out of range" and the live-plan cap counts a
-- different set of nights than the user sees. Body is 0044's, unchanged apart
-- from the two date comparisons.

create or replace function public.create_night_out(
  p_night date,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_cap constant integer := 10;  -- live (non-cancelled, current) plans per owner
  v_uid uuid := auth.uid();
  v_id uuid;
  v_live integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null
     or p_night < (public.nyc_night_key() - 2)
     or p_night > (public.nyc_night_key() + 60) then
    raise exception 'night out of range' using errcode = '22023';
  end if;
  if p_title is not null and char_length(trim(p_title)) not between 1 and 80 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_outs:' || v_uid::text, 0));
  select count(*) into v_live
    from public.night_outs n
   where n.owner_id = v_uid
     and n.status <> 'cancelled'
     and n.night >= (public.nyc_night_key() - 2);
  if v_live >= plan_cap then
    raise exception 'too many open night outs' using errcode = '54000';
  end if;

  insert into public.night_outs (owner_id, night, title)
  values (v_uid, p_night, nullif(trim(p_title), ''))
  returning id into v_id;

  insert into public.night_out_members
    (night_out_id, user_id, role, invite_status, responded_at)
  values (v_id, v_uid, 'owner', 'accepted', now())
  on conflict on constraint night_out_members_pkey do nothing;

  return v_id;
end;
$$;

revoke all on function public.create_night_out(date, text) from public, anon, authenticated;
grant execute on function public.create_night_out(date, text) to authenticated;
