import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V8-3 migration guard — static assertions over 0044_night_outs.sql.
 *
 * This file proves the security SHAPE from the SQL text. Live RLS behaviour is
 * exercised separately in nightOutsRls.live.test.ts, against the APPLIED schema
 * (0044 was applied to staging on 2026-08-16; it was renumbered from the
 * reserved 0021 because the live ledger already held a different 0021).
 * What is mechanically proven here from the text alone: RLS on + revoked table grants for every table (criterion 3's
 * denied-by-RLS/RPC half), the non-recursive policy invariant (criterion 4),
 * definer-RPC-only writes with revoke-first grants, exactly one anon-granted
 * function (the bearer preview, criterion 5), advisory-lock cap counting and
 * ON CONSTRAINT idempotency (criterion 8), night_out_id scoping with no
 * night-keyed child queries (criterion 9's structural half), the locked PRD
 * states, and idempotent DDL (criterion 11).
 */

// Normalise line endings at the read. Git checks this file out with CRLF on
// Windows, and the assertions below are text patterns over the SQL — the
// policy-extraction regex terminates on ";\n", which never matches ";\r\n", so
// it silently found ZERO policies and the non-recursion invariant passed
// vacuously rather than failing loudly. Normalising once here keeps every
// pattern in this file line-ending agnostic instead of sprinkling \r? around.
const SQL = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0044_night_outs.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

const TABLES = [
  'night_outs',
  'night_out_members',
  'night_out_suggestions',
  'night_out_votes',
  'night_out_events',
];

describe('0044_night_outs.sql security shape', () => {
  it('every table enables RLS and revokes all direct grants (criterion 3)', () => {
    for (const table of TABLES) {
      expect(SQL).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
      expect(SQL).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated`,
        ),
      );
    }
  });

  it('the ONLY table grants are the two documented SELECT-behind-RLS reads (criterion 3)', () => {
    // The revoke assertions above are necessary but not sufficient, and on
    // their own they overstate the artifact: the migration deliberately
    // re-grants SELECT on two tables AFTER revoking, so "revokes all direct
    // grants" is not true of the SQL it passes against. Worse, a later commit
    // could add `grant insert on table ... to authenticated` and every
    // assertion above would still pass. Pin the exact grant set instead, so
    // writes stay RPC-only by construction.
    const tableGrants = [
      ...SQL.matchAll(/grant\s+([a-z, ]+?)\s+on table public\.(\w+) to ([a-z, ]+);/g),
    ].map(([, privileges, table, roles]) => ({
      privileges: privileges.trim(),
      table,
      roles: roles.trim(),
    }));

    expect(tableGrants).toEqual([
      { privileges: 'select', table: 'night_out_members', roles: 'authenticated' },
      { privileges: 'select', table: 'night_outs', roles: 'authenticated' },
    ]);

    // Stated separately so the failure message names the actual risk if the
    // shape above ever drifts: no direct write path to any table, ever.
    for (const grant of tableGrants) {
      expect(grant.privileges, `${grant.table} carries a non-select table grant`).toBe(
        'select',
      );
      expect(grant.roles, `${grant.table} grants a table read to anon`).not.toMatch(
        /\banon\b|\bpublic\b/,
      );
    }
  });

  it('member policies never reference night_outs — the non-recursion invariant (criterion 4)', () => {
    // Extract each policy created ON night_out_members and assert its body
    // contains no reference to the parent table: the cycle
    // night_outs → members → night_outs is thereby impossible.
    const policies = [
      ...SQL.matchAll(
        /create policy \S+ on public\.night_out_members[\s\S]*?;\n/g,
      ),
    ];
    expect(policies.length).toBeGreaterThan(0);
    for (const [policy] of policies) {
      expect(policy).not.toMatch(/night_outs\b/);
    }
  });

  it('exactly one function is granted to anon: the bearer preview (criterion 5)', () => {
    const anonGrants = [
      ...SQL.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon/g),
    ].map((m) => m[1]);
    expect(anonGrants).toEqual(['preview_night_out']);
  });

  it('the anon preview selects no account ids, tokens, ratings, or scores (criterion 5)', () => {
    const preview = SQL.match(
      /create or replace function public\.preview_night_out[\s\S]*?\$\$;/,
    )?.[0];
    expect(preview).toBeDefined();
    expect(preview).toMatch(/security definer/);
    expect(preview).toMatch(/materialized/);
    // The returns table clause is the payload contract.
    const returns = preview!.match(/returns table \(([\s\S]*?)\)/)?.[1] ?? '';
    expect(returns).not.toMatch(/user_id|owner_id|share_token|score|rating|p256dh|endpoint/);
  });

  it('every write RPC is SECURITY DEFINER with revoke-first grants', () => {
    const writeFns = [
      'create_night_out',
      'cancel_night_out',
      'decide_night_out',
      'invite_to_night_out',
      'respond_night_out',
      'join_night_out_by_token',
      // Round 2 added these two; they mutate membership and the bearer
      // capability respectively, so they owe the same definer/grant shape.
      'decline_night_out_by_token',
      'revoke_night_out_link',
      'suggest_night_out_bar',
      'vote_night_out_bar',
    ];
    for (const fn of writeFns) {
      const body = SQL.match(
        new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\$\\$;`),
      )?.[0];
      expect(body, fn).toBeDefined();
      expect(body, fn).toMatch(/security definer/);
      expect(body, fn).toMatch(/set search_path = public/);
      expect(SQL, fn).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`),
      );
      // Auth-required (criterion 6): granted to authenticated, never bare anon.
      expect(SQL, fn).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon`),
      );
    }
  });

  it('cap counting uses the advisory-lock pattern and inserts use ON CONSTRAINT (criterion 8)', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('night_outs:/);
    expect(SQL).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('night_out_members:/);
    expect(SQL).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('night_out_suggestions:/);
    for (const constraint of [
      'night_out_members_pkey',
      'night_out_suggestions_pkey',
      'night_out_votes_pkey',
    ]) {
      expect(SQL).toMatch(
        new RegExp(`on conflict on constraint ${constraint} do nothing`),
      );
    }
  });

  it('child tables scope by night_out_id and carry no night column (criterion 9, structural)', () => {
    for (const table of ['night_out_suggestions', 'night_out_votes', 'night_out_events']) {
      const ddl = SQL.match(
        new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\);`),
      )?.[1];
      expect(ddl, table).toBeDefined();
      expect(ddl, table).toMatch(/night_out_id\s+uuid\s+not null references public\.night_outs/);
      expect(ddl, table).not.toMatch(/\bnight\s+date\b/);
    }
  });

  it('viewing never mutates: resolve-by-token is a definer READ gated on existing membership', () => {
    const resolve = SQL.match(
      /create or replace function public\.resolve_night_out_by_token[\s\S]*?\$\$;/,
    )?.[0];
    expect(resolve).toBeDefined();
    expect(resolve).toMatch(/stable/);
    expect(resolve).toMatch(/security definer/);
    expect(resolve).toMatch(/materialized/);
    expect(resolve).not.toMatch(/insert|update|delete/i);
    // Authenticated-only — a bearer token alone must not resolve membership.
    expect(SQL).toMatch(
      /grant execute on function public\.resolve_night_out_by_token\(uuid\) to authenticated/,
    );
  });

  it('locks the PRD state machines exactly (required states)', () => {
    expect(SQL).toMatch(/status in \('draft', 'open', 'decided', 'cancelled'\)/);
    expect(SQL).toMatch(/invite_status in \('pending', 'accepted', 'declined'\)/);
    expect(SQL).toMatch(/kind in \('invited', 'accepted', 'bar_suggested', 'plan_changed'\)/);
  });

  it('is idempotent DDL throughout (criterion 11)', () => {
    const bareCreates = [
      ...SQL.matchAll(/^create (table|index|unique index|policy) (?!if not exists)/gim),
    ].filter(([line]) => !/^create policy/i.test(line));
    // Tables/indexes must be IF NOT EXISTS; policies use drop-if-exists+create.
    expect(bareCreates).toEqual([]);
    const policyCreates = [...SQL.matchAll(/create policy (\S+)/g)].map((m) => m[1]);
    for (const name of policyCreates) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists ${name}`));
    }
    expect(SQL).toMatch(/create or replace function/);
  });
});

/**
 * WHICH FILE HOLDS THE EFFECTIVE DEFINITION (round-3 review, Claude: the first
 * version of this comment listed the wrong four functions and omitted
 * respond_night_out — the one function round 3 existed to fix — which would
 * send an auditor of the 20-member cap to 0044's uncapped, unlocked text):
 *
 *   0044 — night_out_role, create_night_out, cancel_night_out, decide_night_out,
 *          suggest/vote, the member-scoped reads, preview, resolve-by-token
 *   0045 — get_night_out (invite_to_night_out superseded by 0049)
 *   0046 — (superseded by 0048)
 *   0047 — night_outs column grants
 *   0048 — night_out_member_cap, night_out_seat_count, and the four callers:
 *          join_night_out_by_token, decline_night_out_by_token,
 *          respond_night_out, night_out_is_full_by_token
 *   0049 — (superseded by 0050)
 *   0050 — invite_to_night_out
 *
 * The assertions in the block above still describe 0044's TEXT, which is correct
 * as a record of an applied, immutable file, but is NOT the effective definition
 * for anything in the 0045/0046/0047 rows.
 *
 * These are ORDERING invariants, and they exist because the thing they guard
 * cannot be exercised behaviorally on staging: the 20-member boundary needs 21
 * distinct fixture identities and public.profiles is FK'd to auth.users, which
 * this suite does not manufacture. A static guard is the honest fallback, not a
 * substitute — see the residual-risk note in the goal.
 */
const SQL_0046 = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0046_night_outs_cap_and_race.sql'),
  'utf8',
).toLowerCase();

/** The body of one create-or-replace function, up to its closing $$. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} not found in 0046`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/**
 * These assert the ORDERING invariants that stand in for the untestable
 * 20-member boundary, so they must read whichever file currently DEFINES the
 * functions. They were written against 0046 and stayed pointed there after 0048
 * superseded it (fresh-cycle round-2 review, Claude) — a guard aimed at dead
 * text, which is the same claim-drifted-from-artifact failure it exists to
 * catch. They now read SQL_0048; if a later migration re-states these
 * functions again, this constant is what has to move with it.
 */
describe('effective night_out RPC ordering invariants (currently 0048)', () => {
  it('join converts your own pending invite BEFORE it asks about capacity (round-2 HIGH)', () => {
    const body = functionBody(SQL_0048, 'join_night_out_by_token');
    const lock = body.indexOf('pg_advisory_xact_lock');
    const conversion = body.indexOf("set invite_status = 'accepted'", lock);
    const capCheck = body.indexOf('member_cap', conversion);
    expect(lock, 'join takes no advisory lock').toBeGreaterThan(-1);
    expect(conversion, 'no own-row conversion after the lock').toBeGreaterThan(lock);
    // The whole defect was asking about capacity before knowing whether this
    // call even takes capacity. Converting an existing invite is not a new seat.
    expect(capCheck, 'the cap check must come AFTER the post-lock conversion')
      .toBeGreaterThan(conversion);
  });

  it('declining is never rationed by capacity (round-2 medium)', () => {
    const body = functionBody(SQL_0048, 'decline_night_out_by_token');
    expect(body).not.toMatch(/member_cap/);
    // Still serialised, so a concurrent invite cannot swallow the decline.
    expect(body).toMatch(/pg_advisory_xact_lock/);
  });

  it('respond_night_out gates the declined-to-accepted rejoin on the cap (round-2 medium, both lanes)', () => {
    const body = functionBody(SQL_0048, 'respond_night_out');
    expect(body, 'the rejoin path must take the same per-plan lock').toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\('night_out_members:/,
    );
    expect(body, 'the rejoin path must consult member_cap').toMatch(/member_cap/);
    expect(body, 'the cap only applies when a declined row re-enters the counted set')
      .toMatch(/v_current = 'declined'/);
  });

  it('the one counted set excludes declined rows', () => {
    // There is exactly one count now — night_out_seat_count — so this is the
    // only place the rule can be wrong. 0048's exactly-once assertion is what
    // keeps it that way.
    const body = functionBody(SQL_0048, 'night_out_seat_count');
    expect(body, 'the seat count includes declined rows').toMatch(/invite_status <> 'declined'/);
  });

  it('is create-or-replace only — additive over an applied migration (criterion 11)', () => {
    expect(SQL_0046).not.toMatch(/^create (table|index|unique index|policy)/im);
    expect(SQL_0046).not.toMatch(/^(drop|alter) table/im);
    expect(SQL_0046).toMatch(/create or replace function/);
  });
});

/**
 * 0048 exists so the cap and the seat-count predicate have ONE definition. The
 * assertion that matters is the negative one: no caller may carry its own copy
 * again, because 0046/0047 are immutable and a fifth copy could not be edited
 * back into agreement either.
 */
const SQL_0048_RAW = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0048_night_outs_cap_single_source.sql'),
  'utf8',
).toLowerCase();
/**
 * Counting "how many times is this rule written down" must count CODE, not
 * prose — the header comment explains the rule and quoting it there is not a
 * second definition. Stripping line comments is what makes the assertion
 * measure the thing it claims to measure.
 */
const SQL_0048 = SQL_0048_RAW.replace(/--.*/g, '');

const SQL_0049 = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0049_night_outs_invite_uses_cap_helpers.sql'),
  'utf8',
).toLowerCase().replace(/--.*/g, '');

describe('0048_night_outs_cap_single_source.sql — one definition of a seat', () => {
  it('defines the cap and the counted set exactly once', () => {
    expect((SQL_0048.match(/select 20/g) ?? []).length, 'the cap literal appears more than once').toBe(1);
    expect(
      (SQL_0048.match(/invite_status <> 'declined'/g) ?? []).length,
      'the declined-exclusion predicate appears more than once',
    ).toBe(1);
  });

  it('every caller asks the helpers rather than restating the rule', () => {
    for (const fn of ['join_night_out_by_token', 'respond_night_out', 'night_out_is_full_by_token']) {
      const body = functionBody(SQL_0048, fn);
      expect(body, `${fn} does not use night_out_seat_count`).toMatch(/night_out_seat_count/);
      expect(body, `${fn} does not use night_out_member_cap`).toMatch(/night_out_member_cap/);
      expect(body, `${fn} still carries a hard-coded cap`).not.toMatch(/member_cap constant/);
    }
    // Declining is never rationed by capacity, so it must ask neither.
    const decline = functionBody(SQL_0048, 'decline_night_out_by_token');
    expect(decline).not.toMatch(/night_out_member_cap/);
  });

  it('0049 finishes the job — invite_to_night_out asks the helpers too', () => {
    // 0048 re-stated three callers and the fullness read and left invite in
    // 0045 with its own cap and predicate (fresh-cycle round-2 review, Codex).
    // A half-done single source is worse than four honest copies: it looks
    // solved, and owner invitations would enforce a capacity the rest of the
    // feature no longer uses.
    const invite = functionBody(SQL_0049, 'invite_to_night_out');
    expect(invite, 'invite does not use night_out_seat_count').toMatch(/night_out_seat_count/);
    expect(invite, 'invite does not use night_out_member_cap').toMatch(/night_out_member_cap/);
    expect(invite, 'invite still declares its own cap constant').not.toMatch(/member_cap constant/);
    expect(SQL_0049, 'invite still restates the counted set').not.toMatch(/invite_status <> 'declined'/);
  });

  it('keeps the helpers away from client roles', () => {
    expect(SQL_0048).toMatch(/revoke all on function public\.night_out_member_cap\(\) from public, anon, authenticated/);
    expect(SQL_0048).toMatch(/revoke all on function public\.night_out_seat_count\(uuid\) from public, anon, authenticated/);
    expect(SQL_0048).not.toMatch(/grant execute on function public\.night_out_(member_cap|seat_count)/);
  });

  it('is create-or-replace only — additive over applied migrations (criterion 11)', () => {
    expect(SQL_0048).not.toMatch(/^create (table|index|unique index|policy)/im);
    expect(SQL_0048).not.toMatch(/^(drop|alter) table/im);
    expect(SQL_0048).toMatch(/create or replace function/);
  });
});

const SQL_0050 = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '0050_night_outs_invite_recheck_before_cap.sql'),
  'utf8',
).toLowerCase().replace(/--.*/g, '');

describe('0050 — invite answers the membership question before the capacity one', () => {
  it('re-reads its own subject under the lock, BEFORE the cap check', () => {
    const body = functionBody(SQL_0050, 'invite_to_night_out');
    const lock = body.indexOf('pg_advisory_xact_lock');
    const recheck = body.indexOf('m.user_id = p_user', lock);
    const cap = body.indexOf('night_out_member_cap', recheck);
    expect(lock, 'invite takes no advisory lock').toBeGreaterThan(-1);
    expect(recheck, 'invite does not re-read its own subject after the lock').toBeGreaterThan(lock);
    // The whole defect: an already-present member consumes no NEW seat, so the
    // duplicate answer must be reached without consulting capacity at all.
    expect(cap, 'the cap check must come AFTER the post-lock membership re-read')
      .toBeGreaterThan(recheck);
  });

  it('still uses the single-source helpers rather than its own copy', () => {
    const body = functionBody(SQL_0050, 'invite_to_night_out');
    expect(body).toMatch(/night_out_seat_count/);
    expect(body).toMatch(/night_out_member_cap/);
    expect(SQL_0050, 'invite restates the counted set again').not.toMatch(/invite_status <> 'declined'/);
  });
});
