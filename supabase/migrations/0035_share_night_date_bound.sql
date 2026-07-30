-- Next Bar — 0035 bound share_night to the ±2-day window (C4 audit F1)
--
-- NOT APPLIED. The live ledger ends at 0032; 0033, 0034 and now 0035 are
-- authored and reviewed only.
--
-- docs/C4-DEFINER-FUNCTION-AUDIT-2026-07-30.md F1 (MEDIUM): share_night is the
-- only night-scoped writer with no date validation. Its three siblings all
-- clamp the night to a ±2-day window:
--
--   suggest_bar     (0011)  current_date ± 2
--   rsvp_bar        (0012)  current_date ± 2
--   cast_vibe_vote  (0017)  current_date ± 2
--   share_night     (0016)  NOTHING  <- this file
--
-- Why that matters more here than it looks. `shared_nights` is keyed
-- `primary key (user_id, night)`, so each DISTINCT date is a NEW ROW rather
-- than an upsert. share_night also has no rate cap. A signed-in caller can
-- therefore loop over arbitrary dates — share_night('2999-01-01', ...),
-- '2999-01-02', and so on — and every call inserts another row carrying up to
-- 20 bar ids of up to 100 chars (roughly 2 KB), plus a gen_random_uuid() in a
-- unique index. 100,000 dates is ~200 MB from one account and costs the caller
-- nothing but time.
--
-- This is write amplification against storage. It is NOT a data-exposure
-- bypass: the caller can only ever write rows owned by their own auth.uid(),
-- and reads still require the 122-bit share token. That is why the audit rated
-- it MEDIUM rather than HIGH.
--
-- A shared_nights row is only meaningful for a night the user actually went
-- out, so the window costs no legitimate functionality — the same reasoning
-- 0011/0012/0017 already record for the identical bound.
--
-- STYLE NOTE: share_night RAISES on invalid input (its siblings return false),
-- so this guard raises too, with errcode 22023 (invalid_parameter_value) to
-- match its existing range/shape rejections. Changing it to return null would
-- be a silent behaviour change for every existing caller.
--
-- Return type is unchanged, so `create or replace` is legal and PRESERVES the
-- existing ACL from 0016. The revoke/grant pair is re-issued anyway, matching
-- the house revoke-first convention and keeping the file re-runnable.
--
-- EXISTING ROWS ARE LEFT ALONE. This migration prevents new out-of-window rows;
-- it deliberately deletes nothing. Any cleanup of rows already outside the
-- window is a separate, destructive decision for an attended window.
--
-- Idempotent: create or replace + revoke-first grants. Safe to re-run.

create or replace function public.share_night(
  p_night date,
  p_bar_ids text[],
  p_loved_bar_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null then
    raise exception 'night required' using errcode = '22004';
  end if;
  -- C4 F1: tonight-ish only (client clock skew ±2 days), the same bound
  -- suggest_bar/rsvp_bar/cast_vibe_vote already enforce. Without it the
  -- (user_id, night) primary key turns every distinct date into a new row.
  if p_night < (current_date - 2) or p_night > (current_date + 2) then
    raise exception 'night must be within 2 days of today' using errcode = '22023';
  end if;
  -- The route must be real: 1..20 non-empty ids.
  if p_bar_ids is null
     or array_length(p_bar_ids, 1) is null
     or array_length(p_bar_ids, 1) > 20 then
    raise exception 'route must have 1-20 bars' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_bar_ids) as b(id)
     where b.id is null or length(trim(b.id)) = 0 or length(b.id) > 100
  ) then
    raise exception 'invalid bar id in route' using errcode = '22023';
  end if;
  -- The E4.2 client rule ("Loved must be ON the route") enforced at the
  -- boundary, because a direct RPC caller is not the client.
  if p_loved_bar_id is not null
     and array_position(p_bar_ids, p_loved_bar_id) is null then
    raise exception 'loved bar must be on the route' using errcode = '22023';
  end if;

  insert into public.shared_nights (user_id, night, bar_ids, loved_bar_id)
  values (v_uid, p_night, p_bar_ids, p_loved_bar_id)
  on conflict on constraint shared_nights_pkey
  do update set
    bar_ids      = excluded.bar_ids,
    loved_bar_id = excluded.loved_bar_id,
    shared_at    = now()
    -- share_token deliberately untouched: re-sharing must not kill
    -- links already sent.
  returning share_token into v_token;
  return v_token;
end;
$$;

revoke all on function public.share_night(date, text[], text) from public, anon, authenticated;
grant execute on function public.share_night(date, text[], text) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   re-apply the share_night body from 0016_shared_nights.sql, which is
--   identical to this one minus the p_night range guard.
------------------------------------------------------------------------------
