import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0035 (share_night ±2-day bound — C4 audit F1).
 *
 * Static assertions, same as 0033/0034: authored-but-UNAPPLIED, no test
 * database. What is pinned here is that the guard exists, that it did not
 * arrive by deleting one of share_night's other validations, and that the
 * function's contract (raises, does not silently return null) is unchanged.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0035_share_night_date_bound.sql'),
  'utf8',
);

/** Statement bodies only — prose in comments would false-match. */
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0035 — the bound itself', () => {
  test('clamps p_night to current_date ± 2, the same window as its siblings', () => {
    expect(STATEMENTS).toMatch(
      /if p_night < \(current_date - 2\) or p_night > \(current_date \+ 2\) then/,
    );
  });

  test('RAISES rather than returning null — share_night’s existing contract', () => {
    // Its siblings return false; share_night raises for every other invalid
    // input. Returning null here instead would be a silent behaviour change
    // for every existing caller.
    const guard = STATEMENTS.match(
      /if p_night < \(current_date - 2\)[\s\S]*?end if;/,
    );
    expect(guard).not.toBeNull();
    expect(guard?.[0]).toMatch(/raise exception/);
    expect(guard?.[0]).toMatch(/errcode = '22023'/);
  });

  test('the window is the identical bound the three siblings use', () => {
    for (const file of [
      '0011_bar_suggestions.sql',
      '0012_bar_rsvps.sql',
      '0017_vibe_votes.sql',
    ]) {
      const sibling = readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');
      expect(sibling).toMatch(/\(current_date - 2\)/);
      expect(sibling).toMatch(/\(current_date \+ 2\)/);
    }
  });
});

describe('migration 0035 — nothing else was lost', () => {
  // The realistic failure mode for a create-or-replace that restates a whole
  // function body is dropping one of the validations while adding another.
  test.each([
    ['signed-in check', /if v_uid is null then/],
    ['night required', /if p_night is null then/],
    ['1-20 bars', /route must have 1-20 bars/],
    ['bar id shape', /invalid bar id in route/],
    ['loved bar on route', /loved bar must be on the route/],
  ])('still enforces: %s', (_label, pattern) => {
    expect(STATEMENTS).toMatch(pattern);
  });

  test('the share token is still never rotated on re-share', () => {
    // Rotating it would silently kill links the user already sent.
    expect(STATEMENTS).toMatch(/on conflict on constraint shared_nights_pkey/);
    expect(STATEMENTS).not.toMatch(/share_token\s*=\s*/);
  });

  test('the upsert still targets the CONSTRAINT, not a column list', () => {
    // 0011/0012 hit a live 42702 `night` param/column ambiguity doing this
    // with a column list; the constraint form is the fix and must survive.
    expect(STATEMENTS).toMatch(/on conflict on constraint/);
  });

  test('return type and signature are unchanged, so the ACL survives', () => {
    expect(STATEMENTS).toMatch(/create or replace function public\.share_night\(/);
    expect(STATEMENTS).toMatch(/returns uuid/);
    expect(STATEMENTS).toMatch(/p_loved_bar_id text default null/);
  });
});

describe('migration 0035 — blast radius', () => {
  test('grants execute to authenticated only, never anon', () => {
    expect(STATEMENTS).toMatch(
      /grant execute on function public\.share_night\(date, text\[\], text\) to authenticated;/,
    );
    expect(STATEMENTS).not.toMatch(/to anon/);
  });

  test('revokes before granting', () => {
    const revokeAt = STATEMENTS.indexOf('revoke all on function public.share_night');
    const grantAt = STATEMENTS.indexOf('grant execute on function public.share_night');
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(revokeAt).toBeLessThan(grantAt);
  });

  test('deletes nothing — existing out-of-window rows are left alone', () => {
    // Cleanup of rows already outside the window is a separate destructive
    // decision for an attended window, deliberately not bundled here.
    expect(STATEMENTS).not.toMatch(/delete from/i);
    expect(STATEMENTS).not.toMatch(/drop table/i);
    expect(STATEMENTS).not.toMatch(/truncate/i);
  });

  test('touches only share_night', () => {
    const fns = [...STATEMENTS.matchAll(/function public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(fns)).toEqual(new Set(['share_night']));
  });

  test('documents its rollback, per repository convention', () => {
    expect(SQL).toMatch(/Rollback \(in comments, per convention\)/);
  });
});
