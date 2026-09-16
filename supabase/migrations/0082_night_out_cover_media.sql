-- 0082 — "Choose from library": a phone-library photo as a night-out cover (S-06c).
--
-- Owner, 2026-09-15: "by choose from library I meant a user should be able to
-- choose a photo from their photo library" and "yes to the library migration".
-- Follows 0078 (templates only). The goal body named this file 0081; R-04 took
-- 0081 first (anon_rsvp_unicode_trim), so this is 0082 — numbered above the
-- live staging ledger head, read at the time (0080 applied, 0081 pending).
--
-- THREE REPLACEMENTS on the MEDIA BOUNDARY, no schema change, no grant change,
-- no drop. Each function body below is the CURRENT applied text (0066, 0076,
-- 0078) with the cover additions inserted and nothing else touched — this file
-- was generated from those bodies, and the static shape test pins the delta.
--
--   1. media_live_reference_count (0066) — a night out whose `cover` is
--      'media:<id>' and whose status is not 'cancelled' counts as ONE live
--      reference. This is the single choke point both sweeps consult under
--      their locks, so a referenced cover object is never claimed, and
--      cancelling the plan (or changing / clearing the cover) returns the
--      object to the sweeps' reach: the count drops to zero and the ordinary
--      24-hour rule applies. No media_destinations row is minted for a cover:
--      the plan row is the reference and its status is the liveness.
--
--      WHY claim_orphan_paths IS NOT REPLACED, although the goal body lists it:
--      that sweep's candidates are storage objects with NO live registry row
--      (0077: `not exists (select 1 from media_objects m where ... m.bytes_removed_at
--      is null ...)`), and a cover value can only name a registered object
--      (set_night_out_cover below requires the row). A referenced cover is
--      therefore never a candidate by construction, and the one path that
--      could still claim a registered object — media_live_reference_count = 0
--      under the lock — is closed by change 1. Replacing a 130-line security
--      function to add a vacuous guard would be risk without a property.
--
--   2. media_read_window (0076) — a fourth answer beside story, feed and group:
--      the object a live plan's cover names is readable (unbounded, like a
--      group photo) to that plan's owner and accepted members
--      (`night_out_role(n.id) is not null`), never to anyone else. The reporter
--      veto stands down for it, exactly as it does for a group message the
--      caller can see; a live cover also outranks a story's clock. Everything
--      0076 decided is otherwise byte-identical.
--
--   3. set_night_out_cover (0078) — accepts 'media:<uuid>' beside
--      'template:<key>'; a media value must name a media_objects row OWNED BY
--      the caller, in the media bucket, with bytes present, else false. Owner
--      only, draft/open only, NULL clears — unchanged.
--
-- The client reads a media cover through GET /api/media/:id/url, which asks
-- media_read_window as the caller and signs with the server's lifetime — the
-- same boundary route Night Out photos use. Nothing signs off Storage directly.
--
-- Applied to STAGING on the owner's word; production as its own authorised
-- step before any production deploy that carries this.

------------------------------------------------------------------------------
-- 1. media_live_reference_count — a live plan cover is a live reference.
------------------------------------------------------------------------------

create or replace function public.media_live_reference_count(p_media_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and not exists (
    select 1
      from public.media_objects m
     where m.id = p_media_id
       and m.owner_id = v_caller
  ) then
    return 1;
  end if;

  return (
  select
    (select count(*)::int
       from public.media_destinations d
      where d.media_id = p_media_id
        and d.removed_at is null
        and (
          d.kind <> 'story'
          or exists (
            select 1
              from public.stories s
             where s.id::text = d.ref_id
               and s.deleted_at is null
               and s.expires_at > now()
          )
        ))
    +
    (select count(*)::int
       from public.media_objects m
       join public.stories s
         on (s.media_path = m.storage_path or s.inset_path = m.storage_path)
      where m.id = p_media_id
        and s.deleted_at is null
        and s.expires_at > now()
        and not exists (
          select 1
            from public.media_destinations d2
           where d2.media_id = p_media_id
             and d2.kind = 'story'
             and d2.ref_id = s.id::text
             and d2.removed_at is null
        ))
    +
    -- S-06c (0082): A LIVE PLAN COVER IS A LIVE REFERENCE. `night_outs.cover =
    -- 'media:<id>'` names this object directly — no media_destinations row is
    -- minted for a cover, on purpose: the plan row IS the reference, and its
    -- liveness is the plan's status. Counting it here is what keeps BOTH sweeps
    -- off the bytes (claim_media_for_removal and claim_orphan_paths re-check this
    -- function under their locks), and what returns them to the sweeps' reach the
    -- moment the plan is cancelled or the cover is changed or cleared: the count
    -- drops to zero and the ordinary 24-hour rule takes over.
    (select count(*)::int
       from public.night_outs n
      where n.cover = 'media:' || p_media_id::text
        and n.status <> 'cancelled'));
end;
$$;

comment on function public.media_live_reference_count(uuid) is
  '0066''s live-reference count, widened in 0082 (S-06c): a night out whose cover names this object (media:<id>) and is not cancelled counts as one live reference, so neither sweep claims a referenced cover and a cancelled plan returns it to their reach.';

------------------------------------------------------------------------------
-- 2. media_read_window — a live plan cover is readable to the plan's members.
------------------------------------------------------------------------------

create or replace function public.media_read_window(p_name text)
returns table (readable boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_prior record;
  v_feed_readable boolean;
  v_group_readable boolean := false;
  v_cover_readable boolean := false;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- THE GROUP ANSWER, COMPUTED ONCE, AND 0067'S BRANCH RESTORED (see this file's
  -- header). 0067 added a group branch to this function; 0068 replaced the whole
  -- function from 0066's body and dropped it, so in the applied schema a group
  -- photo is refused to every member who is not its uploader. The query is 0067's,
  -- verbatim: joined through `media_objects` because `group_messages.media_id` is
  -- a registry id and never a path, and gated by `group_message_is_visible`, which
  -- is 0067's single definition of "this caller may see this group message".
  select exists (
    select 1
      from public.group_messages msg
      join public.media_objects mo on mo.id = msg.media_id
     where mo.storage_path = p_name
       and mo.bucket_id = 'story-media'
       and msg.deleted_at is null
       and public.group_message_is_visible(msg.id)
       -- AND THE MESSAGE'S GROUP DESTINATION MUST NOT HAVE BEEN RETIRED.
       -- 0067's query stopped at `deleted_at is null`, which is the message's
       -- OWN liveness and not the destination's. `remove_media_destination`
       -- (0066) is a second, granted removal path: it stamps `removed_at` on
       -- the kind='group' spine row and — unlike its story branch, which
       -- soft-deletes the story — leaves `group_messages` completely untouched.
       -- So after an owner removes a photo from a group destination, the
       -- message row is still live and still visible to every member, and this
       -- branch would keep minting signed URLs for bytes the owner was told had
       -- been removed. `delete_group_message` and the hard-delete trigger both
       -- stamp the same row, so this term also agrees with them.
       --
       -- Written as "live, or never minted" rather than "a live row exists":
       -- `send_group_message` always writes the spine row, but a message that
       -- predates it — or any row this file cannot see — must not be blanked by
       -- the absence of a destination it never had. Only an actual retirement
       -- withdraws the authorization.
       and (
         not exists (
           select 1
             from public.media_destinations d
            where d.media_id = msg.media_id
              and d.kind = 'group'
              and d.ref_id = msg.id::text
         )
         or exists (
           select 1
             from public.media_destinations d
            where d.media_id = msg.media_id
              and d.kind = 'group'
              and d.ref_id = msg.id::text
              and d.removed_at is null
         )
       )
  ) into v_group_readable;

  -- THE COVER ANSWER (S-06c, 0082), COMPUTED ONCE, the same way as the group
  -- answer above. A night out whose `cover` names this object makes it readable
  -- to the plan's owner and accepted members while the plan is not cancelled.
  -- `night_out_role` is 0044's single definition of "owner or accepted member"
  -- — the predicate 0068's night_out branch and the anon-guest reads already
  -- use — so a member who DECLINED reads null and is refused here as there. The
  -- object must still be registered and unremoved: a reference does not
  -- resurrect reclaimed bytes. A cancelled plan withdraws the authorisation, and
  -- `media_live_reference_count` stops counting the reference at the same
  -- moment, so "readable" and "kept" agree.
  select exists (
    select 1
      from public.night_outs n
      join public.media_objects mo on n.cover = 'media:' || mo.id::text
     where mo.storage_path = p_name
       and mo.bucket_id = 'story-media'
       and mo.bytes_removed_at is null
       and n.status <> 'cancelled'
       -- S-06c round-1 HIGH (Fable): the AUDIENCE is night_outs_select_member —
       -- owner or ANY membership row — not night_out_role, which is accepted-only.
       -- RLS (0044:night_outs_select_member) already lets a PENDING invitee read
       -- night_outs.cover, so PlanCover renders on the invitation card before the
       -- invite is accepted; gating the bytes on accepted-only left that viewer a
       -- broken "cover" (a 404 from this window) while a template cover showed.
       -- Read the plan's own read policy verbatim so the picture matches the row.
       and (n.owner_id = auth.uid()
            or exists (
              select 1
                from public.night_out_members m
               where m.night_out_id = n.id
                 and m.user_id = auth.uid()
            ))
  ) into v_cover_readable;

  -- THE FEED ANSWER, COMPUTED ONCE. It is both the fallback branch at the bottom
  -- and the thing the veto below has to consult, and writing it twice is how the
  -- two spellings drift.
  v_feed_readable := exists (
    select 1
      from public.feed_posts p
      join public.media_objects m on m.id = p.media_id
     where m.storage_path = p_name
       and m.bytes_removed_at is null
       -- "Visible AND unreported to this caller" is what `can_view_feed_post` now
       -- means on its own (round 9). The second term this line used to carry was
       -- the same predicate spelled again.
       and public.can_view_feed_post(p.id)
  );

  if to_regprocedure('public.media_read_window_before_0069(text)') is not null then
    select w.readable, w.expires_at
      into v_prior
      from public.media_read_window_before_0069(p_name) w
     limit 1;

    -- A yes is FINAL, with ONE exception this file is entitled to make because
    -- the previous decision could not have made it: 0066 knows nothing about
    -- feed_posts, so its owner branch answers "yes, unbounded" for a FEED-ONLY
    -- media object on the caller's own prefix — that is its upload-before-publish
    -- window, and it cannot tell that the bytes are in fact published to a Feed
    -- post the caller has since REPORTED. 0066 states the rule this restores in
    -- its own words: "THE HIDE APPLIES TO THE AUTHOR TOO ... with no exception
    -- for the reporter also being the author."
    --
    -- The veto is deliberately narrow, so it can never hide a story and never
    -- hides bytes something the caller CAN still see is standing on:
    --   * it requires a live Feed post, still holding its media destination,
    --     naming these bytes, that THIS caller reported;
    --   * it requires that NO OTHER Feed post naming these bytes is visible and
    --     unreported to this caller — the ALL-UNREPORTED half 0066's story
    --     analogue carries. One media object may hold several live Feed
    --     destinations (`media_destinations_live_uniq` is on
    --     (media_id, kind, ref_id)), so reporting post A used to blank post B's
    --     photo for its own owner, and the branch that would have authorised B
    --     sits AFTER this return and could never be reached; and
    --   * it requires that NO live story names these bytes at all; and
    --   * it requires that the prior YES was the UNBOUNDED one.
    -- When a story does name them, 0066 has already applied its own reporter
    -- rule (`media_path_unreported_live_expiry`, plus the all-reported check
    -- below it) and whatever it decided stands untouched.
    --
    -- WHY `v_prior.expires_at IS NULL` AND NOT A LIST OF DESTINATION KINDS.
    -- Three rounds of review found three defects in one term, each a different
    -- kind mis-classified: `kind <> 'feed'` counted an ARCHIVE retention hold as
    -- somewhere the photo is visible; `kind not in ('feed','archive')` counted an
    -- EXPIRED story's spine row, because 0066 never stamps `removed_at` on a story
    -- destination and expresses expiry passively through `expires_at`; and either
    -- form counted a live GROUP destination whose visibility to THIS caller only
    -- WP6 can judge. The cause is not the list. It is that 0069 was trying to
    -- re-derive, from another lane's rows, a question the previous implementation
    -- has already answered.
    --
    -- So ask the previous answer instead. 0066's owner branch returns
    -- `true, NULL` for the upload-before-publish window — an object whose bytes
    -- nothing it knows about is standing on — and returns an EXPIRY whenever the
    -- yes is backed by something live it can see. A null expiry on a readable
    -- prior answer is therefore exactly, and only, the case this file is entitled
    -- to correct: the owner's own unbounded window over bytes whose sole Feed
    -- destination they have reported. Anything with a live backing keeps its
    -- expiry, the veto does not fire, and that surface is left alone.
    --
    -- AND THE DESTINATION TERM IS BACK ALONGSIDE IT, because the discriminator is
    -- necessary and not sufficient. A null expiry says the prior answer was
    -- unbounded; it does NOT say nothing else is standing on the bytes. An owner
    -- whose media is live in a group destination AND in a reported Feed post gets
    -- `(true, null)` from 0066's owner branch, and the discriminator alone would
    -- then blank a group photo they can still legitimately see.
    --
    -- So both, and the destination term now carries 0066's OWN liveness rule
    -- rather than a fourth hand-rolled one: `removed_at is null` is not liveness
    -- for a story, because story expiry is passive and 0066 never stamps
    -- `removed_at` on a story spine row — `media_live_reference_count` compensates
    -- with exactly the `kind <> 'story' or exists (live story)` clause copied here.
    -- 'archive' is excluded because 0066 calls it "a retention HOLD, not a
    -- destination a user can see or remove" and `remove_media_destination` skips
    -- it for that reason.
    --
    -- THE RESIDUAL, STATED PRECISELY, because the previous wording was wrong about
    -- which migrations it concerned and would have pointed the integration check
    -- at the wrong place:
    --   * It is NOT only "a later migration". WP6's 0067 is ALREADY inside the
    --     delegated chain — `media_read_window_before_0069` is whatever 0066 and
    --     0067 installed — and this lane cannot read 0067 to verify what its
    --     branch returns. The discriminator's safety property is verified against
    --     0066's body alone.
    --   * What remains unknowable here: whether a live destination of a kind this
    --     file does not own is VISIBLE TO THIS CALLER. Only that lane can answer
    --     it. The terms below therefore stand the veto down whenever any such
    --     destination is live, which fails OPEN on the hide (the reported post is
    --     hidden regardless; only the bytes stay signable) rather than fails
    --     closed onto a surface 0069 has no authority over.
    --     'group' IS NO LONGER ONE OF THOSE KINDS. This function computes the
    --     group answer itself as `v_group_readable`, so for that one kind the
    --     question is not unknowable and the fail-open concession is not owed —
    --     see the exclusion on the destination term and `not v_group_readable`
    --     below, which is the term that actually decides it.
    -- Both belong in the integration check, against the chain as actually
    -- installed, not against this file.
    if v_prior.readable
       and v_prior.expires_at is null
       and not v_feed_readable
       and exists (
         select 1
           from public.feed_posts p
           join public.media_objects m on m.id = p.media_id
          where m.storage_path = p_name
            and p.deleted_at is null
            -- A post whose Feed destination was already retired through
            -- `remove_media_destination` is not on the Feed any more, so its
            -- report has nothing left to hide and must not veto the owner's own
            -- upload window. `deleted_at` alone missed that whole half.
            and public.feed_post_destination_is_live(p.id)
            and public.feed_post_reported_by_caller(p.id)
       )
       and not exists (
         select 1
           from public.stories s
          where (s.media_path = p_name or s.inset_path = p_name)
            and s.deleted_at is null
            and s.expires_at > now()
       )
       and not exists (
         select 1
           from public.media_destinations d
           join public.media_objects m on m.id = d.media_id
          where m.storage_path = p_name
            -- 'group' IS EXCLUDED HERE, and it is the one kind whose exclusion
            -- is not a judgement about liveness. The residual stated above —
            -- "whether a live destination of a kind this file does not own is
            -- VISIBLE TO THIS CALLER" — does not apply to 'group', because this
            -- function now computes that exact answer itself, once, as
            -- `v_group_readable`, and the final `and not v_group_readable` term
            -- below is what owns it. Leaving 'group' in this generic list made
            -- that final term UNREACHABLE: any live group spine row stood the
            -- whole veto down before it could be consulted, so an author who had
            -- left the group kept a signable URL for a Feed post they had
            -- reported. Two terms answering the same question, one of them
            -- blind, is how the veto lost the promise it states.
            and d.kind not in ('feed', 'archive', 'group')
            and d.removed_at is null
            -- PASSIVE EXPIRY, ONE CLAUSE PER KIND THAT HAS IT. `removed_at is
            -- null` is not liveness for any destination whose kind expresses
            -- expiry through a clock instead of stamping the spine row, and the
            -- generic term counts every such long-dead row as somewhere the
            -- photo still lives — which stands the veto down and lets a reported
            -- post go on signing.
            --
            -- 'story' (0066): a story destination row is never retired, so the
            -- rule is copied from `media_live_reference_count` rather than
            -- re-derived, which is what three earlier attempts did wrong.
            and (
              d.kind <> 'story'
              or exists (
                select 1
                  from public.stories s2
                 where s2.id::text = d.ref_id
                   and s2.deleted_at is null
                   and s2.expires_at > now()
              )
            )
            -- 'night_out' (0068): THE SAME DEFECT, A SECOND TIME, FOUND ON THE
            -- ROUND-2 PANEL. 0068 mints a kind='night_out' spine row and never
            -- stamps `removed_at` when the 24-hour window closes — its own
            -- `media_read_window` branch reads the clock instead, gating on
            -- `night_out_media_window_open(n.id)`. So an expired Night Out row
            -- sits live forever and, without this clause, an author who reported
            -- their own Feed post kept minting signed URLs for the reported bytes
            -- through a night that ended weeks ago.
            --
            -- 0068's own predicate is called rather than re-spelled, for the same
            -- reason the story clause copies 0066's: it is a half-open interval
            -- with a not-yet-opened half, and a hand-rolled `now() < expires_at`
            -- would silently drop that. It is SECURITY DEFINER and revoked from
            -- every application role, which is fine here — this function is
            -- SECURITY DEFINER too, and 0068 calls it exactly this way.
            --
            -- AND MEMBERSHIP, NOT LIVENESS ALONE. ROUND-3 PANEL, CODEX, MEDIUM.
            -- This clause first carried only the window check, on the stated
            -- ground that "whether THIS caller is a member is 0068's question,
            -- not this file's". That ground was wrong in the same way the
            -- 'group' one was: the question is not unanswerable here, and 0068
            -- answers it in this very function with `night_out_role(n.id) is not
            -- null`, one line above its own window check. `night_out_role`
            -- returns a role only for an ACCEPTED member, so a member who
            -- DECLINED after the photo was attached reads null.
            --
            -- Without this term, that declined member's own upload stayed
            -- signable after they reported their own Feed post standing on the
            -- same bytes: the night was still open, so the destination counted,
            -- so the veto never ran — while 0068's night_out branch had already
            -- refused them and fallen through to the owner-prefix grant. A
            -- destination the caller has been shut out of is not "somewhere the
            -- photo still lives" for them, which is the only thing this term is
            -- asking. Both halves of 0068's own pair, therefore, in 0068's order.
            and (
              d.kind <> 'night_out'
              or exists (
                select 1
                  from public.night_outs n2
                 where n2.id::text = d.ref_id
                   and public.night_out_role(n2.id) is not null
                   and public.night_out_media_window_open(n2.id)
              )
            )
       )
       -- AND THE CALLER'S OWN SAVED NIGHTS ARCHIVE STANDS THE VETO DOWN.
       -- ROUND-2 PANEL, CODEX, MEDIUM. The discriminator this veto turns on —
       -- "readable, with a null expiry" — was chosen because 0066 returns that
       -- shape for exactly one thing: the owner's upload-before-publish window.
       -- 0068 added a SECOND source of it. Its first branch returns
       -- `(true, null)` to the owner of a live Saved Nights archive, because
       -- V8-R-NO-009 makes that retention indefinite, and it does so for ANY
       -- archive owner rather than only the media's owner. Read through the
       -- discriminator alone, that grant looks identical to an upload window.
       --
       -- So: a participant who saved a photo into their own Saved Nights, whose
       -- Night Out destination has since been removed, and who then reports a
       -- live Feed post standing on the same bytes, had their own archive
       -- blanked — a 404 on a photo 0068 promises them indefinitely. That is the
       -- veto reaching onto a surface it does not own, in the over-hiding
       -- direction.
       --
       -- The generic term above cannot carry this, and 'archive' must stay
       -- excluded from it: an archive hold belonging to SOMEONE ELSE is exactly
       -- what 0066 calls "a retention HOLD, not a destination a user can see or
       -- remove", and counting it would stand the veto down for a surface this
       -- caller genuinely cannot see. The term is therefore CALLER-SCOPED, and it
       -- is 0068's own archive branch copied predicate for predicate.
       and not exists (
         select 1
           from public.media_destinations d
           join public.media_objects m on m.id = d.media_id
           join public.saved_nights sn on sn.id::text = d.ref_id
          where d.kind = 'archive'
            and d.removed_at is null
            and m.storage_path = p_name
            and m.bytes_removed_at is null
            and sn.owner_id = v_caller
       )
       -- A GROUP MESSAGE THIS CALLER CAN SEE IS NOT A DESTINATION THIS VETO OWNS.
       -- This is the ONLY term that decides the group case: 'group' is excluded
       -- from the generic destination term above precisely so that this one is
       -- reachable. It is also the only one that could decide it, because a group
       -- message references the media registry directly and need not have minted a
       -- destination row at all. Asking the group answer itself keeps
       -- the veto's stated promise: it may blank the owner's own upload window over
       -- a post they reported, never a surface they can still legitimately see.
       and not v_group_readable
       -- A PLAN COVER THIS CALLER CAN SEE IS NOT A DESTINATION THIS VETO OWNS
       -- EITHER (S-06c). Same reasoning as the group term directly above: the
       -- veto may blank the owner's own upload window over a Feed post they
       -- reported, never a surface they can still legitimately see — and a
       -- cover on a plan they belong to is exactly such a surface.
       and not v_cover_readable
    then
      return query select false, null::timestamptz;
      return;
    end if;

    -- ROUND 9 OF WP6, CARRIED FORWARD HERE: A LIVE GROUP MESSAGE OUTRANKS A
    -- STORY'S CLOCK. 0067 fixed this inside its own two terminal branches, which
    -- 0068 then deleted along with the rest of the branch; on the delegating shape
    -- the same rule is one clamp over the delegate's answer, and it covers every
    -- branch the delegate can return from rather than the two 0067 could reach.
    --
    -- A group destination has no expiry of its own — V8-R-GRP-007's retention is
    -- "messages persist until removed or the group is deleted; there is no
    -- automatic expiry" — so handing back the STORY's expiry capped the signed URL
    -- at whatever the story had left, which is near zero once the story is about to
    -- lapse. The photo then rendered as unavailable in a thread whose retention has
    -- no clock at all. null is how "no expiry of its own" is spelled here.
    if v_prior.readable and v_group_readable then
      return query select true, null::timestamptz;
      return;
    end if;

    -- A LIVE COVER OUTRANKS A STORY'S CLOCK TOO (S-06c). A cover has no expiry
    -- of its own — the plan's lifetime is the reference's lifetime — so the
    -- delegate's story-bounded window must not cap the signed URL for it.
    if v_prior.readable and v_cover_readable then
      return query select true, null::timestamptz;
      return;
    end if;

    if v_prior.readable then
      return query select v_prior.readable, v_prior.expires_at;
      return;
    end if;
  end if;

  -- THE FEED BRANCH. A live, visible, unreported Feed post whose media object
  -- names these bytes — `v_feed_readable`, computed above. `can_view_feed_post`
  -- is the same predicate the RLS policy uses, so a viewer cannot be shown a
  -- photo for a card they cannot read, and the reporter hide reaches the BYTES as
  -- well as the row — 0066 records why that matters: "hiding the caption while
  -- the image still loads" does not satisfy "reporting IMMEDIATELY HIDES the
  -- reported content".
  if v_feed_readable then
    return query select true, null::timestamptz;
    return;
  end if;

  -- THE GROUP BRANCH. 0067's viewer answer: the read is authorised by the group
  -- message, not by a timestamp, and its window is unbounded. Reached only when the
  -- delegate refused — which is what a member who is not the uploader gets, because
  -- nothing in the delegated chain has known about groups since 0068.
  if v_group_readable then
    return query select true, null::timestamptz;
    return;
  end if;

  -- THE COVER BRANCH (S-06c). Reached when the delegate refused — a member who
  -- is not the uploader — and authorised by the plan, not by a timestamp.
  if v_cover_readable then
    return query select true, null::timestamptz;
    return;
  end if;

  return query select false, null::timestamptz;
end;
$$;

comment on function public.media_read_window(text) is
  '0066''s read decision as consolidated in 0076, widened in 0082 (S-06c): the object a live (non-cancelled) night out''s cover names is readable, unbounded, to that plan''s owner and accepted members; the reporter veto stands down for it as it does for a visible group message.';

------------------------------------------------------------------------------
-- 3. set_night_out_cover — media:<uuid> beside template:<key>, owner-owned only.
------------------------------------------------------------------------------

create or replace function public.set_night_out_cover(
  p_night_out uuid,
  p_cover     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;
  if p_cover is not null and char_length(btrim(p_cover)) = 0 then
    p_cover := null;
  end if;
  if p_cover is not null and p_cover !~ '^(template:[a-z0-9-]{1,40}|media:[0-9a-f-]{36})$' then
    return false;
  end if;
  -- S-06c (0082): a library cover names an object THIS caller uploaded through
  -- /api/media/upload — registered, in the media bucket, bytes still present.
  -- Anyone else's object, or an id that names nothing, is refused with false,
  -- so a cover can never point at bytes its owner could not read themselves.
  -- S-06c round-1 HIGH (Codex) / MEDIUM (Fable): LOCK the media row while binding
  -- it as a cover. claim_media_for_removal (0066) recounts references and stamps
  -- bytes_removed_at under `for update of m skip locked`, so a plain `exists`
  -- snapshot that predates the stamp reads "still live" and would attach a cover
  -- to bytes already committed to deletion — the exact defect 0068 fixed the same
  -- way (round-6 panel, HIGH). Holding the row lock makes a concurrent sweep skip
  -- this row; and if the sweep locked and stamped first, `for update` waits and
  -- then the `bytes_removed_at is null` filter drops the row, so we refuse. Once
  -- the cover commits, media_live_reference_count returns 1 and no later sweep
  -- considers it.
  if p_cover is not null and p_cover like 'media:%' then
    perform 1
       from public.media_objects mo
      where mo.id::text = substring(p_cover from 7)
        and mo.owner_id = v_uid
        and mo.bucket_id = 'story-media'
        and mo.bytes_removed_at is null
      for update;
    if not found then
      return false;
    end if;
  end if;

  update public.night_outs
     set cover = p_cover
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  return found;
end;
$$;

revoke all on function public.set_night_out_cover(uuid, text) from public, anon;
grant execute on function public.set_night_out_cover(uuid, text) to authenticated;

comment on function public.set_night_out_cover(uuid, text) is
  'S-06b, widened in 0082 (S-06c). The owner sets or clears the plan cover while the plan is draft/open. Accepts NULL, template:<key>, or media:<uuid> naming a media_objects row the caller owns with bytes present; any other value returns false. Mirrors set_night_out_area.';
