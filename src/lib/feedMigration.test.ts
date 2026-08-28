import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WP5 round-2 fix guard — static assertions over 0069_feed_and_comments.sql.
 *
 * WHY A TEXT TEST AND NOT A LIVE ONE. No gate in this lane executes SQL, and
 * shared-database operations are forbidden in every lane of this run, so 0069
 * has never been applied anywhere. The audience rules it encodes are proven
 * against a real database at the attended integration gate, exactly as
 * `nightOutsRls.live.test.ts` does for 0044. What is mechanically provable HERE
 * is the security SHAPE of the text, and that is what this file pins — the three
 * predicates a round-1 reviewer found missing, each of which was a silent
 * widening that no local check could have caught.
 *
 * Every assertion below fails if its fix is reverted. That is the whole point:
 * this lane has twice shipped a "fix" whose test could not fail, and the
 * archived review note names that as the same defect wearing the repair.
 */

const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0069_feed_and_comments.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/** The text of one `create policy` statement, by name. */
function policyBody(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  expect(start, `policy ${name} is not defined in 0069`).toBeGreaterThan(-1);
  const end = SQL.indexOf(';\n', start);
  expect(end, `policy ${name} is unterminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

/**
 * One SQL fragment with its `--` comments removed and every run of whitespace
 * collapsed to a single space.
 *
 * A GROUPING TEST HAS TO SEE THE PARENTHESES. Round 2 found the negative regex
 * below asserting nothing: it looked for the veto immediately after
 * `auth.uid() = profile_id`, so moving the veto OUTSIDE the OR — which is the
 * actual defect, and which takes a tagged reporter's own consent row away from
 * them — slipped between the two anchors and stayed green. Matching the whole
 * normalised expression is the only shape that cannot be walked around: any
 * regrouping changes where the brackets fall.
 */
function sqlShape(fragment: string): string {
  return fragment.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The body of one `create or replace function`, by qualified name. */
function functionBody(signature: string): string {
  const start = SQL.indexOf(`create or replace function ${signature}`);
  expect(start, `${signature} is not defined in 0069`).toBeGreaterThan(-1);
  const end = SQL.indexOf('\n$$;', start);
  expect(end, `${signature} is unterminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('0069 — a block is judged between the READER and the COMMENTER', () => {
  // The post gate compares the caller with the post's AUTHOR. A comment adds a
  // third party, so without a second term A could read C's comment on P's post
  // after A blocked C: no predicate on that path ever compared A with C.
  it('the feed_comments read policy compares the caller with the comment author', () => {
    const policy = policyBody('feed_comments: post audience reads');
    expect(policy).toMatch(
      /not public\.is_blocked_between\(\s*auth\.uid\(\),\s*public\.feed_comments\.author_id\s*\)/,
    );
  });

  it('can_view_feed_comment carries the same term, so the report path agrees with the read path', () => {
    const body = functionBody('public.can_view_feed_comment(p_comment_id uuid)');
    expect(body).toMatch(/not public\.is_blocked_between\(\s*auth\.uid\(\),\s*c\.author_id\s*\)/);
  });

  it('the block term is never weakened to a one-directional check', () => {
    // is_blocked_between is symmetric by construction (0066). Asserting the
    // helper is the one asked keeps a future edit from substituting a
    // single-direction lookup, which D-C-30 forbids: blocking is enforced "IN
    // BOTH DIRECTIONS".
    expect(SQL).not.toMatch(/from public\.profile_blocks/);
  });
});

describe('0069 — the reporter hide reaches every surface of the post', () => {
  it('the posts policy vetoes on the caller-scoped report', () => {
    const policy = policyBody('feed_posts: audience reads');
    expect(policy).toMatch(/not public\.feed_post_reported_by_caller\(/);
  });

  it('the tag policy vetoes on it too, so tags do not answer for a hidden post', () => {
    const policy = policyBody('feed_post_tags: readable with post');
    expect(policy).toMatch(/not public\.feed_post_reported_by_caller\(post_id\)/);
  });

  it('a tagged person still reads their OWN tag row, because that is the consent they revoke', () => {
    // The report veto must sit INSIDE the can_view branch, never over the whole
    // policy: hiding your own tag row takes away the control, not the content.
    // Asserted as the whole normalised expression, because the grouping IS the
    // requirement — see `sqlShape`.
    expect(sqlShape(policyBody('feed_post_tags: readable with post'))).toContain(
      'auth.uid() = profile_id'
      + ' or ( public.can_view_feed_post(post_id)'
      + ' and not public.feed_post_reported_by_caller(post_id) )',
    );
  });
});

describe('0069 — a self-reported Feed photo stops signing', () => {
  const body = functionBody('public.media_read_window(p_name text)');

  it('the prior yes is vetoed when the caller reported a live feed post naming these bytes', () => {
    expect(body).toMatch(/public\.feed_post_reported_by_caller\(p\.id\)/);
    // The veto has to be evaluated BEFORE the unconditional pass-through of the
    // prior answer, or it can never run.
    const veto = body.indexOf('feed_post_reported_by_caller(p.id)');
    const passThrough = body.indexOf('return query select v_prior.readable, v_prior.expires_at;');
    expect(veto).toBeGreaterThan(-1);
    expect(passThrough).toBeGreaterThan(-1);
    expect(veto).toBeLessThan(passThrough);
  });

  it('the veto cannot hide a story, because it requires that no live story names the bytes', () => {
    // 0066 already applies its own reporter rule to stories. This file is only
    // entitled to change the answer in the case 0066 could not see: a FEED-ONLY
    // object on the owner's prefix, where 0066's upload-before-publish window
    // says "yes, unbounded".
    expect(body).toMatch(/and not exists \(\s*\n\s*select 1\s*\n\s*from public\.stories s/);
    expect(body).toMatch(/s\.deleted_at is null/);
    expect(body).toMatch(/s\.expires_at > now\(\)/);
  });

  it('the veto stands down when another post on the same bytes is still visible and unreported', () => {
    // Both lanes, round 2: one media object may hold several live Feed
    // destinations, so reporting post A blanked post B's photo for its own
    // owner — and the branch that would have authorised B sits after the veto's
    // `return`, so it could never be reached. The all-unreported term is what
    // 0066's story analogue carries and this one was missing.
    expect(sqlShape(body)).toContain(
      'if v_prior.readable and v_prior.expires_at is null and not v_feed_readable and exists (',
    );
    // ...and that term has to mean the FEED answer, not a constant.
    expect(sqlShape(body)).toContain(
      'v_feed_readable := exists ( select 1 from public.feed_posts p'
      + ' join public.media_objects m on m.id = p.media_id where m.storage_path = p_name'
      + ' and m.bytes_removed_at is null and public.can_view_feed_post(p.id)'
      + ' and not public.feed_post_reported_by_caller(p.id) );',
    );
  });

  it('the veto fires ONLY on the prior unbounded yes, never on a backed one', () => {
    // Rounds 3, 4 and 5 each found a different defect in one term that tried to
    // re-derive "is anything else standing on these bytes" from another lane's
    // destination rows: an ARCHIVE retention hold counted as visible; an EXPIRED
    // story's spine row counted as live, because 0066 expresses story expiry
    // passively through expires_at and never stamps removed_at; and a live GROUP
    // destination counted either way, though only WP6 can say whether this caller
    // can see it. The list was never the problem. Asking the question at all was.
    //
    // 0066's owner branch returns a NULL expiry for the upload-before-publish
    // window and a real expiry whenever its yes is backed by something live it can
    // see, so a readable prior answer with a null expiry is exactly the case 0069
    // may correct.
    expect(sqlShape(body)).toContain(
      'if v_prior.readable and v_prior.expires_at is null and not v_feed_readable',
    );
  });

  it('no destination-kind list survives in the veto', () => {
    // The three defects above were three spellings of the same mistake, so the
    // assertion is against the SHAPE, not against any one spelling of it.
    for (const shape of ["d.kind <> 'feed'", "d.kind not in ('feed', 'archive')"]) {
      expect(
        sqlShape(body),
        'the veto is re-deriving another lane s destination liveness again',
      ).not.toContain(shape);
    }
  });

  it('a report on a post whose Feed destination is already retired vetoes nothing', () => {
    // `deleted_at is null` alone kept vetoing after `remove_media_destination`
    // took the post off the Feed, so a report with nothing left to hide went on
    // hiding the owner's own bytes.
    expect(sqlShape(body)).toContain(
      'and p.deleted_at is null'
      + ' and public.feed_post_destination_is_live(p.id)'
      + ' and public.feed_post_reported_by_caller(p.id)',
    );
  });
});

describe('0069 — a named group is resolved server-side (D-C-37)', () => {
  const body = functionBody('public.publish_feed_post(');

  /**
   * The `'group'` arm of the audience materialisation, from `elsif` to the
   * `on conflict` that closes its statement.
   *
   * A PREFIX ASSERTION IS NOT A WHOLE-BRANCH ASSERTION. Round 3 found the check
   * below matching only the OPENING of this branch, so appending
   * `and gm.profile_id = any(p_audience_ids)` to it left the suite green while
   * handing the caller back the power to narrow a named group — the exact defect
   * the branch was rewritten to remove. Slicing the branch out and asserting
   * against the WHOLE of it is what makes an addition visible.
   */
  function groupBranch(): string {
    const shaped = sqlShape(body);
    const start = shaped.indexOf("elsif p_audience = 'group' then");
    expect(start, "the group branch is not in publish_feed_post").toBeGreaterThan(-1);
    const end = shaped.indexOf('on conflict do nothing;', start);
    expect(end, 'the group branch is unterminated').toBeGreaterThan(start);
    return shaped.slice(start, end + 'on conflict do nothing;'.length);
  }

  it('the group branch contains the intersection and NOTHING ELSE', () => {
    // Whole-branch equality, not containment: any extra term — a caller-list
    // filter, a silent narrowing, an added join — changes this string.
    expect(groupBranch()).toBe(
      "elsif p_audience = 'group' then"
      + ' insert into public.feed_post_audience (post_id, profile_id)'
      + ' select distinct v_id, gm.profile_id'
      + ' from public.group_members gm'
      + ' where gm.group_id = p_group_id'
      + ' and gm.profile_id <> v_author'
      + ' and public.is_mutual_friend(v_author, gm.profile_id)'
      + ' and exists ( select 1 from public.group_members me'
      + ' where me.group_id = p_group_id and me.profile_id = v_author )'
      + ' on conflict do nothing;',
    );
  });

  it('the caller-supplied list cannot reach the group branch', () => {
    // The named defect, stated as its own case so the reason survives a reword.
    expect(
      groupBranch(),
      'the caller list is back in the group branch, narrowing a named group',
    ).not.toContain('p_audience_ids');
  });

  it('the tag write re-asserts mutuality for EVERY arm that is not the poster', () => {
    // Round 4 put this re-check on the 'friends' arm alone, reasoning that custom
    // and group were covered by feed_post_audience rows written in-transaction.
    // Round 5 (MEDIUM, both lanes) found that wrong by one statement: the audience
    // insert judged mutuality in ITS snapshot and the recipient-count select runs
    // between it and the tag insert, so the window is open there too. The term is
    // hoisted out of the arms and applied to all of them — the shape, not another
    // instance of it.
    expect(sqlShape(body)).toContain(
      'where ids.distinct_id = v_author'
      + ' or ( public.is_mutual_friend(v_author, ids.distinct_id)'
      + " and ( p_audience = 'friends'"
      + ' or exists ( select 1 from public.feed_post_audience fa'
      + ' where fa.post_id = v_id and fa.profile_id = ids.distinct_id ) ) )',
    );
  });

  it('no arm of the tag write can admit somebody without that check', () => {
    // The defect twice over was an arm reachable WITHOUT is_mutual_friend. Both
    // previous spellings are named so a revert to either is caught.
    for (const shape of [
      "ids.distinct_id = v_author or p_audience = 'friends' or exists",
      "or ( p_audience = 'friends' and public.is_mutual_friend(v_author, ids.distinct_id) ) or exists",
    ]) {
      expect(
        sqlShape(body),
        'an arm of the tag insert admits a recipient without re-checking mutuality',
      ).not.toContain(shape);
    }
  });

  it('the poster membership that authorises the post is read in the SAME statement', () => {
    // Round 3 (HIGH, codex): the guard is a separate statement, so at READ
    // COMMITTED it sees a different snapshot from the enumeration. A poster
    // removed from the group between the two published into a group they had
    // already left, because the surviving members still resolved. One statement,
    // one snapshot.
    expect(groupBranch()).toContain(
      'and exists ( select 1 from public.group_members me'
      + ' where me.group_id = p_group_id and me.profile_id = v_author )',
    );
  });

  it('a group audience is enumerated FROM THE GROUP, not filtered from the caller list', () => {
    // Round 2 (HIGH) found the insert filtering the caller's ids by mutual
    // friendship and never resolving p_group_id. Round 3 (HIGH, both lanes) found
    // the repair still wrong in the other direction: filtering the caller's list
    // BY group membership closes only the widening half, and a caller passing one
    // member of G published a one-person post stamped audience_group_id = G.
    // D-C-37 is an EQUALITY — recipients EQUAL the selected group intersected with
    // the poster's mutual friends — so the candidate set has to be the group.
    expect(sqlShape(body)).toContain(
      "elsif p_audience = 'group' then"
      + ' insert into public.feed_post_audience (post_id, profile_id)'
      + ' select distinct v_id, gm.profile_id'
      + ' from public.group_members gm'
      + ' where gm.group_id = p_group_id'
      + ' and gm.profile_id <> v_author'
      + ' and public.is_mutual_friend(v_author, gm.profile_id)',
    );
  });

  it('the caller-supplied list reaches the audience only for a custom audience', () => {
    // p_audience_ids must not appear in the group branch at all. Asserting the
    // custom branch owns it is what makes "ignored for a group" mechanical rather
    // than a claim in a comment.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'custom' then"
      + ' insert into public.feed_post_audience (post_id, profile_id)'
      + ' select v_id, ids.distinct_id'
      + ' from (select distinct unnest(p_audience_ids) as distinct_id) ids',
    );
  });

  it('the poster must be in the group before anything enumerates it', () => {
    // publish_feed_post is SECURITY DEFINER, so the group_members read above
    // bypasses that table's RLS. This guard is the only thing standing between a
    // definer enumeration and a group the caller has no part in.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'group'"
      + ' and not public.is_group_member(p_group_id, v_author) then',
    );
  });

  it('a group audience still cannot be published without a group to resolve', () => {
    // The group branch reads p_group_id, so the guard that makes it non-null for
    // 'group' is load-bearing rather than a message.
    expect(sqlShape(body)).toContain(
      "if p_audience = 'group' and p_group_id is null then");
  });

  it('an empty intersection FAILS CLOSED instead of publishing to nobody', () => {
    // Round 3 (MEDIUM): the suite pinned the intersection and the null-group guard
    // but not the raise, so deleting the whole fail-closed block left every gate
    // green. "If the mutual-friend set cannot be resolved the action FAILS CLOSED
    // rather than delivering to the unintersected group" — a post whose audience
    // table is empty reads to its author as delivered.
    expect(sqlShape(body)).toContain(
      "if p_audience <> 'friends' then"
      + ' select count(*)::int into v_recipients'
      + ' from public.feed_post_audience fa'
      + ' where fa.post_id = v_id;'
      + ' if v_recipients = 0 then',
    );
    expect(body).toMatch(/raise exception\s*\n\s*'publish_feed_post: nobody in that audience/);
  });
});

describe('0069 — you may only report what you can still see', () => {
  const body = functionBody('public.report_content(');

  it('a caller who hid the POST cannot then file a durable report on its comments', () => {
    // Round 3 (MEDIUM, codex): the comments read policy vetoes on
    // feed_post_reported_by_caller as well as the comment's own hide, so once the
    // caller reports the post every comment beneath it is gone from their Feed.
    // can_view_feed_comment deliberately omits the reporter hide — that is what
    // keeps a REPEAT report idempotent — so the report path has to add the
    // parent-post term itself, or it accepts a fresh accusation about content the
    // accuser can no longer see.
    expect(sqlShape(body)).toContain(
      'or exists ( select 1 from public.feed_comments c where c.id = v_ref::uuid'
      + ' and public.feed_post_reported_by_caller(c.post_id) )',
    );
  });

  it('the comment’s OWN hide stays out of that term, so a repeat report is still idempotent', () => {
    // If feed_comment_reported_by_caller were added here, the second report of the
    // same comment would raise instead of returning the existing id, and the
    // caller — which hides only on a returned id — would fail to hide it.
    expect(
      sqlShape(body),
      'the repeat-report path was broken by folding the comment hide into the gate',
    ).not.toContain('public.feed_comment_reported_by_caller(');
  });
});

describe('0069 — the column-scoped tag grant is actually scoped', () => {
  it('every revoke actually PRECEDES the grants it is supposed to precede', () => {
    // Round 3 (MEDIUM, codex): the case below asserted only that both statements
    // exist, so moving the revokes BELOW the grants kept it green — and that
    // ordering leaves authenticated with no SELECT on any Feed table and no
    // UPDATE(removed_at), which silently disables reads and tag-consent
    // withdrawal for everyone. Existence was never the requirement. Order is.
    const lastRevoke = Math.max(
      ...['feed_posts', 'feed_post_audience', 'feed_post_tags', 'feed_comments'].map(
        (table) => SQL.indexOf(`revoke all on public.${table} from public, anon, authenticated;`),
      ),
    );
    const firstGrant = Math.min(
      ...['feed_posts', 'feed_post_audience', 'feed_post_tags', 'feed_comments'].map(
        (table) => SQL.indexOf(`grant select on public.${table}`),
      ),
    );
    expect(lastRevoke, 'a revoke is missing entirely').toBeGreaterThan(-1);
    expect(firstGrant, 'a select grant is missing entirely').toBeGreaterThan(-1);
    expect(
      lastRevoke,
      'a revoke runs AFTER a grant, which withdraws the access the grant just gave',
    ).toBeLessThan(firstGrant);
    expect(
      lastRevoke,
      'the tag consent-withdrawal grant is revoked away after being granted',
    ).toBeLessThan(SQL.indexOf('grant update (removed_at) on public.feed_post_tags'));
  });

  it('authenticated is revoked from every new table before anything is granted back', () => {
    // Round 3 (MEDIUM, codex): Supabase's default privileges grant ALL on new
    // public tables to `authenticated`, and a later `grant update (removed_at)`
    // only ever ADDS to that. Without this revoke the column list was decorative
    // and a tagged person could PATCH their own feed_post_tags row's post_id onto
    // any post id they knew, bypassing publication's audience, mutual-friend and
    // block checks — feed_post_tags being the one of the four tables whose UPDATE
    // policy admits the write at all.
    for (const table of ['feed_posts', 'feed_post_audience', 'feed_post_tags', 'feed_comments']) {
      expect(
        sqlShape(SQL),
        `${table} still leaves authenticated its default table-level grant`,
      ).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
  });

  it('the only write granted on a tag row is the consent withdrawal column', () => {
    expect(SQL).toMatch(
      /grant update \(removed_at\) on public\.feed_post_tags to authenticated;/,
    );
    // No table-wide UPDATE anywhere, which is what the revoke above exists to stop
    // being re-granted by a later edit.
    expect(SQL).not.toMatch(/grant update on public\.feed_post_tags/);
  });
});
