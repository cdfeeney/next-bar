import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard over 0073_report_content_repeat_before_visibility.sql.
 *
 * A TEXT TEST FOR THE SAME REASON `feedMigration.test.ts` is one: no gate in this
 * lane executes SQL, so the mechanically provable property is the shape of the
 * text. Here that is enough to pin the whole fix, because the defect WAS an
 * ordering: the repeat report answered a question about the content before it
 * answered from the caller's own stored row, and every later call re-asked it.
 * ORDER is what these assertions compare, not presence — a fix that is present
 * but moved back below the visibility branch is the original oracle again, and
 * `toContain` on either half would stay green through it.
 */

const SQL = readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '0073_report_content_repeat_before_visibility.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');

/** Where `needle` starts, asserted to exist so a caller can compare positions. */
function at(needle: string, what: string): number {
  const i = SQL.indexOf(needle);
  expect(i, `${what} is not in 0073`).toBeGreaterThan(-1);
  return i;
}

describe('0073 — the idempotent repeat report is not a liveness oracle', () => {
  it('redefines report_content with the signature 0066 pinned and 0069 kept', () => {
    // The signature is the one thing that has to be stable: the grant names it,
    // and the client calls it. A redefinition under a different argument list
    // would leave 0069's oracle in place and add a second entry point beside it.
    expect(SQL).toContain('create or replace function public.report_content(\n'
      + '  p_subject_kind text,\n'
      + '  p_subject_ref text,\n'
      + '  p_reason text default null\n'
      + ')');
  });

  it('answers a repeat from the caller OWN stored row, not from the content', () => {
    // Keyed on the caller and the normalised ref, which is what
    // `record_content_report` stores and what the one-report-per-subject index
    // is on. Reading anything wider here would be reading somebody else's report.
    expect(SQL).toContain(
      'select cr.id\n'
      + '    into v_id\n'
      + '    from public.content_reports cr\n'
      + '   where cr.reporter_id = auth.uid()\n'
      + '     and cr.subject_kind = p_subject_kind\n'
      + '     and cr.subject_ref = v_ref;\n'
      + '  if v_id is not null then\n'
      + '    return v_id;\n'
      + '  end if;',
    );
  });

  it('returns that id BEFORE any question is asked about the content', () => {
    // THE WHOLE FIX, and the only assertion here that fails on the shape the
    // finding describes. `feed_post_visible_to` and `can_view_feed_comment` are
    // the two predicates that move when the post is deleted, the friendship ends,
    // the destination goes dark or a block lands — so a caller who can re-run
    // them at will, without a cap, is watching content they have hidden. The
    // repeat writes nothing, so it needs neither predicate to decide anything.
    const earlyReturn = at('  if v_id is not null then\n    return v_id;', 'the repeat early return');
    const postCheck = at(
      'if not public.feed_post_visible_to(auth.uid(), v_ref::uuid) then',
      'the feed_post visibility check',
    );
    const commentCheck = at('if not public.can_view_feed_comment(v_ref::uuid)', 'the comment visibility check');

    expect(earlyReturn, 'the repeat is decided AFTER the post visibility check, which is the oracle')
      .toBeLessThan(postCheck);
    expect(earlyReturn, 'the repeat is decided AFTER the comment visibility check, which is the oracle')
      .toBeLessThan(commentCheck);
  });

  it('leaves every kind this lane does not own delegated, and decides the repeat inside its own branch', () => {
    // 0066's story branch and 0067's group_message branch carry their own
    // idempotency. An early return placed ABOVE the delegation would answer for
    // them too, out of a table whose semantics for those kinds this file has
    // never seen — the precise failure the delegation exists to prevent.
    const delegation = at(
      'return public.report_content_before_0069(p_subject_kind, p_subject_ref, p_reason);',
      'the delegation of other kinds',
    );
    const earlyReturn = at('  if v_id is not null then\n    return v_id;', 'the repeat early return');
    expect(delegation, 'the repeat early return answers for kinds this file does not own')
      .toBeLessThan(earlyReturn);
  });

  it('still records, and still re-asserts entitlement, for a report that actually writes one', () => {
    // The early return skips the post-write re-check only on the path that writes
    // nothing. A first report is unchanged: cap, insert, then the re-assertion
    // that rolls the transaction back if the caller lost sight of the subject
    // while waiting on the advisory lock.
    const earlyReturn = at('  if v_id is not null then\n    return v_id;', 'the repeat early return');
    const record = at(
      'v_id := public.record_content_report(p_subject_kind, v_ref, p_reason);',
      'the record-keeping call',
    );
    const reassert = at('stopped being yours to report', 'the post-write re-assertion');
    expect(earlyReturn).toBeLessThan(record);
    expect(record).toBeLessThan(reassert);
  });

  it('keeps the function callable by exactly the role 0069 granted', () => {
    expect(SQL).toContain('revoke all on function public.report_content(text, text, text) from public, anon;');
    expect(SQL).toContain('grant execute on function public.report_content(text, text, text) to authenticated;');
    expect(SQL, '0073 grants the reporting entry point to anon').not.toMatch(
      /grant execute on function public\.report_content\([^)]*\) to [^;]*anon/,
    );
  });
});
