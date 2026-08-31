import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard over 0075_report_content_repeat_before_visibility.sql.
 *
 * A TEXT TEST FOR THE SAME REASON `feedMigration.test.ts` is one: no gate in this
 * lane executes SQL, so the mechanically provable property is the shape of the
 * text. Here that is enough to pin the fix, because the defect WAS an ordering —
 * the repeat report answered a question about the content before it answered from
 * the caller's own stored row, and every later call re-asked it, uncapped.
 *
 * TWO ROUND-1 FINDINGS ARE PINNED HERE AS WELL, because both were defects of
 * SHAPE that a passing suite had nothing to say about:
 *   - codex, HIGH: the file was numbered at or below the serving ledger head, so
 *     the approved runner could never apply it. `npm run check:migrations` is the
 *     real guard for that (it reads the live ledger); what is provable offline is
 *     that this repo does not carry a LOWER-numbered duplicate of this migration.
 *   - claude, MEDIUM: the file restated `report_content`'s whole body, which
 *     silently un-implements any widening applied between 0069 and here. The
 *     assertions below require it to DELEGATE instead — and the negative one,
 *     that it restates none of the visibility predicates, is the one that fails
 *     if anybody reintroduces the copy.
 */

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '0075_report_content_repeat_before_visibility.sql';

const SQL = readFileSync(path.join(MIGRATIONS, FILE), 'utf8').replace(/\r\n/g, '\n');

/**
 * The same file with its `--` comments removed.
 *
 * EVERY NEGATIVE ASSERTION BELOW MUST RUN AGAINST THIS, not the raw text. This
 * file's header discusses the very names those assertions forbid — it has to, to
 * explain what it stopped doing — so "the migration does not restate the
 * visibility branch" asked of the raw text is a claim about the prose. Two of the
 * four negatives passed only because the header happened to write a bare name
 * where the assertion looked for a qualified call; that is luck, not coverage.
 */
const CODE = SQL.replace(/--[^\n]*/g, '');

/** Where `needle` starts, asserted to exist so a caller can compare positions. */
function at(needle: string, what: string): number {
  const i = SQL.indexOf(needle);
  expect(i, `${what} is not in ${FILE}`).toBeGreaterThan(-1);
  return i;
}

describe('0075 — the idempotent repeat report is not a liveness oracle', () => {
  it('is the only copy of this migration in the tree', () => {
    // The round-1 HIGH shipped as a file the approved runner would refuse, and
    // the remedy was to renumber. A renumber that LEAVES the old file behind is
    // the same bug plus a duplicate definition racing it in lexical order.
    const dupes = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('report_content_repeat_before_visibility.sql'));
    expect(dupes, 'a renumbered copy of this migration was left behind').toEqual([FILE]);
  });

  it('answers a repeat from the caller OWN stored row, not from the content', () => {
    // Keyed on the caller and the normalised ref, which is what
    // `record_content_report` stores and what the one-report-per-subject index
    // is on. Reading anything wider here would be reading somebody else's report.
    expect(SQL).toContain(
      'select cr.id\n'
      + '      into v_id\n'
      + '      from public.content_reports cr\n'
      + '     where cr.reporter_id = auth.uid()\n'
      + '       and cr.subject_kind = p_subject_kind\n'
      + '       and cr.subject_ref = v_ref;\n'
      + '    if v_id is not null then\n'
      + '      return v_id;\n'
      + '    end if;',
    );
  });

  it('returns that id BEFORE control ever reaches the previous implementation', () => {
    // THE FIX ITSELF. The delegate is where every visibility predicate now lives,
    // so "before the delegation" is exactly "before any question about the
    // content". Positions, not presence: an early return that has been moved
    // below the delegate is unreachable for the repeat and the oracle is back,
    // while a presence assertion stays green through the move.
    const earlyReturn = at('    if v_id is not null then\n      return v_id;', 'the repeat early return');
    const delegation = at(
      'return public.report_content_before_0075(p_subject_kind, p_subject_ref, p_reason);',
      'the delegation to the previous implementation',
    );
    expect(earlyReturn, 'the repeat is decided AFTER the delegate has already answered')
      .toBeLessThan(delegation);
  });

  it('DELEGATES the previous implementation instead of restating it', () => {
    // Round 1 (MEDIUM, claude). A restated body hard-wires its fallback to the
    // implementation that existed when it was written, so a kind added between
    // then and now routes to something that has never heard of it and raises
    // 22023 while the CHECK constraint admits it. This branch holds migrations up
    // to 0069 and the serving ledger head is 0074, so five applied migrations
    // whose text is not here sit in between — the copy is not a theoretical risk.
    //
    // The negative is the assertion that matters: reintroducing the copy brings
    // these predicates back into the file, and nothing else here would notice.
    expect(CODE, '0075 restates the visibility branch instead of delegating it')
      .not.toContain('public.feed_post_visible_to(');
    expect(CODE, '0075 restates the comment visibility branch instead of delegating it')
      .not.toContain('public.can_view_feed_comment(');
    expect(CODE, '0075 restates the cap/insert half instead of delegating it')
      .not.toContain('public.record_content_report(');
    // And it delegates to the implementation IT renamed — not to some older
    // spelling, which is the same hard-wiring wearing a different number.
    expect(CODE, '0075 delegates past its own predecessor to an older implementation')
      .not.toContain('report_content_before_0069');
  });

  it('renames the previous implementation aside under a guard, and withdraws its grant', () => {
    // Unguarded, a re-apply renames the WRAPPER aside and the new wrapper then
    // delegates to itself. The guard is what makes the file idempotent.
    expect(SQL).toContain(
      "if to_regprocedure('public.report_content_before_0075(text,text,text)') is null\n"
      + "     and to_regprocedure('public.report_content(text,text,text)') is not null then",
    );
    expect(SQL).toContain('rename to report_content_before_0075');
    expect(SQL, 'the renamed implementation stays callable as a second entry point')
      .toContain("revoke all on function public.report_content_before_0075(text, text, text)");
  });

  it('takes the early return only for this lane kinds, an authenticated caller, and IN-BOUNDS input', () => {
    // Every other kind carries its own idempotency inside its own lane's
    // implementation. Answering for them out of this table would be the exact
    // overreach the delegation exists to prevent.
    //
    // AND THE BOUNDS ARE PART OF THE CONDITION (round 2, MEDIUM, codex). `btrim`
    // strips whitespace, so a reported uuid padded to 286 characters normalises
    // straight onto the stored row; without these two terms the early return
    // answered it and the delegate's length checks never ran, so the RPC stopped
    // being bounded on exactly the path that skips the delegate. Whole condition
    // pinned as one string: dropping any single term is the defect, and a
    // per-term assertion would stay green while a sibling term was deleted.
    expect(SQL).toContain(
      "  if p_subject_kind in ('feed_post', 'comment')\n"
      + "     and auth.uid() is not null\n"
      + "     and char_length(p_subject_ref) <= 200\n"
      + "     and (p_reason is null or char_length(p_reason) <= 1000) then",
    );
  });

  it('keeps the function callable by exactly the role 0069 granted', () => {
    expect(SQL).toContain('revoke all on function public.report_content(text, text, text) from public, anon;');
    expect(SQL).toContain('grant execute on function public.report_content(text, text, text) to authenticated;');
    expect(CODE, '0075 grants the reporting entry point to anon').not.toMatch(
      /grant execute on function public\.report_content\([^)]*\) to [^;]*anon/,
    );
  });
});
