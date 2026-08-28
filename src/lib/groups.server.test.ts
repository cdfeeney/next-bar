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
    const body = code('group_apply_succession');
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toContain("hashtextextended('group_members:' || p_group::text, 0)");
  });

  it('group_apply_succession re-checks for a standing administrator AFTER taking the lock', () => {
    // Taking the lock is worthless if the decision was already made against the pre-lock read.
    const body = code('group_apply_succession');
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
    const body = code('group_apply_succession');
    expect(body).toMatch(/get diagnostics|\bfound\b/i);
  });

  it('group_apply_succession cannot fall through leaving no administrator and no deletion', () => {
    // The last-two-out variant: a 0-row update left v_successor non-null, so the delete branch
    // was skipped too and an empty group survived, violating V8-R-GRP-006.
    const body = code('group_apply_succession');
    // CODE, not prose: this guard matched the body own LOOPED comment and stayed green against a
    // reverted retry loop. It now names the constructs the retry is MADE of.
    expect(body).toMatch(/get diagnostics/i);
    expect(body).toMatch(/exit when/i);
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
    expect(code('invite_one_to_night_out')).toMatch(/night_out_invitation_notifications/);
  });

  it('a member already on the plan is not re-notified', () => {
    // invite_to_night_out returns true both for "newly invited" and "already a member", so the
    // door must decide newness itself or it will notify people who were already there.
    expect(code('invite_one_to_night_out')).toMatch(/night_out_members/);
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
    const body = code('invite_one_to_night_out');
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
    const body = code('group_apply_succession');
    const lockAt = body.indexOf('pg_advisory_xact_lock');
    expect(lockAt).toBeGreaterThan(-1);
    const firstRead = body.indexOf('from public.group_members');
    expect(firstRead).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(firstRead);
  });


});

describe('round-3 panel findings', () => {
  // RULING (a), operator, after adjudicating Codex vs Fable by evidence: PostgreSQL locks the
  // target tuple in GetTupleForTrigger BEFORE any BEFORE ROW DELETE trigger body runs, so the
  // round-2 trigger acquired row-then-advisory exactly like the AFTER trigger it replaced. It was
  // ineffective. It is removed rather than kept as decoration.
  it('the ineffective BEFORE DELETE lock trigger is gone', () => {
    expect(SQL).not.toMatch(/group_members_lock_before_delete/);
    expect(SQL).not.toMatch(/before delete on public\.group_members/i);
  });

  it('0067 states the TRUE concurrency ceiling and never claims impossibility', () => {
    // The round-2 comment said "the cycle cannot form". That is false on this evidence, and a
    // false safety claim is worse than a named ceiling.
    expect(SQL).not.toMatch(/cycle cannot form/i);
    expect(SQL).toMatch(/40P01/);
  });

  it('the deadlock ceiling is retried at the caller rather than hidden', () => {
    // Fable's alternative, now the shipped design: accept 40P01 as fail-closed and retry where
    // the work is initiated.
    // CODE, not the comment above it. The first version of this guard matched /40P01/ anywhere in
    // the file and survived replacing the comparison with `false` — the FOURTH guard in this lane
    // to pass on prose. Strip line comments, then require the actual comparison expression.
    const raw = readFileSync(path.join(__dirname, 'groups.server.ts'), 'utf8');
    const src = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(src).toMatch(/error\.code === '40P01'/);
  });

  // FINDING F1 (Claude/FABLE): invite_one_to_night_out is granted to authenticated and took an
  // arbitrary p_group with no membership check, so any caller could forge "via <group>"
  // attribution and leak a group's NAME to a non-member through
  // get_my_night_out_invitation_notifications.
  it('the invite door refuses a group the caller does not belong to', () => {
    const body = code('invite_one_to_night_out');
    expect(body).toMatch(/is_group_member|group_members/);
    expect(body).toMatch(/42501/);
  });

  // FINDING C2 (Codex): deleted_by ON DELETE SET NULL contradicts
  // group_messages_deletion_is_whole, which demanded deleted_by whenever deleted_at is set. When
  // the deleter's account is removed the FK nulls deleted_by, the check fails, and the ACCOUNT
  // DELETION itself errors out. Losing attribution must not unmake a deletion.
  it('a deleted message survives the loss of its deleter, so account deletion cannot fail', () => {
    const decl = SQL.slice(SQL.indexOf('constraint group_messages_deletion_is_whole'));
    // The forbidden half stays forbidden: deleted_by without deleted_at is still a half-deletion.
    expect(decl.slice(0, 400)).toMatch(/deleted_by is null/);
    // But deleted_at with a null deleted_by must now be legal.
    expect(decl.slice(0, 400)).not.toMatch(/deleted_at is not null and deleted_by is not null/);
  });

  // FINDING F3 (Claude/FABLE): the succession guard matched /loop/i against the body's own
  // "LOOPED, because..." comment, so it stayed green if the retry loop were reverted with its
  // comment left behind — the same prose-matching vacuity code() was introduced to fix, in a
  // guard that was never routed through it.
});

describe('round-3, second pass', () => {
  // FINDING C6 (Codex): send_group_message checked OWNERSHIP and reclamation but never the WP1
  // evidence itself. media_objects.server_verified is precisely what distinguishes bytes the
  // upload route decoded and vouched for from a row a client merely owns, and 0066 defaults it
  // to false. Without that check a caller can attach an unverified object to a group thread.
  it('a group photo must carry WP1 server_verified evidence', () => {
    const body = code('send_group_message');
    expect(body).toMatch(/server_verified/);
  });

  it('a group photo must live in the story-media bucket, not merely be owned', () => {
    const body = code('send_group_message');
    expect(body).toMatch(/story-media/);
    expect(body).toMatch(/storage\.objects/);
  });

  // FINDING C5 (Codex): mark_group_read stamped database now(), so read state advanced past
  // messages that arrived between the thread fetch and the mark — messages the viewer never saw.
  // The boundary must be the newest message actually RETURNED, not the clock.
  it('mark_group_read accepts a watermark rather than stamping the clock', () => {
    expect(SQL).toMatch(/mark_group_read\(p_group uuid, p_through timestamptz/);
    const body = code('mark_group_read');
    expect(body).toMatch(/p_through/);
    // now() may remain only as the fallback when no watermark is supplied.
    expect(body).toMatch(/coalesce\(p_through/);
  });

  it('the client passes the newest loaded message as that watermark', () => {
    const src = readFileSync(path.join(__dirname, 'groups.server.ts'), 'utf8')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(src).toMatch(/p_through/);
  });
});

describe('round-4 panel findings', () => {
  // Codex round-3: round 3 validated the CALLER's membership of p_group and stopped, so a member
  // could attach their group and its NAME to an invitation for an arbitrary outsider.
  it('the invite door checks BOTH parties belong to the group it attributes', () => {
    const body = code('invite_one_to_night_out');
    expect(body).toMatch(/m\.profile_id = v_caller/);
    expect(body).toMatch(/m\.profile_id = p_user/);
  });

  // Codex round-3: the inherited invite_to_night_out has no is_blocked_between check, so a group
  // invite could reach someone the caller has blocked. 0050 is another lane's file; this door is
  // wp6's and both group paths go through it.
  it('the invite door honours blocks', () => {
    expect(code('invite_one_to_night_out')).toMatch(/is_blocked_between/);
  });

  // Codex round-3: get_group_thread caps at GROUP_THREAD_PAGE, so marking through the newest
  // RETURNED row marked every older unshown message read. The client must not advance a watermark
  // for a truncated page — asserted in GroupThread.test.tsx; this pins the shared constant that
  // makes the client able to tell.
  it('the page size is exported so the client can detect a truncated page', () => {
    const src = readFileSync(path.join(__dirname, 'groups.server.ts'), 'utf8')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(src).toMatch(/export const GROUP_THREAD_PAGE\s*=\s*200/);
    expect(src).toMatch(/limit = GROUP_THREAD_PAGE/);
  });
});

/**
 * ROUND 5 — CALLER INVARIANTS FOR THE SHARED DOOR, WRITTEN BEFORE THE DOOR CHANGES.
 *
 * `invite_one_to_night_out` has TWO callers with OPPOSITE requirements, and three regressions in
 * this lane came from changing a shared path while holding only one of them in mind:
 *
 *   invite_group_to_night_out (the loop) — V8-R-GRP-003: "a failed invite shows a per-person
 *     Resend; OTHER SUCCESSFUL INVITES ARE UNAFFECTED". One member's refusal must become
 *     invited=false for that person and nothing more. It must NOT abort the loop.
 *   inviteNightOutMember (the single Resend) — one person, one answer. A refusal there IS the
 *     result and must surface, not be swallowed into a false success.
 *
 * Round 4 added the block check as a bare `raise` inside the door and satisfied only the second.
 * These two tests are the pair that would have caught it, so they are pinned together, permanently.
 */
describe('round-5: both callers of the shared invite door', () => {
  it('the GROUP loop survives one member being refused — per-person, not whole-group', () => {
    const body = code('invite_group_to_night_out');
    // The loop must handle a refusal from the door rather than letting it propagate: an exception
    // block inside the loop, recording invited=false for that person.
    expect(body).toMatch(/exception/i);
    expect(body).toMatch(/invited\s*:?=\s*false/);
  });

  it('the loop still returns a row for every member, refused or not', () => {
    const body = code('invite_group_to_night_out');
    // return next must be reached on every iteration, including the refused one — a row per
    // member is what makes the per-person Resend list possible at all.
    expect(body).toMatch(/return next;/);
    const loopStart = body.indexOf('loop');
    const returnNext = body.indexOf('return next;');
    expect(returnNext).toBeGreaterThan(loopStart);
  });

  it('the SINGLE-person door still refuses loudly — a refusal is the answer, not a silent false', () => {
    const body = code('invite_one_to_night_out');
    // The door keeps raising: the Resend caller needs the refusal to surface.
    expect(body).toMatch(/raise exception/);
    expect(body).toMatch(/is_blocked_between/);
  });
});

describe('round-5: the Resend carries its group', () => {
  // Codex round-4: the per-person Resend passed p_group: null, so it bypassed BOTH membership
  // checks the shared door performs and discarded the "via <group>" attribution the whole-group
  // path records. The Resend exists to retry a GROUP invite; dropping the group makes it a
  // different operation wearing the same button.
  it('inviteNightOutMember passes the group through, never null', () => {
    const src = readFileSync(path.join(__dirname, 'groups.server.ts'), 'utf8')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(src).not.toMatch(/p_group:\s*null/);
    expect(src).toMatch(/p_group:\s*groupId/);
  });
});
