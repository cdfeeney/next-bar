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
 * 0046 supersedes four of 0044's functions. The assertions in the block above
 * still describe 0044's TEXT, which is correct as a record of an applied,
 * immutable file — but for join_night_out_by_token, decline_night_out_by_token,
 * invite_to_night_out and get_night_out it is no longer the effective
 * definition. Read this block for those four.
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

describe('0046_night_outs_cap_and_race.sql — the round-2 ordering invariants', () => {
  it('join converts your own pending invite BEFORE it asks about capacity (round-2 HIGH)', () => {
    const body = functionBody(SQL_0046, 'join_night_out_by_token');
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
    const body = functionBody(SQL_0046, 'decline_night_out_by_token');
    expect(body).not.toMatch(/member_cap/);
    // Still serialised, so a concurrent invite cannot swallow the decline.
    expect(body).toMatch(/pg_advisory_xact_lock/);
  });

  it('respond_night_out gates the declined-to-accepted rejoin on the cap (round-2 medium, both lanes)', () => {
    const body = functionBody(SQL_0046, 'respond_night_out');
    expect(body, 'the rejoin path must take the same per-plan lock').toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\('night_out_members:/,
    );
    expect(body, 'the rejoin path must consult member_cap').toMatch(/member_cap/);
    expect(body, 'the cap only applies when a declined row re-enters the counted set')
      .toMatch(/v_current = 'declined'/);
  });

  it('every cap count excludes declined rows, in every function that counts', () => {
    const counts = [...SQL_0046.matchAll(/select count\(\*\) into v_count[\s\S]{0,300}?;/g)]
      .map(([match]) => match);
    expect(counts.length, 'expected at least one cap count in 0046').toBeGreaterThan(0);
    for (const count of counts) {
      expect(count, `a cap count still counts declined rows: ${count}`)
        .toMatch(/invite_status <> 'declined'/);
    }
  });

  it('is create-or-replace only — additive over an applied migration (criterion 11)', () => {
    expect(SQL_0046).not.toMatch(/^create (table|index|unique index|policy)/im);
    expect(SQL_0046).not.toMatch(/^(drop|alter) table/im);
    expect(SQL_0046).toMatch(/create or replace function/);
  });
});
