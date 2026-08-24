import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two of this lane's requirements are discharged ENTIRELY in SQL, and nothing
 * in the local gate executes SQL — typecheck, vitest and the Playwright release
 * run are all green over a migration that never parsed, which is the exact
 * failure `scripts/migration-dollar-quote.test.ts` was written for after 0065.
 *
 * So these are text assertions, and they are deliberately narrow: each one pins
 * a clause that, if it were dropped, would silently un-implement a requirement
 * while every other check stayed green.
 *
 *   V8-R-CMP-012  bytes are not removable while a live reference exists
 *   V8-R-STO-016  audience and tag metadata stop being queryable after deletion
 *   V8-R-FEED-009 the block check is bidirectional
 *   V8-R-FEED-010 the report record is server-owned
 *
 * A text scan is not a substitute for applying the migration against a
 * database. It is the strongest check available in a lane that is forbidden
 * from touching a shared one.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0066_media_boundary.sql'),
  'utf8',
);

/**
 * Comments are STRIPPED before anything below is asserted.
 *
 * This file's header comments quote the requirements verbatim, so a scan of the
 * raw text matches its own prose: the first version of the grant assertion
 * below failed on "...no write grant... a client that can insert its own media
 * row... on public.media_objects", which is a sentence, not a statement. That
 * cuts both ways and the false-negative was the lucky half — every positive
 * assertion here would equally have passed on a comment that merely DESCRIBED
 * the clause, so a migration could have lost a policy and stayed green.
 *
 * No string literal in this migration contains `--`, so a line-wise strip is
 * exact rather than approximate.
 */
const STATEMENTS = SQL
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** Collapse whitespace so an assertion is about the clause, not its wrapping. */
const FLAT = STATEMENTS.replace(/\s+/g, ' ');

describe('0066 — V8-R-CMP-012 bytes outlive nothing but their last reference', () => {
  it('gates the storage DELETE policy on the reference count', () => {
    expect(FLAT).toContain(
      'and not public.media_path_has_live_reference(\'story-media\', name)',
    );
  });

  it('keeps 0065 prefix scoping, so a delete cannot reach another user', () => {
    expect(FLAT).toContain('(storage.foldername(name))[1] = auth.uid()::text');
  });

  it('counts references with a definer function, not through the caller\'s RLS', () => {
    // A caller-visible count reports zero for references it merely cannot see,
    // and zero is what authorizes destroying the bytes.
    expect(FLAT).toMatch(
      /create or replace function public\.media_live_reference_count\(p_media_id uuid\).*?security definer/i,
    );
  });

  it('locks the media row before counting, so a concurrent add cannot be missed', () => {
    expect(FLAT).toContain('for update of m');
  });

  // SECURITY DEFINER is what lets these see references the caller cannot, so
  // granted to `authenticated` without a guard they are liveness ORACLES:
  // anyone holding a media id or a storage path could poll whether somebody
  // else's photo is still referenced and watch it flip on expiry or deletion —
  // and keep polling after being blocked. 0065 refuses exactly that shape.
  it('guards the reference-count helpers so they are not liveness oracles', () => {
    expect(FLAT).toContain(
      'if v_caller is not null and not exists ( select 1 from public.media_objects m'
      + ' where m.id = p_media_id and m.owner_id = v_caller ) then return 1',
    );
    expect(FLAT).toContain(
      'if v_caller is not null and (storage.foldername(p_name))[1]'
      + ' is distinct from v_caller::text then return true',
    );
  });

  // Both guards fail CLOSED — 1 reference and "still referenced" — because
  // "zero" and "false" are the answers that authorise destroying bytes.
  it('makes the guarded answer the one that keeps the bytes', () => {
    expect(FLAT).not.toContain('is distinct from v_caller::text then return false');
    expect(FLAT).not.toMatch(/and m\.owner_id = v_caller \) then return 0/i);
  });

  it('leaves archive holds standing when deleting everywhere', () => {
    // V8-R-CMP-016: bytes are reclaimed only if no Saved Nights Out archive
    // still references them.
    expect(FLAT).toContain("and d.kind <> 'archive'");
  });

  // A hold the owner can strip is not a hold. Without this clause the owner
  // reads the archive row's id through the owner SELECT policy, passes it to
  // remove_media_destination, and reclaims the bytes V8-R-CMP-016 retains.
  it('refuses to remove an archive hold through the single-destination verb', () => {
    expect(FLAT).toContain(
      "where d.id = p_destination_id and d.kind <> 'archive' and m.owner_id = auth.uid()",
    );
  });

  // Nothing retires a story destination when the story EXPIRES — delete_story
  // covers deletion only. Counting the row itself would hold expired bytes
  // forever AND make the DELETE policy refuse the cleanup meant to free them.
  it('does not count a story destination whose story is dead or expired', () => {
    expect(FLAT).toContain(
      "d.kind <> 'story' or exists ( select 1 from public.stories s"
      + ' where s.id::text = d.ref_id and s.deleted_at is null and s.expires_at > now() )',
    );
  });

  // A LIVE STORY IS A DESTINATION. Retiring only the spine row left the story
  // showing the photo, its audience and tag rows queryable against
  // V8-R-STO-016, and the reference count permanently above zero — a delete
  // that cannot complete rather than a partial delete honestly reported.
  // Author-scoped: both verbs already established the caller owns the media.
  it('closes the story destination itself, not just its spine row', () => {
    expect(FLAT).toContain(
      'update public.stories s set deleted_at = now() from public.media_objects m'
      + ' where m.id = v_media and s.author_id = auth.uid()',
    );
    // The FROM list gained `media_objects` so the close is also PATH-matched:
    // a destination row whose ref_id names a story that does not actually carry
    // this object's bytes no longer closes that story. Asserted piecewise
    // rather than as one long literal, so the next legitimate predicate does
    // not read as a missing statement.
    const closeByDestination = FLAT.slice(
      FLAT.indexOf(
        'update public.stories s set deleted_at = now() from public.media_destinations d',
      ),
    ).split(';')[0];
    expect(closeByDestination).not.toBe('');
    for (const predicate of [
      'public.media_objects m',
      'd.id = p_destination_id',
      "d.kind = 'story'",
      's.id::text = d.ref_id',
      's.author_id = auth.uid()',
      's.deleted_at is null',
      '(s.media_path = m.storage_path or s.inset_path = m.storage_path)',
    ]) {
      expect(closeByDestination, `destination close lost ${predicate}`).toContain(predicate);
    }
  });

  // publish_story predates this spine and still does not write to it, so for
  // every story published outside the media route the spine is EMPTY. A
  // spine-only count reads zero for a photo two live stories are showing, and
  // zero is the licence to destroy the bytes.
  it('counts a live story that references the object without a spine row', () => {
    expect(FLAT).toContain(
      'join public.stories s on (s.media_path = m.storage_path'
      + ' or s.inset_path = m.storage_path)',
    );
    expect(FLAT).toContain(
      "p_bucket = 'story-media' and exists ( select 1 from public.stories s"
      + ' where (s.media_path = p_name or s.inset_path = p_name)',
    );
  });
});

describe('0066 — EC-01/EC-02/EC-03 round-3 fixes', () => {
  // FIX A. Both review lanes reported the unregistered-object race. publish_story's
  // `for update` locks nothing when no registry row exists — which is exactly the
  // orphan sweep's population — so the lock has to be on the PATH, which exists
  // whether or not the registry knows about it.
  it('locks the storage path, not just the registry row', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.media_path_lock_key\(p_bucket text, p_name text\)/i,
    );
    // The publisher WAITS: it must not proceed onto bytes a sweep is claiming.
    expect(FLAT).toContain(
      "perform pg_advisory_xact_lock(public.media_path_lock_key('story-media', v_path))",
    );
    // The sweep never waits, because it still holds locks from earlier iterations
    // and a blocking acquire there could deadlock against a waiting publisher.
    expect(FLAT).toContain(
      "if not pg_try_advisory_xact_lock(public.media_path_lock_key('story-media', r.name)) then",
    );
  });

  // Sorted, so two publishers sharing a main/inset pair cannot take the two path
  // locks in opposite orders and deadlock against each other.
  it('takes the publisher path locks in a deterministic order', () => {
    expect(FLAT).toContain(
      'select p from unnest(array[p_media_path, p_inset_path]) as p where p is not null group by p order by p',
    );
  });

  // A lock that only narrows the window is not a fix: the candidate list was built
  // before the lock existed, so eligibility has to be re-established under it.
  it('re-verifies eligibility under the sweep lock before adopting', () => {
    expect(FLAT).toContain(
      'select 1 from public.stories s where (s.media_path = r.name or s.inset_path = r.name)'
      + ' and s.deleted_at is null and s.expires_at > now()',
    );
  });

  // FIX D / EC-03. The CHECK constraint and the function must agree at every
  // migration. Promising four kinds while resolving one is the contradiction that
  // produced the finding; 0067 adds group_message and 0069 adds feed_post/comment,
  // each widening BOTH halves together.
  it('constrains subject_kind to what 0066 can actually resolve', () => {
    expect(FLAT).toContain("check (subject_kind in ('story'))");
    expect(FLAT).not.toMatch(
      /check \(subject_kind in \('story', 'feed_post', 'comment', 'group_message'\)\)/i,
    );
  });

  // FIX 4b. Gating discovery closes how a blocked account FINDS someone; it does
  // not close what they can still READ once they hold the id, and an id survives a
  // block.
  // THE GATE MUST SIT BELOW THE CAP SPEND. The first version of this fix put it
  // above, reasoning that probing should cost the prober nothing — which made the
  // blocked path the only one that did NOT consume the counter shared with
  // search_handles. Same return value, different side effect: still an oracle.
  // Round 3 caught it. Below the spend, blocked / private / unknown all cost one
  // attempt and are indistinguishable by return value AND by cap.
  it('gates the follower count on blocks, AFTER spending the search cap', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.get_follower_count\(profile_id uuid\)/i,
    );
    const body = FLAT.slice(FLAT.indexOf('create or replace function public.get_follower_count'));
    const gate = body.indexOf('if public.is_blocked_between(uid, profile_id) then return null');
    const spend = body.indexOf('insert into public.handle_search_attempts');
    expect(gate).toBeGreaterThan(-1);
    expect(spend).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(spend);
  });

  // X4. The ceiling is a read-then-insert, so two concurrent reports both observe
  // 49 and both commit. Serialized on the REPORTER, so unrelated accounts never
  // contend.
  it('serializes the daily report cap per reporter', () => {
    expect(FLAT).toContain(
      "perform pg_advisory_xact_lock( hashtextextended('report_cap:' || auth.uid()::text, 0) )",
    );
  });

  // X3. The bucket's own limit is the authority on what can be stored, and the
  // re-encode boundary must agree with it. If 0065's limit moves and
  // MAX_STORED_BYTES does not, this fails.
  it('keeps the stored-bytes ceiling in step with the bucket file_size_limit', () => {
    const bucketLimit = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0065_stories.sql'),
      'utf8',
    ).match(/file_size_limit[\s\S]{0,200}?(\d{6,})/);
    expect(bucketLimit).not.toBeNull();
    expect(Number(bucketLimit![1])).toBe(8 * 1024 * 1024);
  });

  // EC-04 REPLACED THIS. The round-3 fix added a block gate to get_public_ratings,
  // which preserved a superseded feature and made this migration the newest code in
  // the repo pointing at it. V8 uses numeric scores; V8-R-RNK-001 excludes tiers.
  // The surface is retired, not gated — and this asserts the gate did NOT come back.
  it('retires the tier-bearing public ratings list instead of gating it', () => {
    expect(FLAT).toContain('drop function if exists public.get_public_ratings(text)');
    expect(
      FLAT,
      'the block gate is back — a retired surface does not need one',
    ).not.toContain('and not public.is_blocked_between(auth.uid(), p.id)');
    expect(FLAT).not.toMatch(/create or replace function public\.get_public_ratings/i);
  });
});

describe('0066 — round-5 fixes', () => {
  // The hide must reach the BYTES. report_content lets an author report their own
  // story; the row and the url route then hide it, but 0065's story_media_is_dead
  // consults only deleted_at/expires_at, so the retained owner Storage policy kept
  // minting signed URLs for the cached path. That policy stands until WP2's 0071, so
  // the gap is live until then.
  it('treats a self-reported story as dead for its own author', () => {
    const body = FLAT.slice(FLAT.indexOf('create or replace function public.story_media_is_dead'));
    const fn = body.slice(0, body.indexOf('$$;'));
    // SCOPED TO THE REPORTED STORY. The old term joined content_reports against ANY
    // story naming the path with no liveness condition, so one self-report on a
    // long-expired story permanently hid the bytes of a different, live, unreported
    // story reusing the same object. Both review families reported it.
    expect(fn).toContain('public.media_path_unreported_live_expiry(p_name, auth.uid()) is null');
    expect(fn).not.toContain('join public.content_reports cr');
    // The hide is still keyed to a report by THIS caller — the matching just lives in
    // the shared helper now, so media_read_window and story_media_is_dead cannot
    // disagree about what "reported" means the way they did.
    const helper = FLAT.slice(
      FLAT.indexOf('create or replace function public.media_path_unreported_live_expiry'),
    );
    const helperBody = helper.slice(0, helper.indexOf('$$;'));
    expect(helperBody).toContain('cr.reporter_id = p_viewer');
    expect(helperBody).toContain("cr.subject_kind = 'story'");
    // ...and it only ever considers stories that are actually live.
    expect(helperBody).toContain('s.deleted_at is null and s.expires_at > now()');
  });

  // The comment described the ordering that WAS the defect.
  it('does not claim the block gate precedes the cap spend', () => {
    expect(FLAT).not.toContain('and returns it before spending the search cap');
    expect(FLAT).toContain('AFTER spending the search cap');
  });
});

describe('0066 — this lane PROVIDES the boundary and must stay additive', () => {
  // EC-01 (2026-08-24) restored V8-R-STO-014/015/016 to WP2 (goal g-f1e128da),
  // matching the founder-approved 3.1.0 ledger. Withdrawing the legacy grants
  // belongs to WP2's 0071, after the src/lib/stories.server.ts consumer moves.
  // These three assertions are the regression guard for the defect both
  // reviewers reported in every round: 0066 dropped the policies that every
  // production caller still depends on, in a lane forbidden to fix the caller.
  const LEGACY = [
    'story-media: owner writes own prefix',
    'story-media: owner reads own prefix',
    'story-media: audience reads referenced',
  ] as const;

  it.each(LEGACY)('does not drop the legacy policy %s', (name) => {
    expect(
      FLAT,
      `0066 must be additive: dropping "${name}" breaks the production story `
        + 'client, whose file this lane may not edit. The drop belongs in WP2 0071.',
    ).not.toContain(`drop policy if exists "${name}" on storage.objects`);
  });

  // Nor does it recreate them: 0066 leaves the legacy grants entirely alone.
  // Untouched is the additive position; re-issuing them would be this lane
  // writing policy it does not own.
  it.each(LEGACY)('does not recreate the legacy policy %s either', (name) => {
    expect(FLAT).not.toMatch(new RegExp(`create policy "${name}"`, 'i'));
  });

  // The one story-media policy this lane DOES replace. Drop-and-recreate is a
  // replacement, not a premature drop, so it stays — and it is why the WP2
  // deletion finding is real today.
  it('still replaces the owner delete policy in place', () => {
    expect(FLAT).toContain(
      'drop policy if exists "story-media: owner deletes own prefix" on storage.objects',
    );
    expect(FLAT).toMatch(/create policy "story-media: owner deletes own prefix"/i);
  });

  // The read decision must ALSO exist server-side, or the url route mints with
  // service role for anyone who reaches it. It stands beside the legacy grants
  // rather than replacing them until WP2's 0071 withdraws those.
  it('moves the read decision into a definer function the route must ask', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.media_read_window\(p_name text\).*?security definer/i,
    );
    expect(FLAT).toContain(
      'grant execute on function public.media_read_window(text) to authenticated',
    );
  });

  it('keeps 0065\'s rule that an author cannot sign their own dead media', () => {
    expect(FLAT).toContain('if public.story_media_is_dead(p_name) then');
  });

  it('carries the audience terms the dropped viewer policy had', () => {
    expect(FLAT).toContain('public.is_mutual_friend(v_caller, s.author_id)');
    expect(FLAT).toContain(
      "s.audience = 'friends' or public.is_story_recipient(s.id, v_caller)",
    );
  });

  // The window and the permission have to come from the SAME rows. Computed
  // apart, a viewer authorised through a story with two minutes left could be
  // handed a lifetime borrowed from a destination they cannot read at all.
  it('returns the window with the permission, from the rows that granted it', () => {
    expect(FLAT).toContain('returns table (readable boolean, expires_at timestamptz)');
    expect(FLAT).toContain('return query select v_expiry is not null, v_expiry');
  });

  // publish_story writes no spine row and upload-before-publish cannot name a
  // story that does not exist yet, so a window read from media_destinations is
  // empty for every normally published and every legacy story photo.
  it('reads the window from stories, which is where the expiry actually lives', () => {
    expect(FLAT).toContain(
      'select max(s.expires_at) into v_expiry from public.stories s'
      + ' where (s.media_path = p_name or s.inset_path = p_name)',
    );
  });
});

describe('0066 — V8-R-STO-016 deletion clears metadata too', () => {
  it('gates story_audience reads on the story still being live', () => {
    expect(FLAT).toContain('and public.is_story_live(story_id)');
  });

  it('gates story_tags reads on the story still being live', () => {
    expect(FLAT).toContain(
      'create policy "story_tags: readable with story" on public.story_tags for select using ( public.is_story_live(story_id)',
    );
  });

  // is_story_live is SECURITY DEFINER, so on its own it is true for every
  // authenticated caller. Liveness had to be ADDED to 0065's audience-scoped
  // test, not substituted for it, or the migration meant to narrow tag reads
  // would have published every live private story's tag list.
  it('keeps the caller-scoped audience term on story_tags, not liveness alone', () => {
    expect(FLAT).toContain(
      'using ( public.is_story_live(story_id) and ( auth.uid() = profile_id'
      + ' or exists (select 1 from public.stories s where s.id = story_id) ) )',
    );
  });

  it('replaces both 0065 policies rather than adding a second, weaker one', () => {
    expect(FLAT).toContain('drop policy if exists "story_audience: parties read"');
    expect(FLAT).toContain('drop policy if exists "story_tags: readable with story"');
  });

  it('checks liveness with a definer helper, avoiding 0065\'s recursion trap', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_story_live\(p_story_id uuid\).*?security definer/i,
    );
  });

  it('retires story destinations inside delete_story, not in a client', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.delete_story.*?update public\.media_destinations d set removed_at = now\(\) where d\.kind = 'story'/i,
    );
  });
});

describe('0066 — V8-R-FEED-009 blocking is enforced both ways', () => {
  it('matches a block in either direction', () => {
    expect(FLAT).toContain(
      'where (pb.blocker_id = a and pb.blocked_id = b) or (pb.blocker_id = b and pb.blocked_id = a)',
    );
  });

  // "SERVER-ENFORCED IN BOTH DIRECTIONS" needs a consumer. A helper that
  // nothing calls is a recorded intention: a blocked viewer holding an audience
  // row kept passing the friendship check and kept receiving signed URLs.
  // Enforcement lives in the SHARED predicate. Blocking deletes no follows
  // edge, so every rule 0065 keyed on mutuality kept passing for a blocked
  // pair: the stories SELECT policy still returned the blocker's metadata, and
  // publish_story still let either party name or TAG the other. Putting the
  // term inside is_mutual_friend fixes all four call sites at once, and the
  // fifth somebody adds later.
  it('makes a blocked pair fail the mutual-friend predicate everything asks', () => {
    expect(FLAT).toContain('and not public.is_blocked_between(a, b)');
    expect(FLAT).toMatch(
      /create or replace function public\.is_mutual_friend\(a uuid, b uuid\).*?security definer/i,
    );
  });

  it('answers as definer, so the blocked party cannot read past it', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.is_blocked_between\(a uuid, b uuid\).*?security definer/i,
    );
  });

  // SECURITY DEFINER is exactly what lets this function see a row the policy
  // hides, so without a caller check it is a pairwise oracle over private block
  // data. 0065 gave is_mutual_friend the same guard for the same reason.
  it('refuses a caller asking about two other people', () => {
    expect(FLAT).toContain(
      "raise exception 'is_blocked_between: a caller may only ask about itself'",
    );
    expect(FLAT).toContain('if v_caller is not null and v_caller <> a and v_caller <> b then');
  });

  // is_mutual_friend covers everything that reads or publishes a story, but
  // follow_user (0008) never asks it — it checks the rate cap and the privacy
  // flag and inserts. A blocked user could still follow, or raise a follow
  // request against, the person who blocked them.
  it('guards the edge tables themselves, not only the story predicates', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.forbid_blocked_edge\(\) returns trigger/i,
    );
    expect(FLAT).toContain(
      'create trigger follows_blocked_guard before insert on public.follows',
    );
    expect(FLAT).toContain(
      'create trigger follow_requests_blocked_guard before insert on public.follow_requests',
    );
    expect(FLAT).toContain(
      "raise exception 'blocked: no new connection between these accounts'",
    );
  });

  // The trigger can fire under a writer that is neither party (a migration, a
  // server-side job), and is_blocked_between refuses exactly that caller. A
  // table invariant must not depend on who is asking.
  // Refusing NEW edges changes nothing for the case that matters: people block
  // someone they are already connected to. An existing follow edge or pending
  // request survived, and get_following / get_friend_ratings /
  // get_follow_requests / get_outgoing_requests all keep answering because none
  // of them consults profile_blocks. Removing the edge removes the answer from
  // every reader at once, including ones not written yet.
  it('severs the connections that already exist when a block is created', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.sever_blocked_connections\(\) returns trigger/i,
    );
    expect(FLAT).toContain(
      'delete from public.follows f where (f.follower_id = new.blocker_id'
      + ' and f.followee_id = new.blocked_id)',
    );
    expect(FLAT).toContain(
      'delete from public.follow_requests r where (r.requester_id = new.blocker_id'
      + ' and r.target_id = new.blocked_id)',
    );
    expect(FLAT).toContain(
      'create trigger profile_blocks_sever_connections after insert on public.profile_blocks',
    );
  });

  // is_blocked_between REFUSES a caller who is not one of the two parties, and
  // a trigger can fire under a writer that is neither — a migration, a
  // server-side job. The invariant belongs to the table, so the lookup must not
  // depend on who is asking.
  it('inlines the block lookup in the trigger rather than calling the guarded helper', () => {
    expect(FLAT).toContain(
      'if exists ( select 1 from public.profile_blocks pb'
      + ' where (pb.blocker_id = v_self and pb.blocked_id = v_other)'
      + ' or (pb.blocker_id = v_other and pb.blocked_id = v_self) ) then',
    );
  });
});

describe('0066 — V8-R-FEED-010 the report record is server-owned', () => {
  // OPERATOR-ONLY, which is stricter than the SELECT grant this used to assert.
  // V8-R-FEED-010's audience clause is "the report record is visible only to
  // operators"; a read-own grant handed the reporter `reason` and `resolved_at`,
  // i.e. operator resolution state. Both review lanes reported it.
  it('grants the reporter NOTHING on content_reports', () => {
    expect(FLAT).not.toMatch(/grant[^;]*on public\.content_reports to/i);
    expect(FLAT).toContain('revoke all on public.content_reports from public, anon');
    // No UPDATE and no DELETE anywhere either: that absence IS the requirement
    // that a reporter cannot edit or withdraw a report into invisibility.
    expect(FLAT).not.toMatch(/grant[^;]*update[^;]*on public\.content_reports/i);
    expect(FLAT).not.toMatch(/grant[^;]*delete[^;]*on public\.content_reports/i);
  });

  it('has no reporter SELECT policy on content_reports', () => {
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for select/i);
  });

  // Removing the grant without this would silently UNHIDE everything the user
  // reported, so the replacement read is part of the same requirement.
  it('serves the hide set through a definer function that exposes only identifiers', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.my_reported_subjects\(\).*?security definer/i,
    );
    expect(FLAT).toContain('returns table (subject_kind text, subject_ref text)');
    expect(FLAT).toContain('grant execute on function public.my_reported_subjects() to authenticated');
    // It must not hand back the operator-facing columns.
    expect(FLAT).not.toMatch(/my_reported_subjects[\s\S]{0,400}resolved_at/i);
  });

  it('has no UPDATE or DELETE policy on content_reports', () => {
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for update/i);
    expect(FLAT).not.toMatch(/create policy[^;]*on public\.content_reports for delete/i);
  });

  // NORMALIZED, not verbatim. The shape check is case-insensitive (`!~*`), so an
  // uppercase uuid is a valid subject_ref; stored verbatim it never matched the
  // hide sites, which compare against id::text (always lowercase). The report was
  // filed and the content was never hidden, and each casing variant took its own
  // row in the one-per-subject index, defeating the anti-flood measure.
  it('writes the report through a definer function that stamps and NORMALIZES', () => {
    expect(FLAT).toContain(
      'values (auth.uid(), p_subject_kind, lower(btrim(p_subject_ref)), p_reason)',
    );
    // The dedup probe must normalize identically, or a repeat report in different
    // casing reads as a new subject and spends the daily cap.
    expect(FLAT).toContain('and cr.subject_ref = lower(btrim(p_subject_ref))');
    expect(FLAT).not.toContain(
      'values (auth.uid(), p_subject_kind, btrim(p_subject_ref), p_reason)',
    );
  });

  // The record is server-OWNED. `set reason = excluded.reason` handed the edit
  // straight back to the reporter, who could rewrite what the operator reads
  // simply by re-reporting the same subject.
  it('leaves the stored reason untouched on a repeat report', () => {
    // Not even a coalesce that FILLS a null: that still let the reporter decide
    // after the fact what the operator reads. The update is a deliberate no-op
    // rather than DO NOTHING, because DO NOTHING returns no row and the caller
    // reads a null id as a failed report and refuses to hide the content.
    expect(FLAT).toContain('set reason = public.content_reports.reason');
    expect(FLAT).not.toContain('set reason = coalesce(');
  });

  // "Reporting IMMEDIATELY HIDES the content FOR THE REPORTER" needs a READ
  // path that honours it. reportContent returned hideForReporter:true and
  // listReportedSubjects offered the hide set, but no policy and no production
  // caller consulted either, so the reported story stayed visible and the
  // requirement was discharged by a boolean nobody read.
  // THROUGH THE DEFINER PREDICATE, not a bare subquery. content_reports now
  // carries no reporter grant, and a policy USING expression runs with the
  // CALLER's privileges — so the bare subquery this used to assert would either
  // raise permission denied or contribute nothing, making `not exists (...)`
  // unconditionally true and un-hiding every reported story. It would have failed
  // OPEN, via the change meant to tighten the record.
  it('hides a reported story in the audience gate through the definer predicate', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.story_reported_by_caller\(p_story uuid\).*?security definer/i,
    );
    // Both story SELECT policies ask it, and neither reads the table directly.
    const asks = FLAT.match(/and not public\.story_reported_by_caller\(public\.stories\.id\)/g) ?? [];
    expect(asks.length).toBe(2);
    expect(FLAT).not.toContain(
      'and not exists ( select 1 from public.content_reports cr'
      + " where cr.reporter_id = auth.uid() and cr.subject_kind = 'story'"
      + ' and cr.subject_ref = public.stories.id::text )',
    );
    expect(FLAT).toContain(
      'drop policy if exists "stories: audience reads unexpired" on public.stories',
    );
  });

  // The policy hides the ROW. media_read_window is SECURITY DEFINER and reads
  // public.stories directly, so the policy does not run there — without the same
  // term a reporter loses the story but can still mint a fresh signed URL for
  // its photo using a media id they had already seen. Hiding the caption while
  // the image still loads is not hiding the content.
  it('hides the reported story bytes too, not only the story row', () => {
    expect(FLAT).toContain(
      'and not exists ( select 1 from public.content_reports cr'
      + " where cr.reporter_id = v_caller and cr.subject_kind = 'story'"
      + ' and cr.subject_ref = s.id::text )',
    );
  });

  // A report hides content for the person who reported it and for nobody else.
  // It is not a moderation action and must not behave like one.
  it('scopes the hide to the reporter own rows', () => {
    expect(FLAT).not.toMatch(/from public\.content_reports cr where cr\.subject_kind/i);
  });

  // report_content is granted to `authenticated` and is therefore callable
  // directly over PostgREST. A cap that lives only in reports.ts bounds the
  // app's own UI and nothing else.
  it('bounds subject_ref and reason server-side, not only in the TypeScript caller', () => {
    expect(FLAT).toContain('if length(p_subject_ref) > 200 then');
    expect(FLAT).toContain('if p_reason is not null and length(p_reason) > 1000 then');
    expect(FLAT).toContain(
      'if p_subject_ref is null or length(btrim(p_subject_ref)) = 0 then',
    );
  });
});

describe('0066 — the media registry is not client-writable', () => {
  it('grants only SELECT on media_objects and media_destinations', () => {
    expect(FLAT).toContain('grant select on public.media_objects to authenticated');
    expect(FLAT).toContain('grant select on public.media_destinations to authenticated');
    // A client that can insert its own media row declares its own content_type,
    // which defeats V8-R-STO-014's server-side verification.
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_objects/i);
    expect(FLAT).not.toMatch(/grant[^;]*insert[^;]*on public\.media_destinations/i);
  });

  it('enables row level security on every table it creates', () => {
    for (const table of [
      'media_objects',
      'media_destinations',
      'profile_blocks',
      'content_reports',
    ]) {
      expect(FLAT).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'),
      );
    }
  });
});

/**
 * THE THREE REDESIGNS.
 *
 * Each of these replaced a shape that review found broken in a DIFFERENT
 * instance three rounds running. What is pinned here is the structural property
 * that makes the family impossible, not the individual instance — an assertion
 * on one call site would go green again the moment a fourth site appeared.
 */
describe('0066 — reclamation is a claim, not a check-then-delete', () => {
  // Check-then-delete cannot be fixed by narrowing the gap: the answer is about
  // the past by the time the bytes go, and losing that race destroys a live
  // story's photo. What CAN be atomic is the claim.
  it('recounts UNDER the row lock and stamps in the same transaction', () => {
    expect(FLAT).toContain('for update of m skip locked');
    expect(FLAT).toContain('if public.media_live_reference_count(r.id) = 0 then');
    // THE STAMP GOES THROUGH THE ONE GUARD. The check and the write used to be
    // inlined here and inlined AGAIN, differently, in claim_orphan_paths — which is
    // how the orphan sweep ended up with no re-check under its lock at all. Both
    // claimers now call take_media_claim, so the rule has a single definition.
    expect(FLAT).toContain('if public.take_media_claim(r.id) then');
    expect(FLAT).toContain(
      'update public.media_objects m set bytes_removed_at = now()'
      + ' where m.id = p_media_id'
      + ' and not public.media_claim_is_live(m.bytes_removed_at);',
    );
  });

  // The other half of the lock. Without this, publication still races: the claim
  // holds a lock nothing else takes, which is no lock at all.
  it('makes publish_story take the SAME lock the claim takes', () => {
    expect(FLAT).toContain(
      "perform 1 from public.media_objects m where m.bucket_id = 'story-media'"
      + ' and m.storage_path in (p_media_path, p_inset_path) for update;',
    );
    expect(FLAT).toContain(
      "raise exception 'publish_story: those bytes have already been reclaimed'",
    );
  });

  // 0065 published without writing the spine, which is why the reference count
  // needs a second term that counts stories directly. The destination is now
  // recorded where it is actually created.
  it('writes the destination spine row where the destination is created', () => {
    expect(FLAT).toContain(
      "insert into public.media_destinations (media_id, kind, ref_id)"
      + " select m.id, 'story', v_id::text",
    );
  });

  // A stamp left standing over bytes that are still in the bucket is the
  // registry lying, and every future sweep skips it.
  it('hands the claim back when the removal did not happen', () => {
    expect(FLAT).toContain(
      'update public.media_objects m set bytes_removed_at = null'
      + ' where m.id = p_media_id and m.bytes_removed_at is not null',
    );
  });
});

describe('0066 — zero-reference bytes have a reclamation PATH, not just eligibility', () => {
  // Every story photo in the product today predates this registry and so has no
  // media_objects row. A sweep that only looked at the registry would be
  // eligible to reclaim nothing that actually exists.
  it('offers unregistered objects, which is where all existing media lives', () => {
    expect(FLAT).toMatch(
      /create or replace function public\.claim_orphan_paths\(p_limit integer default 25\)/i,
    );
    // Unclaimed rows are skipped, AND so are claims still plausibly in flight. The
    // second half was missing: the claiming transaction commits (releasing the
    // advisory lock) before the caller issues the Storage delete, so a second tick
    // re-selected the stamped row, `coalesce` handed back the same claim, and a
    // release after a skipped removal let publish_story see a cleared stamp while a
    // deletion was still in flight. Re-adoption after a FAILED removal still works;
    // it just waits for the stamp to go stale.
    expect(FLAT).toContain(
      'not exists ( select 1 from public.media_objects m'
      + " where m.bucket_id = 'story-media' and m.storage_path = o.name"
      + ' and ( m.bytes_removed_at is null'
      + ' or public.media_claim_is_live(m.bytes_removed_at) ) )',
    );
    // ...and the one-hour rule itself lives in exactly one function.
    expect(FLAT).toContain(
      'create or replace function public.media_claim_is_live(p_stamp timestamptz)',
    );
    expect(FLAT).toContain(
      "select p_stamp is not null and p_stamp > now() - interval '1 hour';",
    );
  });

  // THE UNREGISTERED HALF IS A CLAIM TOO. Both lanes reported the same thing:
  // an object with no media_objects row is an object publish_story's `for
  // update` matches nothing for, so listing its path and removing it later with
  // service role — which bypasses the storage DELETE policy's re-check — is the
  // original check-then-delete race surviving in the one population that has no
  // row. Adopting the object is what gives publish_story something to lock.
  it('ADOPTS an unregistered object into the registry before claiming it', () => {
    // ON CONFLICT BY CONSTRAINT NAME. A column-inference list here resolves against
    // this function's OUT parameters (media_id, bucket_id, storage_path) and raises
    // `column reference "bucket_id" is ambiguous` on EVERY call — the function could
    // never run. Six review rounds read past it; the first execution against
    // PostgreSQL raised it immediately.
    expect(FLAT).toContain(
      'insert into public.media_objects (owner_id, bucket_id, storage_path)'
      + " values (v_owner, 'story-media', r.name)"
      + ' on conflict on constraint media_objects_path_unique do nothing',
    );
    expect(FLAT).not.toContain('on conflict (bucket_id, storage_path)');
    expect(FLAT).toContain(
      "where m.bucket_id = 'story-media' and m.storage_path = r.name"
      + ' for update skip locked',
    );
  });

  // Recounted under the lock, exactly as the registered claim is: the scan that
  // selected this object ran in an earlier snapshot, and a story can have been
  // published against it since.
  it('recounts under the adopted row lock before stamping', () => {
    // RE-CHECKED UNDER THE LOCK, which is what was missing entirely. The scan filter
    // ran against a snapshot taken before the lock existed, and nothing between the
    // lock and the stamp looked at bytes_removed_at again — so a row another tick had
    // claimed and COMMITTED in between got its stamp refreshed and was handed out a
    // second time. Reproduced against PostgreSQL 18.4: two concurrent
    // claim_orphan_paths calls both returned the same storage path.
    expect(FLAT).toContain(
      'if public.media_live_reference_count(v_id) = 0 then'
      + ' if public.take_media_claim(v_id) then',
    );
  });

  // Leaving the path-returning predecessor installed keeps both the race and an
  // "are these bytes unreferenced?" oracle standing beside the function that
  // closes them, and it is granted to authenticated.
  it('withdraws the path-returning predecessor', () => {
    expect(FLAT).toContain(
      'drop function if exists public.unreferenced_orphan_paths(integer)',
    );
  });

  // A claim is the sweep's exclusive right to delete, and the removal it
  // authorises happens outside the transaction. An owner able to un-stamp the
  // object mid-flight publishes a story into the gap and loses its photo to a
  // delete already issued.
  it('grants release_media_claim to no application role', () => {
    expect(FLAT).toContain(
      'revoke all on function public.release_media_claim(uuid)'
      + ' from public, anon, authenticated',
    );
    expect(FLAT).not.toContain(
      'grant execute on function public.release_media_claim(uuid) to authenticated',
    );
  });

  // Upload-then-publish means a fresh object legitimately has zero references
  // while the composer is open. Sweeping it deletes the photo mid-post.
  it('keeps a grace window so an in-progress upload is never swept', () => {
    expect(FLAT).toContain("o.created_at < now() - interval '24 hours'");
    expect(FLAT).toContain("m.created_at < now() - interval '24 hours'");
  });

  it('never offers a path a live story still names', () => {
    expect(FLAT).toContain(
      'not exists ( select 1 from public.stories s'
      + ' where (s.media_path = o.name or s.inset_path = o.name)'
      + ' and s.deleted_at is null and s.expires_at > now() )',
    );
  });
});

describe('0066 — V8-R-FEED-009 the block is enforced at the TABLES, not per call site', () => {
  // r3 patched the follow path, r4 the follow-request path, r5 the night-out
  // invitation path — three rounds, three surfaces, one defect. A connection
  // cannot exist without a row, so guarding the rows is the only version of this
  // list that is ever finished.
  it('guards every table in the schema that holds a connection between two accounts', () => {
    for (const table of [
      'follows',
      'follow_requests',
      'night_out_members',
      'story_audience',
      'story_tags',
    ]) {
      expect(
        FLAT,
        `no blocked-edge trigger on public.${table}`,
      ).toMatch(
        new RegExp(
          `create trigger \\w+ before insert on public\\.${table}`
          + ' for each row execute function public\\.forbid_blocked_edge\\(\\);',
          'i',
        ),
      );
    }
  });

  // A trigger wired to a table the function cannot read a pair out of would
  // enforce nothing while looking enforced.
  it('refuses a table it has no pair rule for, rather than passing the row', () => {
    expect(FLAT).toContain(
      "raise exception 'forbid_blocked_edge: no pair rule for table %', tg_table_name",
    );
  });

  // The night-out case is the one that proves the shape: invite_to_night_out has
  // never heard of blocks, and the guard does not need it to.
  it('reads the night-out pair from the existing members and the inviter', () => {
    expect(FLAT).toContain(
      'select nm.user_id as party from public.night_out_members nm'
      + ' where nm.night_out_id = new.night_out_id and nm.user_id <> new.user_id',
    );
    expect(FLAT).toContain('select new.invited_by where new.invited_by is not null');
  });

  // Without a shared lock, a block INSERT and a follow INSERT each miss the
  // other's uncommitted row and BOTH commit — a block with a live follow beside
  // it. Both sides have to take it or it serializes nothing.
  it('serializes block creation against connection creation on the ordered pair', () => {
    expect(FLAT).toContain('perform public.blocked_pair_lock(v_self, v_other);');
    expect(FLAT).toContain(
      'perform public.blocked_pair_lock(new.blocker_id, new.blocked_id);',
    );
    expect(FLAT).toContain(
      "least(a::text, b::text) || '|' || greatest(a::text, b::text)",
    );
  });

  // Two multi-pair inserts locking overlapping sets in different orders deadlock.
  it('locks pairs in a sorted order', () => {
    expect(FLAT).toContain('array_agg(p order by p)');
  });
});

describe('0066 — V8-R-FEED-010 a report names something the reporter can see', () => {
  // The one-report-per-subject index is the anti-flood measure, and arbitrary
  // text walks straight past it: vary the ref, mint another row.
  it('requires the subject ref to be an id, not arbitrary text', () => {
    expect(FLAT).toContain(
      "if btrim(p_subject_ref) !~*"
      + " '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then",
    );
  });

  // A report is a durable, non-withdrawable accusation. A caller who cannot
  // reach the content could otherwise fabricate one about a story they were
  // never shown.
  it('refuses a story the reporter cannot actually see', () => {
    // The kind check is now its own earlier statement, so an unresolvable kind
    // is rejected outright instead of falling through a combined condition.
    // That is stricter, and the visibility check below is now unconditional.
    expect(FLAT).toContain("if p_subject_kind <> 'story' then raise exception");
    expect(FLAT).toContain(
      'if not exists ( select 1 from public.stories s'
      + ' where s.id = btrim(p_subject_ref)::uuid',
    );
    // A retained uuid for gone content is not a story the reporter can see.
    expect(FLAT).toContain('s.deleted_at is null and s.expires_at > now()');
    expect(FLAT).toContain(
      "raise exception 'report_content: that story is not yours to report'",
    );
  });

  it('caps how many NEW subjects one account can report in a day', () => {
    expect(FLAT).toContain(
      "raise exception 'report_content: too many reports from this account today'",
    );
    // Applied to new subjects only: re-reporting must stay idempotent, because
    // the caller hides the content on a returned id and only on a returned id.
    expect(FLAT).toContain(
      'if not exists ( select 1 from public.content_reports cr'
      + ' where cr.reporter_id = auth.uid() and cr.subject_kind = p_subject_kind',
    );
  });
});

describe('0066 — idempotency', () => {
  it('creates every table with if not exists', () => {
    const creates = STATEMENTS.match(/create table[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });

  it('drops each policy before creating it', () => {
    const created = [...STATEMENTS.matchAll(/create policy\s+"([^"]+)"/gi)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(
        SQL,
        `policy ${name} is created without a preceding drop policy if exists`,
      ).toContain(`drop policy if exists "${name}"`);
    }
  });

  // `create trigger` has no IF NOT EXISTS, so a re-run fails outright without
  // the preceding drop — the one shape in this file that breaks a replay.
  it('drops each trigger before creating it', () => {
    const created = [...STATEMENTS.matchAll(/create trigger\s+(\w+)\s+/gi)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(
        FLAT,
        `trigger ${name} is created without a preceding drop trigger if exists`,
      ).toContain(`drop trigger if exists ${name} on`);
    }
  });

  it('creates every index with if not exists', () => {
    const creates = STATEMENTS.match(/create (unique )?index[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement.toLowerCase()).toContain('if not exists');
    }
  });
});
