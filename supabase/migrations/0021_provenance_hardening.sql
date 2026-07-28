-- Next Bar — 0021 provenance hardening (review findings on 0020)
--
-- Two defects found in independent review of 0020, both cheap to close:
--
--  1. pending_change_count(p_user) is SECURITY DEFINER, executable by any
--     authenticated user, and took an ARBITRARY user id — so any signed-in
--     user could ask how many pending corrections any other user had. Low
--     severity (a count keyed by a uuid), but a definer function that reads
--     another user's rows on request is exactly the shape that becomes a
--     real leak the moment someone adds a column to it. The caller is
--     always auth.uid() anyway, so the parameter was pure attack surface.
--
--  2. The "don't trust Google hours" rule lived in ONE place in the
--     application (hasTrustworthyHours). Any future direct write could set
--     hours_source='google' with hours_confidence='verified' and silently
--     pass the gate. Encode the invariant in the schema instead, where it
--     cannot be forgotten.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. pending_change_count: derive the user internally, no parameter
------------------------------------------------------------------------------

drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
drop function if exists public.pending_change_count(uuid);

create or replace function public.pending_change_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.bar_change_queue q
   where q.submitted_by = auth.uid()
     and q.status = 'pending';
$$;

revoke all on function public.pending_change_count() from public, anon, authenticated;
grant execute on function public.pending_change_count() to authenticated;

create policy bar_change_queue_insert_own on public.bar_change_queue
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    -- Soft cap. Deliberately not a hard guarantee: two concurrent inserts
    -- can both observe 19 and both land. That is acceptable for a
    -- moderation queue — the cap exists to stop one account flooding it,
    -- not to enforce an exact ceiling.
    and public.pending_change_count() < 20
  );

------------------------------------------------------------------------------
-- 2. Google hours can never be marked verified
------------------------------------------------------------------------------
-- Defense in depth for the whole point of 0020: we may DISPLAY Google
-- hours live, we may not persist them and treat them as authoritative.
-- 'reported' is likewise wrong for Google — nobody reported it to us.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bars_google_hours_never_trusted'
  ) then
    alter table public.bars add constraint bars_google_hours_never_trusted
      check (
        hours_source is distinct from 'google'
        or hours_confidence is not distinct from 'unverified'
      );
  end if;
end $$;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   alter table public.bars drop constraint if exists bars_google_hours_never_trusted;
--   drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
--   drop function if exists public.pending_change_count();
--   -- then re-create the 0020 parameterized function + policy if needed.
------------------------------------------------------------------------------
