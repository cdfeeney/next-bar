-- 0077 — the orphan sweep must make forward progress, and a deleted account's
-- photos must not be immortal.
--
-- WHAT WAS WRONG (advisor finding, confirmed against the LIVE staging body on
-- 2026-09-04: `limit v_limit` at offset 2431, `r.prefix::uuid` at 2479, the
-- profiles-existence check at 2622 — both skips AFTER the limit).
--
-- `claim_orphan_paths` picks the 25 OLDEST candidate objects and only then, in
-- the loop body, skips two populations it can never claim:
--
--   * a prefix that is not a uuid at all (`r.prefix::uuid` raises, `continue`)
--   * a prefix whose account no longer exists (`continue`)
--
-- Because the skip happens after `LIMIT`, those objects are re-selected on every
-- single tick. Twenty-five of them fill the batch forever and no later eligible
-- orphan is ever reached. The sweep reports success, does nothing, and the
-- bucket grows.
--
-- THIS IS NOT A HYPOTHETICAL POPULATION, and the two halves of the finding are
-- the same bug. `media_objects.owner_id` was `not null references profiles(id)
-- ON DELETE CASCADE`, so deleting an account DESTROYED its registry rows — which
-- turned every one of that account's photos into exactly the unregistered orphan
-- this function is meant to collect, and then skipped it for having no profile.
-- Those objects are also the OLDEST, so they sort straight to the front of the
-- batch. A single deleted account with 25 photos wedges the sweep permanently.
--
-- WHAT THIS MIGRATION DOES
--
--   1. `owner_id` becomes nullable and the FK becomes ON DELETE SET NULL, so a
--      deleted account's media KEEPS its registry row with a null owner instead
--      of losing it. That alone makes those objects reclaimable through the
--      ordinary `claim_media_for_removal` path, which already widens to all
--      media for the service role (`v_caller is null or m.owner_id = v_caller`)
--      — locks, claim stamps and live-reference recounts all unchanged.
--   2. `claim_orphan_paths` moves the prefix-validity test INTO the candidate
--      query, before the LIMIT, so unusable prefixes can no longer occupy the
--      batch.
--   3. The same function stops skipping ownerless prefixes and adopts them with
--      a null owner, which is what collects the objects orphaned by the old
--      CASCADE before this migration ran.
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE. Every protection in the loop stays
-- exactly as it was: the try-lock (never a blocking acquire, so the loop cannot
-- deadlock against a publisher), the re-verification of live stories UNDER the
-- lock, `for update skip locked`, `media_live_reference_count(...) = 0`, and
-- `take_media_claim`, which refuses a claim another tick already holds. The
-- eligibility rules are untouched: 24 hours old, no live story, no unclaimed or
-- in-flight registry row.
--
-- RLS IS SAFE UNDER A NULL OWNER. Every policy and verb compares
-- `owner_id = auth.uid()`, which is NULL — and therefore false — for an
-- ownerless row. No user gains read or delete access to a deleted account's
-- media; only the service-role sweep can reach it, which is the intent.

begin;

-------------------------------------------------------------------------------
-- 1. A deleted account's media keeps its row, so the sweep can still see it.
-------------------------------------------------------------------------------

alter table public.media_objects
  alter column owner_id drop not null;

alter table public.media_objects
  drop constraint if exists media_objects_owner_id_fkey;

alter table public.media_objects
  add constraint media_objects_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

comment on column public.media_objects.owner_id is
  'The account that owns these bytes, or NULL once that account is deleted. NULL rather than a deleted row (0077): the CASCADE that used to remove the row turned a deleted account''s photos into unregistered orphans that claim_orphan_paths then skipped forever, so the bytes outlived the account. A null owner matches no RLS policy, so only the service-role sweep can reach it.';

-------------------------------------------------------------------------------
-- 2. The sweep makes forward progress.
-------------------------------------------------------------------------------

create or replace function public.claim_orphan_paths(p_limit integer default 25)
returns table (media_id uuid, bucket_id text, storage_path text, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  r record;
  v_owner uuid;
  v_id uuid;
  v_claimed_at timestamptz;
begin
  for r in
    select o.name as name, (storage.foldername(o.name))[1] as prefix
      from storage.objects o
     where o.bucket_id = 'story-media'
       and o.created_at < now() - interval '24 hours'
       -- FORWARD PROGRESS (0077). A prefix that is not a uuid can never be
       -- claimed, and testing it in the loop body meant it was re-selected on
       -- every tick and consumed a slot forever. The regex is applied HERE, so
       -- the LIMIT below is spent on rows that can actually be claimed.
       --
       -- Matched rather than cast, because a cast in a WHERE clause can be
       -- evaluated before the guard that makes it safe; a regex cannot raise.
       and (storage.foldername(o.name))[1] ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and (
         v_caller is null
         or (storage.foldername(o.name))[1] = v_caller::text
       )
       and not exists (
         select 1
           from public.media_objects m
          where m.bucket_id = 'story-media'
            and m.storage_path = o.name
            and (
              -- An UNCLAIMED row: someone else's live object, not ours to take.
              m.bytes_removed_at is null
              -- ...OR a claim that is still plausibly IN FLIGHT. The claiming
              -- transaction COMMITS — releasing the advisory lock — and only
              -- then issues the Storage delete, so a stamped-but-live row must
              -- stay out of a second tick's candidate list.
              or public.media_claim_is_live(m.bytes_removed_at)
            )
       )
       and not exists (
         select 1
           from public.stories s
          where (s.media_path = o.name or s.inset_path = o.name)
            and s.deleted_at is null
            and s.expires_at > now()
       )
     order by o.created_at
     limit v_limit
  loop
    -- Safe by construction: the regex above admits only uuid-shaped prefixes.
    -- The block stays as a belt-and-braces guard rather than an assumption.
    begin
      v_owner := r.prefix::uuid;
    exception when others then
      continue;
    end;

    -- OWNERLESS IS ELIGIBLE, NOT SKIPPED (0077). This used to `continue` when no
    -- profile matched the prefix, which is why a deleted account's photos were
    -- never collected — and, being the oldest objects in the bucket, why they
    -- filled the batch on every tick. They are adopted with a null owner
    -- instead. Nothing can publish against them: `publish_story` requires the
    -- path's first segment to equal `auth.uid()`, and a deleted account has no
    -- session, so the population that cannot be raced is exactly this one.
    if not exists (select 1 from public.profiles p where p.id = v_owner) then
      v_owner := null;
    end if;

    -- ADOPT. From here `publish_story` has a row to lock and a stamp to see.
    -- TRY, NEVER WAIT. Locks taken in earlier iterations are still held (advisory
    -- xact locks live to commit), so a blocking acquire here could wait on a
    -- publisher that is itself waiting on a path this loop already holds.
    if not pg_try_advisory_xact_lock(public.media_path_lock_key('story-media', r.name)) then
      continue;  -- a publisher owns this path right now
    end if;

    -- RE-VERIFIED UNDER THE LOCK. The candidate list was computed before the
    -- lock existed, so a story could have been published against these bytes in
    -- between. Without this the lock would only narrow the window, not close it.
    if exists (
      select 1
        from public.stories s
       where (s.media_path = r.name or s.inset_path = r.name)
         and s.deleted_at is null
         and s.expires_at > now()
    ) then
      continue;  -- published while we were getting here; the bytes stay
    end if;

    -- BY CONSTRAINT NAME, not by inferring the columns: this function's OUT
    -- parameters are named `media_id`, `bucket_id` and `storage_path`, so a
    -- column-inference list resolves them as PL/pgSQL variables and every call
    -- fails with `column reference "bucket_id" is ambiguous`.
    insert into public.media_objects (owner_id, bucket_id, storage_path)
    values (v_owner, 'story-media', r.name)
    on conflict on constraint media_objects_path_unique do nothing;

    select m.id into v_id
      from public.media_objects m
     where m.bucket_id = 'story-media'
       and m.storage_path = r.name
     for update skip locked;

    if v_id is null then
      continue;  -- another transaction is already working on this object
    end if;

    -- RECOUNTED UNDER THE LOCK, exactly as claim_media_for_removal does, and the
    -- claim re-checked at the moment of stamping: `take_media_claim` refreshes a
    -- stale claim and DECLINES a live one, so this loop cannot hand out a second
    -- live claim on bytes another worker is already deleting.
    if public.media_live_reference_count(v_id) = 0 then
      v_claimed_at := public.take_media_claim(v_id);
      if v_claimed_at is not null then
        media_id := v_id;
        bucket_id := 'story-media';
        storage_path := r.name;
        claimed_at := v_claimed_at;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.claim_orphan_paths(integer) is
  'V8-R-CMP-012 / V8-R-STO-016, revised by 0077. Adopts and CLAIMS storage objects no live story and no unclaimed registry row accounts for. 0077 moved the prefix-validity test ahead of the LIMIT and made ownerless prefixes eligible rather than skipped: both used to be filtered inside the loop, so unclaimable objects were re-selected every tick, occupied the whole batch and starved every later orphan.';

revoke all on function public.claim_orphan_paths(integer) from public, anon;
grant execute on function public.claim_orphan_paths(integer) to authenticated;

commit;
