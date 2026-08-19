------------------------------------------------------------------------------
-- 0052_night_outs_my_invites.sql — "what am I invited to?"
------------------------------------------------------------------------------
-- Ninth file. 0044-0051 are applied and checksum-recorded, so they are
-- immutable and corrections are additive.
--
-- Every read RPC this feature shipped takes a plan id or a bearer token:
-- get_night_out, get_night_out_members, get_night_out_board, night_out_role,
-- preview_night_out, resolve_night_out_by_token. **Not one of them answers
-- "what am I invited to?"** There is no zero-argument, auth-scoped query, so an
-- account-targeted invitation created a `pending` row the invitee had no way to
-- discover — no list, no inbox, and no notification. Wiring the invite call
-- without this would have produced write-only invitations.
--
-- This is the query behind Social → Plans (design artifact
-- next-bar-night-out-invite-recipient-v1, Part B, approved 2026-08-16).
--
-- Deliberate decisions, stated here rather than left to be inferred:
--
--   * share_token is returned ONLY to an ACCEPTED member. That is the rule 0047
--     established at the table grant, and it holds here: "View plan" navigates
--     by token, and a pending invitee has not accepted, so they do not get one.
--   * CANCELLED plans are excluded. The approved design draws no cancelled card
--     state, and inventing one would contradict "as drawn". Recorded as a known
--     gap against the deferred operational-states work rather than papered over.
--   * plan_updated is derived from a `plan_changed` event newer than the
--     caller's responded_at — that event kind already exists in 0044. A member
--     who has not responded yet cannot have "missed" an update, so it is false
--     for them.
--   * Other members are exposed only as an accepted COUNT. No identities, no
--     ratings, no scores leave this function beyond the plan owner, who is
--     named on the card by design ("Dev invited you").
------------------------------------------------------------------------------

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
    n.night < current_date
  from public.night_out_members me
  join public.night_outs n on n.id = me.night_out_id
  join public.profiles p on p.id = n.owner_id
  where me.user_id = auth.uid()
    and n.status <> 'cancelled'
  order by
    -- Pending first: the card that needs an answer sorts above the ones that
    -- do not. Then soonest night, then newest plan for a stable tiebreak.
    case when me.invite_status = 'pending' then 0 else 1 end,
    n.night desc,
    n.id desc
$$;

revoke all on function public.get_my_night_outs() from public, anon, authenticated;
grant execute on function public.get_my_night_outs() to authenticated;
