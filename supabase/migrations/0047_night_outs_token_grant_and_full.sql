------------------------------------------------------------------------------
-- 0047_night_outs_token_grant_and_full.sql — V8-3 round-3 panel fixes
------------------------------------------------------------------------------
-- Fourth file for this feature, same rule as before: 0044, 0045 and 0046 are
-- applied and checksum-recorded, so they are immutable and corrections are
-- additive. On a database that has none of them, apply the whole run in ONE
-- transaction so no intermediate definition is ever observable.
--
-- 1. (Codex HIGH) 0045 gated `share_token` inside get_night_out so a declined
--    member could not re-read a rotated token — and that gate was decorative,
--    because `authenticated` holds a TABLE-level SELECT grant on
--    public.night_outs and the night_outs_select_member policy admits a member
--    row of ANY status. The declined recipient simply reads the column
--    directly and bearer-link revocation is defeated.
--
--    Fixing this at the RPC layer alone was the mistake. The column is the
--    secret, so the grant is where it has to be withheld: revoke the table
--    grant and re-grant every column EXCEPT share_token. RLS is unchanged --
--    pending members still see the plan they were invited to. The
--    SECURITY DEFINER RPCs are unaffected because they execute as the owner,
--    which is what lets get_night_out keep handing the token to accepted
--    members only.
--
-- 2. (Claude MEDIUM) "Full" was indistinguishable from "dead link" at the
--    client: join_night_out_by_token returns null for an unresolvable token
--    AND for a full plan, so a user on a full plan was told the link may have
--    expired, and a declined member rejoining was told to try again — advice
--    that can never succeed. This adds the one read the UI needs to tell those
--    apart. It deliberately does not change any existing return type: the
--    failure path asks a question, the success paths are untouched.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. share_token is not readable through the table, only through the RPC
------------------------------------------------------------------------------
revoke select on table public.night_outs from authenticated;

-- Every column except share_token. Listing them explicitly (rather than
-- granting and then revoking one column) means a future ALTER TABLE ADD COLUMN
-- is NOT silently exposed: a new column stays unreadable until someone adds it
-- here on purpose.
grant select (
  id,
  owner_id,
  night,
  title,
  status,
  decided_bar_id,
  created_at,
  cancelled_at
) on table public.night_outs to authenticated;

------------------------------------------------------------------------------
-- 2. One read so the UI can say "full" instead of "expired"
------------------------------------------------------------------------------
-- Callable by any authenticated holder of the token, which is exactly who can
-- already attempt the join it explains. It discloses one boolean about a plan
-- the caller already has the bearer link for, and nothing else -- no identity,
-- no membership, no count.
create or replace function public.night_out_is_full_by_token(p_token uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_cap constant integer := 20;
  v_id uuid;
  v_count integer;
begin
  if auth.uid() is null or p_token is null then
    return false;
  end if;
  select n.id into v_id
    from public.night_outs n
   where n.share_token = p_token
     and n.status in ('draft', 'open', 'decided');
  if v_id is null then
    return false;  -- an unresolvable token is not "full", it is unavailable
  end if;
  -- Same counted set the cap uses in 0046: declined rows occupy no seat.
  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = v_id
     and m.invite_status <> 'declined';
  return v_count >= member_cap;
end;
$$;

-- Revoke from the named roles too, not just PUBLIC: Supabase's default
-- privileges grant EXECUTE on new public functions to anon/authenticated/
-- service_role explicitly, and revoking PUBLIC does not touch an explicit role
-- grant. This is 0044's revoke-first idiom, and the anon-denial completeness
-- test caught the omission on the round it was introduced.
revoke all on function public.night_out_is_full_by_token(uuid) from public, anon, authenticated;
grant execute on function public.night_out_is_full_by_token(uuid) to authenticated;
