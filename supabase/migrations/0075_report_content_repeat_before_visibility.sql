-- 0075 — the idempotent repeat report answers from the STORED ROW, not from the
-- content.
--
-- Round 10 of WP5 (MEDIUM, claude) against 0069. `report_content` checks
-- visibility BEFORE it records, and `record_content_report` is idempotent: a
-- second report of the same subject writes nothing and returns the id already
-- stored. So once a caller has reported something, every later call re-evaluates
-- `feed_post_visible_to` / `can_view_feed_comment` on their behalf and answers
-- with the difference between a uuid and a 42501 — a LIVENESS ORACLE over
-- content they can no longer see, reporting deletion, an un-friending, a block,
-- or a destination going dark. The hide-free spellings are what leave it
-- reachable, and they are correct: they exist so the repeat returns the existing
-- id instead of raising. The repeat is CAP-EXEMPT by design (the ceiling applies
-- to new subjects only, because the caller hides on a returned id and only on a
-- returned id), so nothing bounds the polling.
--
-- It matters most for an UNTAGGED audience member: `feed_post_visible_to` is the
-- one term they can move — mutuality and destination liveness are exactly the
-- facts they should not be able to watch — and they hold a post id precisely
-- because the post reached them.
--
-- ============================================================================
-- WHY THIS FILE IS 0075 AND NOT 0073 (round-1 HIGH, codex — reproduced).
--
-- The first attempt was numbered 0073 on the goal body's statement that the
-- staging ledger head was 0071. IT IS 0074. `npm run check:migrations` refused
-- the file outright: "numbered 0073, at or below the serving ledger head 0074,
-- and its filename is not in public.schema_migrations. apply-migration-set.ts
-- will refuse it, so it can never reach the database by the approved path." A
-- migration the approved runner can never apply is not a fix; the oracle would
-- have stayed live while every local gate reported green. THE LEDGER IS THE
-- TRUTH, NOT THE FILESYSTEM — scanning sibling worktrees for the highest
-- numbered file said 0071 and was wrong, because 0072-0074 were applied from
-- branches this one has never held.
--
-- WHY IT DELEGATES INSTEAD OF RESTATING THE BODY (round-1 MEDIUM, claude).
--
-- The first attempt copied 0069's whole `report_content` body and inserted the
-- early return into it. That silently un-implements any migration between 0069
-- and this file that widened `report_content` the way this repo does it —
-- rename the old one aside, write a wrapper that handles the new kind and
-- delegates the rest. `create or replace` over such a wrapper leaves a body
-- whose fallback is `report_content_before_0069`, so the newer kind routes to an
-- implementation that has never heard of it and raises 22023 while the CHECK
-- constraint happily admits it. That is the exact failure 0069's own header
-- names as its reason for delegating rather than restating.
--
-- And this is NOT hypothetical here. This branch carries migrations up to 0069
-- and the serving ledger head is 0074: FIVE applied migrations whose text this
-- branch does not contain sit between them, any of which may have redefined
-- `report_content`. Renumbering to clear the head made the restatement strictly
-- more dangerous, not less — it widened the window. So the correction is the
-- same discipline 0069 used: this file adds ONE step in front of whatever
-- `report_content` currently is, and delegates everything else to it unchanged.
-- Nothing here needs to know what 0070-0074 did.
-- ============================================================================

-- Rename the CURRENT implementation aside, whatever it is. Guarded, so a re-run
-- cannot rename the wrapper on top of itself and build a delegation cycle.
do $repeat_rename$
begin
  if to_regprocedure('public.report_content_before_0075(text,text,text)') is null
     and to_regprocedure('public.report_content(text,text,text)') is not null then
    alter function public.report_content(text, text, text)
      rename to report_content_before_0075;
  end if;
end
$repeat_rename$;

-- The renamed function keeps the grant it was created with. Withdraw it: it is
-- now an internal step of the function below, and leaving it callable would
-- leave a reporting entry point that skips the repeat check this file adds. The
-- new `report_content` is SECURITY DEFINER, so it still reaches this as owner.
do $repeat_revoke$
begin
  if to_regprocedure('public.report_content_before_0075(text,text,text)') is not null then
    execute 'revoke all on function public.report_content_before_0075(text, text, text)'
         || ' from public, anon, authenticated';
  end if;
end
$repeat_revoke$;

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
  if to_regprocedure('public.report_content_before_0075(text,text,text)') is null then
    -- Reached only on a database where `report_content` did not exist when this
    -- file applied. Say so, rather than failing as a missing function inside a
    -- branch below.
    raise exception 'report_content: 0075 has no predecessor implementation to delegate to'
      using errcode = '42883';
  end if;

  -- ALREADY REPORTED BY THIS CALLER, for a kind this lane owns: return the
  -- stored id and ask NOTHING about the content. This is the whole of the fix.
  --
  -- The delegate would return this same id anyway — a repeat writes nothing —
  -- so the only thing removed is the visibility question that used to run first
  -- and answer, over and over and without a cap, whether the subject was still
  -- live. A report the caller has already filed is a fact about THEIR OWN row.
  --
  -- SCOPED TO 'feed_post' AND 'comment' deliberately. Every other kind carries
  -- its own idempotency inside its own lane's implementation, and answering for
  -- them out of a table whose semantics for those kinds this file has never seen
  -- is precisely the overreach the delegation exists to prevent. A NULL kind
  -- makes this predicate NULL, which is falsy, so it delegates.
  --
  -- THE BOUNDS ARE PART OF THE CONDITION, and leaving them out was a real hole
  -- (round 2, MEDIUM, codex). "A stored row proves the ref was accepted when it
  -- was written" is true of the NORMALISED ref and says nothing about the
  -- argument in hand: `btrim` strips whitespace, so 250 spaces followed by a
  -- reported uuid is a 286-character argument that normalises onto the stored
  -- row. The early return then answered it and the delegate's `> 200` check —
  -- the one that makes this a bounded RPC — never ran. Same for an over-long
  -- reason on a repeat.
  --
  -- Stated as a CONDITION rather than a raise of its own: an argument outside
  -- the bounds simply does not take this path, and the delegate rejects it with
  -- the message and SQLSTATE it always has. Restating the raise here would be a
  -- second copy of a rule this file is trying not to own.
  --
  -- What genuinely does NOT need repeating: the uuid SHAPE check and the
  -- audience checks. A ref of the wrong shape matches no stored row, and an
  -- unauthenticated caller matches none either because `reporter_id` is never
  -- null — both fall through and the delegate answers as before.
  if p_subject_kind in ('feed_post', 'comment')
     and auth.uid() is not null
     and char_length(p_subject_ref) <= 200
     and (p_reason is null or char_length(p_reason) <= 1000) then
    select cr.id
      into v_id
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.subject_kind = p_subject_kind
       and cr.subject_ref = v_ref;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- EVERYTHING ELSE IS THE PREVIOUS IMPLEMENTATION, UNCHANGED, with the
  -- arguments exactly as received: its bounds, its uuid shape check, its
  -- visibility branches, the daily cap, the idempotent insert and the post-write
  -- re-assertion. A first report is not altered by this file in any way, and
  -- neither is any kind added between 0069 and here.
  return public.report_content_before_0075(p_subject_kind, p_subject_ref, p_reason);
end;
$$;

comment on function public.report_content(text, text, text) is
  'V8-R-FEED-010. Corrected by 0075: a repeat report by the same caller, for feed_post or comment, returns the id already stored WITHOUT asking any question about the content. The repeat writes nothing and is cap-exempt, so re-evaluating visibility for it was an unbounded liveness oracle over content the caller has hidden. Everything else — every other kind, and every first report — is DELEGATED unchanged to the implementation this file renamed, so no widening applied between 0069 and here is un-implemented. The caller hides the content ONLY on a returned id.';

revoke all on function public.report_content(text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text) to authenticated;
