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

/**
 * The body of one function with its `--` comments STRIPPED.
 *
 * Needed because a comment that explains a call reads identically to the call. The round-2
 * "delegates to the shared door" assertion first matched the prose above the delegation rather
 * than the delegation itself, and survived a mutation that reverted the code — a guard that
 * passes on its own explanation is not a guard.
 */
function code(name: string): string {
  return fn(name).split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}

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

  // RETARGETED IN ROUND 2, and the move is the point rather than an accommodation. These two
  // asserted the notification insert and the newness read were inside invite_group_to_night_out.
  // That located the behaviour in ONE caller, which is exactly the defect round 2 found: the
  // per-person Resend called invite_to_night_out directly and got neither. The logic now lives in
  // invite_one_to_night_out, which both paths call, so these assert it there. The BEHAVIOUR they
  // pin is unchanged — a new invitee is notified, an existing member is not — and the separate
  // round-2 tests below assert that the group path really does delegate rather than keeping a
  // private copy, which is what stops this from being a test bent to fit the implementation.
  it('inviting a group creates one notification per newly invited member', () => {
    expect(fn('invite_one_to_night_out')).toMatch(/night_out_invitation_notifications/);
  });

  it('a member already on the plan is not re-notified', () => {
    // invite_to_night_out returns true both for "newly invited" and "already a member", so the
    // door must decide newness itself or it will notify people who were already there.
    expect(fn('invite_one_to_night_out')).toMatch(/night_out_members/);
  });

  it('the recipient can read their own invitation notifications', () => {
    expect(SQL).toMatch(/create or replace function public\.get_my_night_out_invitation_notifications/);
  });

  it('no application role may write the notification table directly', () => {
    expect(SQL).toMatch(/revoke all on table public\.night_out_invitation_notifications from public, anon, authenticated/);
  });
});

describe('round-2 panel findings', () => {
  // FINDING (Claude/FABLE + Codex, both lanes independently): the per-person Resend added in
  // round 1 for finding 2 calls invite_to_night_out DIRECTLY, bypassing the notification insert
  // that only invite_group_to_night_out performs. So the members whose FIRST invite failed — the
  // exact people the Resend exists for — become plan members with no invitation notification.
  // That is round-1 finding 1 reintroduced, on the narrower path, by the fix for finding 2.
  //
  // Fixed at the SHARED DOOR, not the caller: a definer RPC that both paths go through, so a
  // third caller cannot reopen the same hole. That is the lesson this file's own history keeps
  // recording, and it is why the assertion below is about the RPC existing and BOTH paths using
  // it, rather than about the Resend path having its own copy of the insert.
  it('a single-person invite notifies through the same door as the group invite', () => {
    expect(SQL).toMatch(/create or replace function public\.invite_one_to_night_out/);
  });

  it('the group invite delegates to that same door rather than inserting its own notification', () => {
    // CODE, not comments — see code(). This assertion passed against reverted code until the
    // comment stripping was added, because the prose above the call names the same function.
    const body = code('invite_group_to_night_out');
    expect(body).toMatch(/public\.invite_one_to_night_out\s*\(/);
    expect(body).not.toMatch(/public\.invite_to_night_out\s*\(/);
    // And it no longer carries a private copy of the insert: one door, not two.
    expect(body).not.toMatch(/insert into public\.night_out_invitation_notifications/);
  });

  it('the shared door records the notification for a genuinely new invitee', () => {
    const body = fn('invite_one_to_night_out');
    expect(body).toMatch(/night_out_invitation_notifications/);
    expect(body).toMatch(/night_out_members/);
  });

  // FINDING (Claude/FABLE): lock-order inversion. leave_group takes the per-group advisory lock
  // and THEN deletes; the profiles ON DELETE CASCADE route deletes the membership rows first and
  // only then waits on the lock inside the AFTER trigger. Two transactions can therefore acquire
  // in opposite orders and deadlock — Postgres detects it and aborts one with 40P01, so it is
  // fail-closed rather than corrupting, but it makes an ordinary leave or an account deletion
  // error out for no reason the user can act on.
  //
  // The fix is a consistent acquisition order: succession takes the lock as its FIRST action, and
  // leave_group must not hold a row lock on group_members before succession asks for the advisory
  // lock. Asserted structurally: in leave_group the advisory lock must precede the delete, and in
  // group_apply_succession the advisory lock must precede any read of group_members.
  it('group_apply_succession takes the advisory lock before it touches group_members', () => {
    const body = fn('group_apply_succession');
    const lockAt = body.indexOf('pg_advisory_xact_lock');
    expect(lockAt).toBeGreaterThan(-1);
    const firstRead = body.indexOf('from public.group_members');
    expect(firstRead).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(firstRead);
  });

  it('the cascade route takes the advisory lock BEFORE the row lock, via a BEFORE DELETE trigger', () => {
    // This is the actual deadlock fix, and without this assertion nothing pins it. leave_group
    // acquires advisory-then-row by construction; the profiles ON DELETE CASCADE route cannot,
    // because by the time the AFTER trigger runs the row lock is already held. A BEFORE DELETE
    // row trigger is the only place the cascade can acquire first.
    expect(SQL).toMatch(/before delete on public\.group_members/i);
    const body = fn('group_members_lock_before_delete');
    expect(body).toContain("hashtextextended('group_members:' || old.group_id::text, 0)");
  });

  it('0067 documents the single acquisition order both departure routes follow', () => {
    // A lock-order rule that is not written down is a rule the next edit breaks.
    expect(SQL).toMatch(/LOCK ORDER/);
  });
});
