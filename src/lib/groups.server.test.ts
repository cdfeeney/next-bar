import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * WP6 round-2 guards — static assertions over `supabase/migrations/0067_groups.sql`.
 *
 * WHY THE SHAPE AND NOT THE BEHAVIOUR. The three defects guarded here are all database
 * concurrency/cascade properties. Reproducing them for real needs two committing transactions
 * against a live database, and this lane is explicitly forbidden to run one (see the header of
 * `e2e/groups.spec.ts`). Proving the SHAPE from the SQL text is what is honestly available here,
 * and it is what the sibling suites `nightOutsMigration.test.ts` and `friendRatingsScore.test.ts`
 * already do for the same reason. Each assertion below names the round-1 finding it pins so a
 * later reader can tell a guard from a decoration.
 */

const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0067_groups.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/** The body of one `create or replace function` block, by name. */
function fn(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} must be defined in 0067`).toBeGreaterThan(-1);
  const end = SQL.indexOf('\n$$;', start);
  expect(end, `${name} must terminate`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('D-C-38 succession is serialized and verified (round-1 finding 7)', () => {
  it('group_apply_succession takes the SAME per-group advisory lock leave_group takes', () => {
    // The race: a departure via the profiles ON DELETE CASCADE fires the succession trigger
    // WITHOUT leave_group's lock, so it can read a membership row another transaction has
    // already deleted-but-not-committed and promote a member who is leaving.
    const body = fn('group_apply_succession');
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toContain("hashtextextended('group_members:' || p_group::text, 0)");
  });

  it('group_apply_succession re-checks for a standing administrator AFTER taking the lock', () => {
    // Taking the lock is worthless if the decision was already made against the pre-lock read.
    const body = fn('group_apply_succession');
    const lockAt = body.indexOf('pg_advisory_xact_lock');
    // Guard the guard: with no lock at all indexOf returns -1, and "after the lock" would be
    // vacuously true for every admin check in the function. Assert the lock exists FIRST — this
    // test passed against the unfixed code until that line was added.
    expect(lockAt).toBeGreaterThan(-1);
    const adminChecks = [...body.matchAll(/where m\.group_id = p_group\s*\n\s*and m\.is_admin/g)];
    expect(adminChecks.some((m) => (m.index ?? 0) > lockAt)).toBe(true);
  });

  it('group_apply_succession verifies its promotion UPDATE actually matched a row', () => {
    // EvalPlanQual: if the chosen successor's row was concurrently deleted, the UPDATE matches
    // zero rows and the old code returned happily, leaving the group administrator-less.
    const body = fn('group_apply_succession');
    expect(body).toMatch(/get diagnostics|\bfound\b/i);
  });

  it('group_apply_succession cannot fall through leaving no administrator and no deletion', () => {
    // The last-two-out variant: a 0-row update left v_successor non-null, so the delete branch
    // was skipped too and an empty group survived, violating V8-R-GRP-006.
    const body = fn('group_apply_succession');
    expect(body).toMatch(/loop|retry|raise exception/i);
  });
});

describe('photo destinations are retired on EVERY message death (round-1 finding 3)', () => {
  it('a group_messages delete retires its media_destinations row, not only the soft-delete verb', () => {
    // delete_group_message sets removed_at, but a group cascade or a sender-profile cascade
    // HARD-deletes the message and left kind='group' destinations live forever, holding bytes
    // off reclamation with no message left to explain them.
    expect(SQL).toMatch(/create trigger [a-z_]*group_messages[a-z_]*(retire|destination)/i);
  });

  it('the retirement runs on the table itself so both cascade routes reach it', () => {
    expect(SQL).toMatch(/after delete on public\.group_messages/i);
  });
});

describe('V8-R-GRP-008 Night Out invitation notifications exist (round-1 finding 1)', () => {
  it('0067 defines a recipient-addressed invitation notification record', () => {
    // The requirement is explicit: "V8 PROVIDES IN-APP UNREAD STATE and NIGHT OUT INVITATION
    // NOTIFICATIONS." 0067 shipped only the first half; the exclusion ("no push per ordinary
    // group message") was implemented as absence and the inclusion was never built.
    expect(SQL).toMatch(/create table if not exists public\.night_out_invitation_notifications/);
  });

  it('the notification names its recipient, so it is addressed rather than plan-scoped', () => {
    // night_out_events already records kind='invited', but it has no recipient column and is
    // revoked from authenticated: it is plan activity, not a notification anyone can receive.
    const table = SQL.slice(SQL.indexOf('create table if not exists public.night_out_invitation_notifications'));
    expect(table.slice(0, 900)).toMatch(/recipient_id\s+uuid\s+not null/);
  });

  it('inviting a group creates one notification per newly invited member', () => {
    const body = fn('invite_group_to_night_out');
    expect(body).toMatch(/night_out_invitation_notifications/);
  });

  it('a member already on the plan is not re-notified', () => {
    // invite_to_night_out returns true both for "newly invited" and "already a member", so the
    // group path must decide newness itself or it will notify people who were already there.
    const body = fn('invite_group_to_night_out');
    expect(body).toMatch(/night_out_members/);
  });

  it('the recipient can read their own invitation notifications', () => {
    expect(SQL).toMatch(/create or replace function public\.get_my_night_out_invitation_notifications/);
  });

  it('no application role may write the notification table directly', () => {
    expect(SQL).toMatch(/revoke all on table public\.night_out_invitation_notifications from public, anon, authenticated/);
  });
});
