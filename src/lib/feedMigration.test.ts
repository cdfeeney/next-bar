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

/**
 * THE SUBJECT IS THE EFFECTIVE SQL, NOT ONE FILE — and that changed on
 * 2026-08-31, not because the guards got weaker.
 *
 * Phase C applied 0069 to production while this lane was still in review, so its
 * bytes are fenced by `public.schema_migrations` and the round-9 consolidation
 * could no longer be delivered by editing it. 0076 states the same work forward.
 * A test that kept reading 0069 alone would now be pinning a shape the database
 * does not have — green for text nothing runs — so it reads the pair, in the
 * order Postgres applies them, and resolves each object to its LAST definition.
 *
 * `appliedMigrationIdentity.test.ts` is the other half of this: it asserts 0069's
 * checksum still equals the value the ledger recorded, so "the effective text
 * changed" can only ever mean 0076 changed.
 */
const FILES = [
  '0069_feed_and_comments.sql',
  '0076_feed_access_consolidation_and_group_read_window.sql',
] as const;

const SQL = FILES
  .map((file) => readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', file), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');

/**
 * The same text with `--` comments removed.
 *
 * Every "is this statement still here, and is it the LAST one" check reads THIS,
 * not SQL. A statement commented out is a statement gone, and over the raw string
 * the drop of `is_feed_post_recipient` could be commented out with every case in
 * this file still green — a guard satisfied by the text of its own explanation.
 * Whitespace is left alone so exact statement text still matches.
 */
const CODE = SQL.replace(/--[^\n]*/g, ' ');

/** The text of one `create policy` statement, by name. */
function policyBody(name: string): string {
  // lastIndexOf, because a policy redefined by 0076 is dropped and re-created:
  // the FIRST occurrence is 0069's superseded text, and asserting over it would
  // pass while the live policy said something else.
  const start = SQL.lastIndexOf(`create policy "${name}"`);
  expect(start, `policy ${name} is not defined by the effective migration set`).toBeGreaterThan(-1);
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

/**
 * Assert a `language sql` function ENDS with `expected`, not merely contains it.
 *
 * Round 10 (MEDIUM, codex; carried to g-7050b7b7): `toContain` over a whole
 * normalised body is SATISFIABLE BY APPENDING. A `language sql` function returns
 * its FINAL query, so a second `select` written after the guarded one leaves the
 * guard in the file, the assertion green, and the guard no longer the answer.
 * Pinning the tail is what makes the guarded select the statement that runs.
 *
 * Compared as a slice rather than with `endsWith` so a failure prints the two
 * strings side by side; a boolean here says only that something moved.
 */
function expectTerminalSelect(body: string, expected: string, what: string): void {
  expect(body.slice(-expected.length), `${what} is not the TERMINAL statement of the body`)
    .toBe(expected);
}

/** The body of one `create or replace function`, by qualified name. */
function functionBody(signature: string): string {
  // lastIndexOf, for the same reason as policyBody: `create or replace` means the
  // last statement is the one the database ends up holding.
  const start = SQL.lastIndexOf(`create or replace function ${signature}`);
  expect(start, `${signature} is not defined by the effective migration set`).toBeGreaterThan(-1);
  const end = SQL.indexOf('\n$$;', start);
  expect(end, `${signature} is unterminated`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

/**
 * The body of the REPORTING implementation, wherever it currently lives.
 *
 * 0075 renamed the implementation aside to `report_content_before_0075` and put a
 * repeat short-circuit in front of it under the old name, so the visibility checks
 * these cases pin are in the renamed function and 0076 corrects them there.
 * Resolving the name here rather than in each case keeps one answer: pinning the
 * wrapper would assert over a body that contains no visibility check at all, and
 * every case below would go green for the wrong reason.
 */
function reportImplBody(): string {
  return SQL.includes('create or replace function public.report_content_before_0075(')
    ? functionBody('public.report_content_before_0075(')
    : functionBody('public.report_content(');
}

/**
 * Is `signature` executable by `authenticated` after the whole set has run?
 *
 * LAST STATEMENT WINS, which is the only reading that survives a forward
 * migration: 0069 granted `can_view_feed_comment` and 0076 revokes it, so a
 * `not.toContain` over the concatenated text would fail on 0069's superseded
 * grant and report that the oracle was still open.
 */
function grantedToAuthenticated(signature: string): boolean {
  return CODE.lastIndexOf(`grant execute on function ${signature} to authenticated;`)
    > CODE.lastIndexOf(`revoke all on function ${signature} from public, anon`);
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

/**
 * ROUND 9 — the audience rule is written ONCE and every surface asks it.
 *
 * Round 8 returned three CRITICALs against three different Feed surfaces, and the
 * operator's directive named them as one defect: access was checked per-policy, so
 * each policy re-derived who may see a post and the copies drifted. This block
 * pins the consolidation itself — not three patched instances.
 */
describe('0069 — one definition of the Feed audience gate', () => {
  it('the gate takes the VIEWER as a parameter, which is what let the copies collapse', () => {
    // Every one of the three CRITICALs came from a surface that needed to know
    // whether somebody OTHER than auth.uid() could still see the post, against a
    // predicate that could only answer about auth.uid(). Without the parameter the
    // consolidation is not expressible and the inline copies come back.
    expect(sqlShape(functionBody('public.feed_post_visible_to('))).toContain(
      'create or replace function public.feed_post_visible_to( p_viewer uuid, p_post_id uuid )',
    );
  });

  it('mutuality, the audience and both liveness terms live in that one function', () => {
    const body = sqlShape(functionBody('public.feed_post_visible_to('));
    expect(body).toContain('p.deleted_at is null');
    expect(body).toContain('public.feed_post_destination_is_live(p.id)');
    expect(body).toContain('public.is_mutual_friend(p_viewer, p.author_id)');
    expect(body).toContain("p.audience = 'friends'");
    expect(body).toContain('from public.feed_post_audience fa where fa.post_id = p.id and fa.profile_id = p_viewer');
  });

  it('the hide is added by can_view_feed_post, on top of the same gate', () => {
    // NAMED BY ITS FIRST PARAMETER, because the resolver takes the LAST definition
    // and the caller-scoped one-argument overload is written after this one. A bare
    // `can_view_feed_post(` would resolve to that overload and this case would then
    // assert the wrong function's tail.
    // TERMINAL, for the reason on `expectTerminalSelect`: these two are the same
    // satisfiable shape the party guard was found in, over the gate that ADDS the
    // hide. Fixing only the assertion the finding named would leave the identical
    // hole one screen above it.
    expectTerminalSelect(
      sqlShape(functionBody('public.can_view_feed_post(\n  p_viewer uuid,')),
      'select public.feed_post_visible_to(p_viewer, p_post_id)'
      + ' and not public.feed_post_reported_by(p_viewer, p_post_id);',
      'the hide-adding gate',
    );
  });

  it('the caller-scoped spelling is the two-argument one with auth.uid(), so the overload cannot mean two things', () => {
    expectTerminalSelect(
      sqlShape(functionBody('public.can_view_feed_post(p_post_id uuid)')),
      'select public.can_view_feed_post(auth.uid(), p_post_id);',
      'the caller-scoped overload',
    );
  });

  it('NO policy re-implements any part of the rule inline', () => {
    // The actual requirement of the round-9 directive, and the only assertion here
    // that fails on the shape the three CRITICALs shared: a policy that reaches for
    // mutuality, the audience table, or the hide on its own has started a fourth
    // copy of the gate. Two things are deliberately NOT on this list because they
    // are different facts rather than restatements: `is_blocked_between`, where the
    // comment and tag policies judge a THIRD party the post gate never sees, and
    // `feed_comments.deleted_at`, which is the COMMENT's own liveness — no
    // post-level gate can know it.
    for (const name of [
      'feed_posts: audience reads',
      'feed_post_audience: parties read',
      'feed_post_tags: readable with post',
      'feed_post_tags: subject removes own',
      'feed_comments: post audience reads',
    ]) {
      const policy = sqlShape(policyBody(name));
      expect(policy, `${name} re-derives mutuality instead of asking the gate`)
        .not.toContain('public.is_mutual_friend(');
      expect(policy, `${name} reads the audience table instead of asking the gate`)
        .not.toContain('public.feed_post_audience fa');
      expect(policy, `${name} restates the post-level reporter hide instead of asking the gate`)
        .not.toContain('public.feed_post_reported_by_caller(');
      expect(policy, `${name} restates the POST's liveness instead of asking the gate`)
        .not.toContain('public.feed_posts p');
      expect(policy, `${name} restates destination liveness instead of asking the gate`)
        .not.toContain('public.feed_post_destination_is_live(');
    }
  });

  it('the arbitrary-viewer functions are executable by NO application role', () => {
    // An RLS policy expression runs with the CALLER's privileges, so anything a
    // policy names has to be granted to `authenticated`. That is exactly why the
    // viewer-parametrised pair must NOT be: a grant would let any account ask
    // whether any other account can see, or has reported, any post whose uuid it
    // holds — a strictly worse oracle than the one round 8 found.
    for (const signature of [
      'public.feed_post_visible_to(uuid, uuid)',
      'public.can_view_feed_post(uuid, uuid)',
      'public.feed_post_reported_by(uuid, uuid)',
    ]) {
      expect(SQL, `${signature} is not revoked from authenticated`).toContain(
        `revoke all on function ${signature} from public, anon, authenticated;`,
      );
      expect(
        grantedToAuthenticated(signature),
        `${signature} is granted to authenticated, making it an oracle`,
      ).toBe(false);
    }
  });

  it('the ONE granted hide-free helper carries its party guard, and the guard is the whole of it', () => {
    // Round 9 (CRITICAL, codex): feed_post_visible_to_party is SECURITY DEFINER,
    // granted, takes a caller-supplied post id and deliberately ignores the
    // caller's own report — so its guard is the only thing standing between it and
    // a liveness oracle over content the caller has HIDDEN. The guard was
    // "yourself, or anybody if you authored the post", and the self half let any
    // authenticated holder of a post uuid poll it. The self arm now also requires a
    // real feed_post_tags row, which is exactly the consent-surface population that
    // needs the question.
    //
    // Round 9 (MEDIUM, codex): none of this was pinned at all — the guard could be
    // deleted outright while every other assertion stayed green. Whole normalised
    // body, so a widened or removed term cannot slip past.
    expectTerminalSelect(
      sqlShape(functionBody('public.feed_post_visible_to_party(')),
      'select ( auth.uid() is not null'
      + ' and p_post_id is not null'
      + ' and p_profile_id is not null'
      + ' and ( public.is_feed_post_author(p_post_id, auth.uid())'
      + ' or ( p_profile_id = auth.uid()'
      + ' and exists ( select 1 from public.feed_post_tags t'
      + ' where t.post_id = p_post_id and t.profile_id = auth.uid() ) ) ) )'
      + ' and public.feed_post_visible_to(p_profile_id, p_post_id);',
      'the party guard',
    );
  });

  it('the hide-free helpers a DEFINER can reach are not granted to an application role', () => {
    // Round 9 (CRITICAL, codex). can_view_feed_comment is hide-free by design and
    // was granted to authenticated, so a caller who had reported a comment could
    // still poll whether it was live. Its only caller is report_content, which is
    // SECURITY DEFINER and holds EXECUTE as the owner, so the grant bought nothing
    // and cost an oracle. Same reasoning that keeps feed_post_destination_is_live
    // un-granted.
    expect(SQL).toContain(
      'revoke all on function public.can_view_feed_comment(uuid) from public, anon, authenticated;',
    );
    expect(
      grantedToAuthenticated('public.can_view_feed_comment(uuid)'),
      'can_view_feed_comment is granted to an application role again',
    ).toBe(false);
    // And the two definer verbs ask the INTERNAL rule, not the granted wrapper —
    // routing them through a grantable entry point is what forced its guard wide.
    expect(sqlShape(reportImplBody()), 'report_content asks the granted wrapper again')
      .not.toContain('public.feed_post_visible_to_party(');
    expect(sqlShape(functionBody('public.can_view_feed_comment(')), 'can_view_feed_comment asks the granted wrapper again')
      .not.toContain('public.feed_post_visible_to_party(');
  });

  it('is_feed_post_recipient is GONE, not merely un-granted', () => {
    // Round 8 (CRITICAL, codex): SECURITY DEFINER, granted to authenticated, guarded
    // only by "answer about your own id" — so a recipient who kept a post uuid could
    // still read their audience membership after unfollowing, being blocked,
    // reporting the post, or the author deleting it. Its job moved inside the gate,
    // so the function itself is dropped: what does not exist cannot be granted back.
    // ORDER, not absence. 0069 still CREATES it — those bytes are applied and
    // frozen — so the requirement is that the drop is the LAST word on the name.
    // CODE, never SQL. Commenting the drop out leaves its text in the file, and
    // over the raw string this case stayed GREEN with the oracle un-dropped — the
    // same guard-passes-on-its-own-explanation shape `code()` was added to
    // groups.server.test.ts to close. Verified by mutation, not by inspection.
    const dropped = CODE.lastIndexOf('drop function if exists public.is_feed_post_recipient(uuid, uuid);');
    expect(dropped, 'the drop is gone or commented out').toBeGreaterThan(-1);
    expect(
      CODE.lastIndexOf('create or replace function public.is_feed_post_recipient('),
      'the retired audience oracle is redefined after it is dropped',
    ).toBeLessThan(dropped);
    expect(
      CODE.lastIndexOf('grant execute on function public.is_feed_post_recipient'),
      'the retired audience oracle is granted after it is dropped',
    ).toBeLessThan(dropped);
  });
});

describe('0069 — the reporter hide reaches every surface of the post', () => {
  it('the posts policy is exactly the gate, and the gate carries the hide', () => {
    // The veto used to be a second term in this policy. It is inside
    // `can_view_feed_post` as of round 9, so the requirement is now that this policy
    // asks the gate and nothing else — asserted as the whole normalised expression,
    // because "and nothing else" is the part that can silently regress.
    expect(sqlShape(policyBody('feed_posts: audience reads'))).toContain(
      'using ( public.can_view_feed_post(public.feed_posts.id) )',
    );
  });

  it('a tagged person still reads their OWN tag row, because that is the consent they revoke', () => {
    // The hide must not reach the own-row arm: hiding your own tag row takes away
    // the control, not the content. That is why this arm asks the PARTY spelling
    // (the rule without the hide) rather than `can_view_feed_post`.
    //
    // Round 8 (CRITICAL, codex): the arm was a bare `auth.uid() = profile_id` and
    // asked nothing else, so identity stood in for entitlement — the row stayed
    // readable after a block, after the two stopped being mutual friends, and after
    // the post was deleted or its destination retired.
    //
    // Asserted as the whole normalised USING CLAUSE — `using ( ` through its
    // closing paren — because the grouping IS the requirement, see `sqlShape`.
    //
    // Round 9 (MEDIUM, claude): this assertion used to start at `(auth.uid()` and
    // stop at the second arm's inner paren, so it pinned an interior SUBSTRING
    // while its three siblings pinned whole clauses. A widening disjunct added
    // anywhere outside it — `using ( true or ( ...the pinned text... ) )` — left
    // the substring intact and every one of the suite's assertions green, while
    // feed_post_tags became readable to every authenticated account. The negative
    // loop above screens five specific substrings and none of them appear in such
    // a widening. Anchoring both ends is what makes "and nothing else" real.
    expect(sqlShape(policyBody('feed_post_tags: readable with post'))).toContain(
      'using ( (auth.uid() = profile_id'
      + ' and public.feed_post_visible_to_party(post_id, auth.uid()))'
      + ' or ( public.can_view_feed_post(post_id)'
      + ' and not public.is_blocked_between(auth.uid(), public.feed_post_tags.profile_id) ) )',
    );
  });

  it('the tag WITHDRAWAL carries the same gate, on both USING and WITH CHECK', () => {
    // The write half of the same CRITICAL: identity alone let a tagged person keep
    // patching removed_at on a post they could no longer see. WITH CHECK as well as
    // USING, or the update could move the row out of the gate it just passed.
    expect(sqlShape(policyBody('feed_post_tags: subject removes own'))).toContain(
      'using ( auth.uid() = profile_id'
      + ' and public.feed_post_visible_to_party(post_id, auth.uid()) )'
      + ' with check ( auth.uid() = profile_id'
      + ' and public.feed_post_visible_to_party(post_id, auth.uid()) )',
    );
  });

  it('the AUDIENCE rows ask the gate once for the caller, and again for the recipient the row names', () => {
    // Round 7 (MEDIUM, codex): feed_post_audience was the one Feed surface with
    // neither gate. Round 8 (CRITICAL, codex): the author arm then asked only "am I
    // the author, and have we not blocked each other" — a partial, inline copy of an
    // audience rule that lives elsewhere — so after R merely UNFOLLOWED P, with no
    // block at all, P kept receiving R's row for a post R could no longer see.
    //
    // The caller's gate is hoisted over both arms (one call, not one per arm), and
    // the author arm asks the rule about R through the PARTY spelling so that R's own
    // reporter hide never leaks to P. Whole-expression, because the grouping IS the
    // requirement.
    expect(sqlShape(policyBody('feed_post_audience: parties read'))).toContain(
      'using ( public.can_view_feed_post(post_id)'
      + ' and ( auth.uid() = public.feed_post_audience.profile_id'
      + ' or ( public.is_feed_post_author(post_id, auth.uid())'
      + ' and public.feed_post_visible_to_party(post_id, public.feed_post_audience.profile_id) ) ) )',
    );
  });

  it('the author arm is not gated by the pair term alone', () => {
    // The round-8 defect, named so a revert to it is caught by its own case rather
    // than only by the whole-expression check above.
    expect(
      sqlShape(policyBody('feed_post_audience: parties read')),
      'the audience author arm is back to judging only the block, which unfollowing walks past',
    ).not.toContain(
      'public.is_feed_post_author(post_id, auth.uid())'
      + ' and not public.is_blocked_between(auth.uid(), public.feed_post_audience.profile_id)',
    );
  });

  it('the recipient arm is not gated by a self-comparison', () => {
    // The round-7 defect, kept for the same reason.
    expect(
      sqlShape(policyBody('feed_post_audience: parties read')),
      'the audience policy is back to comparing the caller with itself',
    ).not.toContain(
      '( auth.uid() = profile_id or public.is_feed_post_author(post_id, auth.uid()) )'
      + ' and not public.is_blocked_between',
    );
  });

  it('the reader/tagged-person block sits INSIDE the can_view branch, not over the whole policy', () => {
    // Round 6 (HIGH, claude): a tag is a third party, exactly as a comment is, and
    // can_view_feed_post only judges the caller against the post's AUTHOR. Without
    // this term A could read C's tag row — and the card rendered C's name — after
    // A blocked C, because nothing on the path compared A with C. The comments
    // policy already carried it; this one was missed.
    //
    // Grouping is the requirement again: on the own-row arm it would take away the
    // consent control instead of the content, so the whole-expression assertion
    // above is what pins where it sits.
    expect(sqlShape(policyBody('feed_post_tags: readable with post'))).toContain(
      'and not public.is_blocked_between(auth.uid(), public.feed_post_tags.profile_id)',
    );
  });
});

describe('0069 — a self-reported Feed photo stops signing', () => {
  const body = functionBody('public.media_read_window(p_name text)');

  it('the prior yes is vetoed when the caller reported a live feed post naming these bytes', () => {
    expect(body).toMatch(/public\.feed_post_reported_by_caller\(p\.id\)/);
    // The veto has to be evaluated BEFORE the unconditional pass-through of the
    // prior answer, or it can never run.
    //
    // Round 8 (MEDIUM, claude): this used to anchor on the first occurrence of
    // `feed_post_reported_by_caller(p.id)`, which is inside the v_feed_readable
    // ASSIGNMENT near the top of the function — always before the pass-through,
    // wherever the veto block itself sits. Moving the whole veto below the
    // pass-through left it green with the veto as dead code. Anchor on the veto's
    // own opening condition, which is unique to the block.
    const veto = sqlShape(body).indexOf(
      'if v_prior.readable and v_prior.expires_at is null and not v_feed_readable',
    );
    const passThrough = sqlShape(body).indexOf(
      'if v_prior.readable then return query select v_prior.readable, v_prior.expires_at;',
    );
    expect(veto, 'the veto block is gone').toBeGreaterThan(-1);
    expect(passThrough, 'the prior-answer pass-through is gone').toBeGreaterThan(-1);
    expect(
      veto,
      'the veto now runs after the pass-through returns, so it is dead code',
    ).toBeLessThan(passThrough);
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
    // ...and that term has to mean the FEED answer, not a constant. The separate
    // `and not feed_post_reported_by_caller(p.id)` this line used to carry is gone
    // because the gate carries the hide as of round 9 — same meaning, one spelling.
    expect(sqlShape(body)).toContain(
      'v_feed_readable := exists ( select 1 from public.feed_posts p'
      + ' join public.media_objects m on m.id = p.media_id where m.storage_path = p_name'
      + ' and m.bytes_removed_at is null and public.can_view_feed_post(p.id) );',
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

  it('a live destination this file does not own also stands the veto down', () => {
    // Round 6 (MEDIUM, codex): the null-expiry discriminator is NECESSARY but not
    // SUFFICIENT. It says the prior answer was unbounded; it does not say nothing
    // else is standing on the bytes. An owner whose media is live in a group
    // destination AND in a reported Feed post gets (true, null) from 0066's owner
    // branch, so the discriminator alone blanked a group photo they can still see.
    // Both terms, therefore.
    expect(sqlShape(body)).toContain(
      'and not exists ( select 1 from public.media_destinations d'
      + ' join public.media_objects m on m.id = d.media_id'
      + ' where m.storage_path = p_name'
      + " and d.kind not in ('feed', 'archive')"
      + ' and d.removed_at is null',
    );
  });

  it('an EXPIRED story destination does not count as live, per 0066 own rule', () => {
    // Round 5 (HIGH, claude): story expiry is passive — 0066 never stamps
    // removed_at on a story spine row — so `removed_at is null` alone counted a
    // long-dead story as somewhere the photo still lives, and the veto never
    // fired. media_live_reference_count carries exactly this clause; it is copied
    // rather than re-derived, which is what the three earlier attempts did wrong.
    expect(sqlShape(body)).toContain(
      "and ( d.kind <> 'story'"
      + ' or exists ( select 1 from public.stories s2'
      + ' where s2.id::text = d.ref_id'
      + ' and s2.deleted_at is null'
      + ' and s2.expires_at > now() ) )',
    );
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

describe('0069 — a write carries its own authorization, not an older snapshot', () => {
  it('the comment insert re-asserts the read gate in the SAME statement', () => {
    // Round 6 (HIGH, codex): the visibility check and the insert were separate
    // statements with an ADVISORY LOCK WAIT between them, so a caller blocked by
    // the post's author while queued on the comment cap still committed a comment
    // every other audience member could read. `insert ... select ... where` puts
    // the predicate and the row on one snapshot.
    const body = functionBody('public.add_feed_comment(');
    expect(sqlShape(body)).toContain(
      'insert into public.feed_comments (post_id, author_id, body)'
      + ' select p_post_id, v_author, v_body'
      + ' where public.can_view_feed_post(p_post_id)',
    );
    expect(
      sqlShape(body),
      'the comment insert is unconditional again, so a lock wait can outlive the check',
    ).not.toContain('insert into public.feed_comments (post_id, author_id, body) values');
    // AND THE BRANCH SENSE. Round 7 (MEDIUM, codex): flipping `if not found` to
    // `if found` makes every AUTHORIZED insert raise and roll back, and the
    // assertion above still passed because it only reads the INSERT text.
    expect(
      sqlShape(body),
      'the zero-rows branch is inverted, so a permitted comment now raises',
    ).toContain('if not found then raise exception');
  });

  it('a report re-checks the entitlement AFTER the durable record is written', () => {
    // Same shape, and it cannot be closed the same way: record_content_report is
    // shared with the branches this file delegates to, so its insert cannot carry
    // a predicate only this branch knows. Re-checking on the latest snapshot and
    // raising rolls the whole transaction back, insert included.
    //
    // Round 7 (MEDIUM, both lanes): the first version of this case asserted only
    // that two substrings existed. It stayed green when the comment arm was
    // deleted (the post arm's message satisfied the toContain on its own), and it
    // stayed green when both re-checks were moved ABOVE the write, which is the
    // whole point of the fix. Order and both arms, therefore.
    const body = sqlShape(reportImplBody());
    const wrote = body.indexOf('v_id := public.record_content_report(p_subject_kind, v_ref, p_reason);');
    const postArm = body.indexOf('that post stopped being yours to report');
    const commentArm = body.indexOf('that comment stopped being yours to report');

    expect(wrote, 'the durable record is not written through v_id any more').toBeGreaterThan(-1);
    expect(postArm, 'the feed_post arm of the post-write re-check is gone').toBeGreaterThan(-1);
    expect(commentArm, 'the comment arm of the post-write re-check is gone').toBeGreaterThan(-1);
    expect(
      postArm,
      'the post-write re-check runs BEFORE the write, which is the window it exists to close',
    ).toBeGreaterThan(wrote);
    expect(
      commentArm,
      'the post-write re-check runs BEFORE the write, which is the window it exists to close',
    ).toBeGreaterThan(wrote);
    // And the branch sense ON BOTH ARMS: dropping either `not` makes every
    // permitted report of that kind write and immediately roll back, with both
    // messages still present and in order.
    //
    // Round 9 (MEDIUM, claude): the previous version of this pair searched the WHOLE
    // body, and the pre-write check at the top of the function is the identical text
    // — so flipping the `not` on the POST-write arm, or deleting the parent-post term
    // from the post-write COMMENT arm, left both assertions matching the pre-write
    // occurrences and the suite green. That is the same shape as the round-7 defect
    // it was written to close: an assertion satisfied by a copy of the thing it meant
    // to pin. Search from `wrote` onward, so only the post-write occurrence can
    // satisfy it.
    const afterWrite = body.slice(wrote);
    expect(
      afterWrite,
      'the post-write feed_post arm is inverted, so every permitted post report rolls back',
    ).toContain('if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then raise exception');
    expect(
      afterWrite,
      'the post-write comment arm is inverted, so every permitted comment report rolls back',
    ).toContain('elsif not public.can_view_feed_comment(v_ref::uuid)');
    expect(
      afterWrite,
      'the post-write comment arm no longer refuses a caller who has hidden the PARENT post',
    ).toContain(
      'or exists ( select 1 from public.feed_comments c where c.id = v_ref::uuid'
      + ' and public.feed_post_reported_by_caller(c.post_id) )',
    );
  });

  it('the post-write re-check asks the HIDE-FREE gate, or every first report rolls itself back', () => {
    // Round 9: `can_view_feed_post` gained the caller's reporter hide, and the
    // post-write re-check runs AFTER this caller's own report has been written. Ask
    // the hide-carrying spelling there and the check fails on the row the same
    // transaction just inserted — every first feed_post report would roll back. The
    // party spelling is hide-free for exactly this reason, and the pre-write check
    // asks it too so that a REPEAT report stays idempotent.
    const body = sqlShape(reportImplBody());
    expect(
      body,
      'the report path asks the hide-carrying gate, so a report undoes itself',
    ).not.toContain('public.can_view_feed_post(v_ref::uuid)');
    expect(body).toContain('public.feed_post_visible_to(auth.uid(), v_ref::uuid)');
  });
});

describe('0069 — you may only report what you can still see', () => {
  const body = reportImplBody();

  it('a caller who hid the POST cannot then file a durable report on its comments', () => {
    // Round 3 (MEDIUM, codex): the comments read policy vetoes on
    // feed_post_reported_by_caller as well as the comment's own hide, so once the
    // caller reports the post every comment beneath it is gone from their Feed.
    // can_view_feed_comment deliberately omits the reporter hide — that is what
    // keeps a REPEAT report idempotent — so the report path has to add the
    // parent-post term itself, or it accepts a fresh accusation about content the
    // accuser can no longer see.
    // TWICE, and the count is the assertion. The re-check after the write carries
    // the identical text, so a `toContain` on the whole body stays green with the
    // PRE-write arm deleted — the same satisfiable-by-a-copy shape round 9 fixed in
    // the case above, pointing the other way.
    const term = 'or exists ( select 1 from public.feed_comments c where c.id = v_ref::uuid'
      + ' and public.feed_post_reported_by_caller(c.post_id) )';
    expect(sqlShape(body)).toContain(term);
    expect(
      sqlShape(body).split(term).length - 1,
      'the parent-post term is missing from either the pre-write or the post-write comment arm',
    ).toBe(2);
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
