-- 0073 — the idempotent repeat report answers from the STORED ROW, not from the
-- content.
--
-- Round 10 (MEDIUM, claude) against 0069. `report_content` checks visibility
-- BEFORE it records, and `record_content_report` is idempotent: a second report
-- of the same subject writes nothing and returns the id already stored. So once
-- a caller has reported something, every later call re-evaluates
-- `feed_post_visible_to` / `can_view_feed_comment` on their behalf and answers
-- with the difference between a uuid and a 42501 — a LIVENESS ORACLE over
-- content they can no longer see, reporting deletion, an un-friending, a block,
-- or a destination going dark. The hide-free spellings are what leave it
-- reachable, and they are correct: they exist so the repeat returns the existing
-- id instead of raising. And the repeat is CAP-EXEMPT by design (the ceiling
-- applies to new subjects only, because the caller hides on a returned id and
-- only on a returned id), so nothing bounds the polling.
--
-- It matters most for an UNTAGGED audience member: `feed_post_visible_to` is the
-- one term they can move — mutuality and destination liveness are exactly the
-- facts they should not be able to watch — and they hold a post id precisely
-- because the post reached them.
--
-- THE FIX IS AN EARLY RETURN. A report this caller has already filed is a fact
-- about THEIR OWN row, and answering it needs no question about the content at
-- all. Placed after the input checks (a malformed ref cannot match a stored row,
-- and failing fast on it is unchanged) and before the visibility branch, so the
-- repeat path never reaches a predicate over content.
--
-- 0069 IS NOT EDITED. It is applied on staging and its checksum is in that
-- ledger; the correction is this file. The body below is 0069's, verbatim except
-- for the early return, so every other property it argues for — the delegation of
-- kinds this lane does not own, the restated bounds, the uuid shape check, the
-- hide-free spellings, the post-write re-assertion — is preserved as written.

create or replace function public.report_content(
  p_subject_kind text,
  p_subject_ref text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := lower(btrim(coalesce(p_subject_ref, '')));
  v_id uuid;
begin
  -- NOT THIS LANE'S KIND: hand it back to whichever migration last taught this
  -- function about it, with the arguments exactly as received. Every check that
  -- kind needs lives there — including its own idempotency, which is why the
  -- early return below sits INSIDE this lane's branch rather than above it.
  if p_subject_kind is distinct from 'feed_post'
     and p_subject_kind is distinct from 'comment' then
    if to_regprocedure('public.report_content_before_0069(text,text,text)') is null then
      raise exception 'report_content: % has no reportable subject in this schema yet',
        p_subject_kind
        using errcode = '22023';
    end if;
    return public.report_content_before_0069(p_subject_kind, p_subject_ref, p_reason);
  end if;

  if auth.uid() is null then
    raise exception 'report_content: not authenticated' using errcode = '28000';
  end if;

  -- BOUNDS, restated rather than borrowed: this branch never reaches the
  -- delegate, so it cannot inherit the delegate's checks.
  if char_length(v_ref) = 0 then
    raise exception 'report_content: subject_ref is required' using errcode = '22023';
  end if;
  if char_length(p_subject_ref) > 200 then
    raise exception 'report_content: subject_ref is too long' using errcode = '22001';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'report_content: reason is too long' using errcode = '22001';
  end if;

  -- A SUBJECT REF IS AN ID, NOT A STRING. Accepting arbitrary text would let one
  -- account mint an unlimited number of distinct "subjects" and walk straight
  -- past the one-report-per-subject index, which is the anti-flood measure.
  if v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'report_content: subject_ref is not an id' using errcode = '22023';
  end if;

  -- 0073. ALREADY REPORTED BY THIS CALLER: return the stored id and ask nothing
  -- about the content. This is the whole of the oracle fix. `record_content_report`
  -- would have returned this same id anyway — the repeat writes nothing — so the
  -- ONLY thing removed here is the visibility question that used to run first and
  -- answer, over and over and without a cap, whether the subject was still live.
  --
  -- The reporter's own row is not content: `content_reports` is keyed
  -- (reporter_id, subject_kind, subject_ref) and this reads exactly the caller's
  -- own, on the same normalised ref the insert stores.
  select cr.id
    into v_id
    from public.content_reports cr
   where cr.reporter_id = auth.uid()
     and cr.subject_kind = p_subject_kind
     and cr.subject_ref = v_ref;
  if v_id is not null then
    return v_id;
  end if;

  -- YOU MAY ONLY REPORT WHAT YOU CAN SEE, evaluated server-side and honouring
  -- blocks (they are inside `is_mutual_friend`). Reporting is an accusation
  -- against a named account attached to a durable, non-withdrawable operator
  -- record, so a caller who cannot reach the content has no business filing one.
  --
  -- REACHED ONLY BY A FIRST REPORT now, which is the only report that files
  -- anything. The hide-free spellings below stay hide-free: the caller has not
  -- reported this subject, so their own hide of it cannot be what refuses them,
  -- and the reasons the two branches give for omitting it are unchanged.
  if p_subject_kind = 'feed_post' then
    -- THE HIDE-FREE SPELLING, and it has to be: `can_view_feed_post` carries the
    -- caller's own reporter hide as of round 9, so asking it here would make the
    -- SECOND report of the same post raise instead of returning the existing id,
    -- and the caller — which hides only on a returned id — would fail to hide it.
    --
    -- Asked as the INTERNAL rule rather than the granted party wrapper: this
    -- function is SECURITY DEFINER, so it executes as the owner and needs no grant.
    if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then
      raise exception 'report_content: that post is not yours to report'
        using errcode = '42501';
    end if;
  else
    -- AND THE PARENT POST'S OWN HIDE COUNTS HERE. `can_view_feed_comment` leaves
    -- the reporter hide out on purpose, so that RE-reporting the same subject stays
    -- idempotent instead of raising on the second attempt. But the comments read
    -- policy vetoes on `feed_post_reported_by_caller` as well as the comment's own
    -- hide, so once this caller has reported the POST, every comment beneath it is
    -- already gone from their Feed — and accepting a fresh, durable accusation
    -- about content they can no longer see is exactly what "you may only report
    -- what you can see" forbids. The comment's own hide is deliberately NOT part of
    -- this term: that is the idempotent repeat, and it must keep returning the
    -- existing id.
    if not public.can_view_feed_comment(v_ref::uuid)
       or exists (
         select 1
           from public.feed_comments c
          where c.id = v_ref::uuid
            and public.feed_post_reported_by_caller(c.post_id)
       ) then
      raise exception 'report_content: that comment is not yours to report'
        using errcode = '42501';
    end if;
  end if;

  v_id := public.record_content_report(p_subject_kind, v_ref, p_reason);

  -- AND THE ENTITLEMENT IS RE-ASSERTED AFTER THE WRITE, because the write is not
  -- in the same statement as the check and cannot be: `record_content_report` is
  -- shared with the branches this file delegates to, and its insert cannot carry a
  -- predicate only this branch knows.
  --
  -- `record_content_report` takes a per-reporter advisory lock, so a caller can
  -- WAIT inside it — and a block, a deletion, or a report of the parent post
  -- committed during that wait would leave a durable, non-withdrawable accusation
  -- filed by somebody who, by the time it landed, could no longer see the subject.
  -- Re-checking on the latest snapshot and raising rolls the whole transaction
  -- back, insert included. It is not atomic, and the residual window between this
  -- check and COMMIT is inherent to READ COMMITTED; what it removes is the long
  -- window, the one with a lock wait in it.
  --
  -- STILL REACHED BY EVERY REPORT THAT WRITES ONE, which is what it is for. The
  -- early return above skips it only on the path that writes nothing, where there
  -- is no new accusation for a late change to have invalidated.
  if p_subject_kind = 'feed_post' then
    -- Hide-free for the same idempotency reason as the pre-write check, and
    -- internal for the same grant reason: the row this transaction just wrote is
    -- the caller's OWN report, and consulting the hide here would make every first
    -- report roll itself back.
    if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then
      raise exception 'report_content: that post stopped being yours to report'
        using errcode = '42501';
    end if;
  elsif not public.can_view_feed_comment(v_ref::uuid)
     or exists (
       select 1
         from public.feed_comments c
        where c.id = v_ref::uuid
          and public.feed_post_reported_by_caller(c.post_id)
     ) then
    raise exception 'report_content: that comment stopped being yours to report'
      using errcode = '42501';
  end if;

  return v_id;
end;
$$;

comment on function public.report_content(text, text, text) is
  'V8-R-FEED-010, extended by 0069 to feed_post and comment, corrected by 0073. Every other subject kind is delegated UNCHANGED to the implementation 0069 renamed, so 0066''s story branch and 0067''s group_message branch keep deciding their own kinds. A repeat report by the same caller returns the stored id WITHOUT asking any question about the content: the repeat writes nothing, and re-evaluating visibility for it was an uncapped liveness oracle. The caller hides the content ONLY on a returned id.';

-- The grants are 0069's, restated because `create or replace` leaves the existing
-- ones alone and this file has to be correct on a database where the function was
-- last created by something else.
revoke all on function public.report_content(text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text) to authenticated;
