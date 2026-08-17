import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * V8-3 BEHAVIORAL RLS/RPC negatives — criteria 3, 9 and 10.
 *
 * nightOutsMigration.test.ts proves the security SHAPE from the SQL text. That
 * was the only thing possible while 0044 was unapplied, and a round-2 reviewer
 * correctly refused to accept it as verification: a text scan cannot tell you
 * whether the database actually DENIES anyone. This file is the other half —
 * it connects as the real `anon` and `authenticated` roles and asserts the
 * denials happen.
 *
 * Everything runs inside a transaction that ROLLS BACK. No row created here
 * survives, which is what makes it safe to point at a live database.
 *
 * `SET LOCAL ROLE` + `request.jwt.claims` is how Supabase RLS is exercised from
 * SQL: policies read auth.uid() out of those claims, so switching the role and
 * the claim inside a transaction reproduces exactly what PostgREST would do for
 * that user — without needing a running API or real JWTs.
 *
 * Skips (does not fail) when DATABASE_URL is absent, so CI without credentials
 * stays green while the operator's machine gets the real coverage.
 */

function envValue(key: string): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    return env.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function databaseUrl(): string | null {
  return envValue('DATABASE_URL');
}

const URL = databaseUrl();

/**
 * STAGING-ONLY GATE (round-1 review, Codex medium: "a loaded gun pointed at
 * prod").
 *
 * This file does not merely read. It calls create_night_out, invite, join and
 * decline inside transactions, so it issues real DML, WAL and per-user advisory
 * locks against whatever DATABASE_URL names. ROLLBACK stops rows from being
 * committed; it does not stop any of that, and it is not an authorization.
 *
 * The URL itself cannot tell you which database it is: Supabase's pooler
 * hostname is shared and the project ref hides in the username, so a human
 * reading the connection string sees the same text for staging and production.
 * Therefore the target must be named explicitly, and the gate FAILS CLOSED —
 * an unset allowlist is not permission, it is a missing answer.
 *
 * Set in .env.local (see .env.example):
 *   NEXT_BAR_STAGING_PROJECT_REFS=<ref>[,<ref>...]
 *   NEXT_BAR_PRODUCTION_PROJECT_REF=<ref>
 */
/**
 * Ask `pg` itself what it will connect AS, rather than reading the URL.
 *
 * Round-2 review (Codex): the first version of this gate parsed
 * `new URL(connectionString).username`, but pg's connection-string parser gives
 * QUERY PARAMETERS precedence over the authority. A string whose authority says
 * `postgres.<staging-ref>` while its query says `user=postgres.<production-ref>`
 * passed the gate and connected to production — the gate read one value and pg
 * used another. Building the client and inspecting its own resolved parameters
 * makes those the same question by construction.
 *
 * `connectionParameters` is not in @types/pg, hence the narrow cast.
 */
function effectiveConnection(connectionString: string): { user: string; host: string } {
  const probe = new Client({ connectionString }) as unknown as {
    connectionParameters?: { user?: string; host?: string };
  };
  return {
    user: probe.connectionParameters?.user ?? '',
    host: probe.connectionParameters?.host ?? '',
  };
}

function assertStagingOnly(connectionString: string): void {
  const effective = effectiveConnection(connectionString);
  const ref = effective.user.split('.').pop() ?? '';
  const allowlist = (envValue('NEXT_BAR_STAGING_PROJECT_REFS') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const productionRef = envValue('NEXT_BAR_PRODUCTION_PROJECT_REF');

  // No host override either: the connection must go where the URL's authority
  // says it goes, so a redirected host cannot ride along with an allowlisted user.
  const authorityHost = new globalThis.URL(connectionString).hostname;
  if (authorityHost && effective.host && effective.host !== authorityHost) {
    throw new Error(
      'nightOutsRls.live.test.ts refuses to run: the effective connection host does not match the '
      + 'connection string authority, so the target was overridden by a query parameter.',
    );
  }

  if (allowlist.length === 0) {
    throw new Error(
      'nightOutsRls.live.test.ts refuses to run: NEXT_BAR_STAGING_PROJECT_REFS is not set in '
      + '.env.local. This suite writes to the database it connects to, so the staging target must '
      + 'be named explicitly. An unset allowlist is never treated as permission.',
    );
  }
  if (productionRef && ref === productionRef) {
    throw new Error(
      'nightOutsRls.live.test.ts refuses to run: DATABASE_URL points at NEXT_BAR_PRODUCTION_PROJECT_REF. '
      + 'Production writes are an attended gate and never happen from a test run.',
    );
  }
  if (!allowlist.includes(ref)) {
    throw new Error(
      "nightOutsRls.live.test.ts refuses to run: DATABASE_URL's project ref is not in "
      + 'NEXT_BAR_STAGING_PROJECT_REFS. Point .env.local at staging, or add the ref deliberately.',
    );
  }
}

if (URL) assertStagingOnly(URL);

/**
 * A security gate that silently skips is not a gate (round-3 review, Codex:
 * "fail-open and incomplete"). Absent credentials are only a legitimate reason
 * to skip on a CI runner, which has none by design. Anywhere else — an operator
 * machine, a deploy box — a missing DATABASE_URL means these denials went
 * UNVERIFIED, and that must be loud rather than green.
 */
const SKIP_ALLOWED = process.env.CI === 'true' || process.env.CI === '1';
if (!URL && !SKIP_ALLOWED) {
  throw new Error(
    'nightOutsRls.live.test.ts: no DATABASE_URL in .env.local, so the behavioral '
    + 'RLS/RPC denials were NOT verified. Set it, or set CI=1 to acknowledge that '
    + 'this environment cannot run them.',
  );
}
const describeLive = URL ? describe : describe.skip;

/**
 * Every other test in this file runs inside a transaction that ROLLS BACK,
 * which is what makes pointing it at the serving database safe. Criterion 3's
 * two-session race cannot be expressed that way — one connection never observes
 * its own uncommitted rows as a race — so that one test COMMITS and cleans up
 * after itself.
 *
 * Committing to the serving database is an attended action here, so it is
 * opt-in and the default is off. Note the direction: an unset flag means "not
 * authorized", never "assume yes". That is the opposite of the fail-open skip
 * this round fixed in the e2e spec — there, absent config silently voided
 * coverage that was supposed to have run; here, absent authorization declines
 * to write, which is the safe answer and a visible skip in the run output.
 */
const COMMITTING_ALLOWED = process.env.NEXT_BAR_ALLOW_COMMITTING_TESTS === '1';
const itCommitting = COMMITTING_ALLOWED ? it : it.skip;

describeLive('0044 night_outs — live RLS/RPC denials', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30000,
      application_name: 'v8-3-rls-negatives',
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  /** Run fn inside a rolled-back transaction, so nothing persists. */
  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    await db.query('BEGIN');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  const asRole = async (role: string, uid?: string) => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };

  const TABLES = [
    'night_outs',
    'night_out_members',
    'night_out_suggestions',
    'night_out_votes',
    'night_out_events',
  ];

  it('anon cannot read ANY night_out table directly (criterion 3)', async () => {
    for (const table of TABLES) {
      const denied = await inRollback(async () => {
        await asRole('anon');
        try {
          await db.query(`select * from public.${table} limit 1`);
          return null;
        } catch (error) {
          return (error as { message: string }).message;
        }
      });
      expect(denied, `anon could read public.${table}`).toMatch(/permission denied/i);
    }
  });

  it('anon cannot execute any night_out WRITE rpc (criterion 6)', async () => {
    // The ten write RPCs, plus 0047's authenticated-only definer READ
    // (night_out_is_full_by_token) which anon must also not execute. An
    // earlier round caught this list claiming "all" while omitting
    // decide/invite/respond — the same overstated-claim species as the
    // criterion-3 grant test. The completeness assertion at the end is what
    // stops the list silently falling behind the migration again, and it is
    // what caught 0047's new function on the round it was added.
    const writes: Array<[string, string]> = [
      ['create_night_out', "select public.create_night_out(current_date, 'x')"],
      ['cancel_night_out', `select public.cancel_night_out('${randomUUID()}'::uuid)`],
      ['decide_night_out', `select public.decide_night_out('${randomUUID()}'::uuid, 'attaboy')`],
      ['invite_to_night_out', `select public.invite_to_night_out('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
      ['respond_night_out', `select public.respond_night_out('${randomUUID()}'::uuid, true)`],
      ['join_night_out_by_token', `select public.join_night_out_by_token('${randomUUID()}'::uuid)`],
      ['decline_night_out_by_token', `select public.decline_night_out_by_token('${randomUUID()}'::uuid)`],
      ['revoke_night_out_link', `select public.revoke_night_out_link('${randomUUID()}'::uuid)`],
      ['suggest_night_out_bar', `select public.suggest_night_out_bar('${randomUUID()}'::uuid, 'attaboy')`],
      ['vote_night_out_bar', `select public.vote_night_out_bar('${randomUUID()}'::uuid, 'attaboy')`],
      ['night_out_is_full_by_token', `select public.night_out_is_full_by_token('${randomUUID()}'::uuid)`],
      // 0048's internal helpers: revoked from every client role, since only the
      // SECURITY DEFINER RPCs (running as the owner) call them.
      ['night_out_member_cap', 'select public.night_out_member_cap()'],
      ['night_out_seat_count', `select public.night_out_seat_count('${randomUUID()}'::uuid)`],
    ];
    for (const [name, sql] of writes) {
      const denied = await inRollback(async () => {
        await asRole('anon');
        try {
          await db.query(sql);
          return null;
        } catch (error) {
          return (error as { message: string }).message;
        }
      });
      expect(denied, `anon could execute ${name}`).toMatch(/permission denied/i);
    }

    // The list above claims to be exhaustive, so PROVE it against the database
    // rather than trusting it. Every night_out function that is not the one
    // anon-granted read (preview) or a member-scoped definer READ must appear.
    // Without this, adding an 11th write RPC would leave it silently unchecked
    // and the test would still say "any write rpc".
    const READS = new Set(['preview_night_out', 'resolve_night_out_by_token',
      'get_night_out', 'get_night_out_members', 'get_night_out_board', 'night_out_role']);
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like '%night_out%'`);
    const covered = new Set(writes.map(([name]) => name));
    const uncovered = rows
      .map((r) => r.proname as string)
      .filter((name) => !READS.has(name) && !covered.has(name));
    expect(uncovered, 'night_out write RPCs not covered by this denial test').toEqual([]);
  });

  it('anon CAN execute exactly the bearer preview, and it leaks no identifiers (criterion 5)', async () => {
    const columns = await inRollback(async () => {
      await asRole('anon');
      // A random token resolves to zero rows; the point is that the call is
      // PERMITTED and its column set is the payload contract.
      const res = await db.query(`select * from public.preview_night_out('${randomUUID()}'::uuid)`);
      return res.fields.map((f) => f.name);
    });
    expect(columns.length).toBeGreaterThan(0);
    for (const forbidden of ['user_id', 'owner_id', 'share_token', 'score', 'rating']) {
      expect(columns, `preview exposes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('a non-member authenticated user sees nothing of someone else\'s plan (criterion 10)', async () => {
    await inRollback(async () => {
      // Two real profiles are required by the FK; borrow existing ones rather
      // than inventing rows, since everything rolls back anyway.
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      // FAIL, never skip. An early return here would make this test pass on a
      // database with no fixtures — a green result asserting nothing, which is
      // the exact failure mode this file exists to replace.
      expect(people.length, 'need 2 profiles to prove isolation; this DB has fewer').toBe(2);
      const [owner, stranger] = people.map((r) => r.id as string);

      await asRole('authenticated', owner);
      const { rows } = await db.query('select public.create_night_out(current_date, $1) as id', [
        'rls-negative probe',
      ]);
      const planId = rows[0].id as string;
      expect(planId).toBeTruthy();

      // Same transaction, different caller: the stranger must not see it.
      await db.query('RESET ROLE');
      await asRole('authenticated', stranger);
      const seen = await db.query('select id from public.night_outs where id = $1', [planId]);
      expect(seen.rowCount, 'a non-member could read another user\'s plan').toBe(0);

      const members = await db.query(
        'select user_id from public.night_out_members where night_out_id = $1',
        [planId],
      );
      expect(members.rowCount, 'a non-member could read the member list').toBe(0);
    });
  });

  it('an authenticated non-member is denied on EVERY table and EVERY member-gated write (criteria 3, 10)', async () => {
    // Round-1 review, both lanes independently: the criterion-10 test above
    // probes a stranger's direct reads on night_outs and night_out_members
    // only, and never calls a member-gated write RPC as that stranger. So the
    // denial that criterion 3 requires "per table" rested on a text scan of
    // 0044 for three of five tables — a static shape, not a behavior. A later
    // migration granting authenticated select on a child table, or a
    // regression in night_out_role's accepted-member gate, would leave this
    // suite green. These assertions are what make that impossible.
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      expect(people.length, 'need 2 profiles to prove non-member denial').toBe(2);
      const [owner, stranger] = people.map((r) => r.id as string);

      await asRole('authenticated', owner);
      const { rows } = await db.query('select public.create_night_out(current_date, $1) as id', [
        'authenticated non-member probe',
      ]);
      const planId = rows[0].id as string;
      expect(planId).toBeTruthy();
      // Give the plan a child row of every kind, so "denied" cannot be
      // confused with "there was nothing there anyway".
      await db.query('select public.suggest_night_out_bar($1, $2)', [planId, 'probe-bar']);
      await db.query('select public.vote_night_out_bar($1, $2)', [planId, 'probe-bar']);

      await db.query('RESET ROLE');
      await asRole('authenticated', stranger);

      await db.query('SAVEPOINT probe');
      // Denial arrives by one of two mechanisms and both are acceptable: the
      // child tables are not granted to `authenticated` at all (a hard
      // permission-denied), while night_outs/night_out_members are granted and
      // filtered by RLS (zero rows). Asserting only the RLS shape would have
      // made this test fail against the STRONGER protection.
      for (const table of TABLES) {
        const where = table === 'night_outs' ? 'where id = $1' : 'where night_out_id = $1';
        let visibleRows: number | null;
        try {
          const seen = await db.query(`select 1 from public.${table} ${where} limit 1`, [planId]);
          visibleRows = seen.rowCount;
        } catch (error) {
          expect(
            (error as { message: string }).message,
            `public.${table} failed for a reason other than denial`,
          ).toMatch(/permission denied/i);
          visibleRows = 0;
          // A failed statement aborts the transaction; recover so the loop and
          // the write-RPC assertions below still run inside it.
          await db.query('ROLLBACK TO SAVEPOINT probe');
        }
        expect(visibleRows, `an authenticated non-member could read public.${table}`).toBe(0);
        await db.query('RELEASE SAVEPOINT probe');
        await db.query('SAVEPOINT probe');
      }

      // Every member-gated write must refuse this caller. These return false
      // rather than raising — a silent `true` is the regression to catch.
      const gatedWrites: Array<[string, unknown[]]> = [
        ['select public.suggest_night_out_bar($1, $2) as ok', [planId, 'stranger-bar']],
        ['select public.vote_night_out_bar($1, $2) as ok', [planId, 'probe-bar']],
        ['select public.invite_to_night_out($1, $2) as ok', [planId, stranger]],
        ['select public.respond_night_out($1, true) as ok', [planId]],
        ['select public.cancel_night_out($1) as ok', [planId]],
        ['select public.decide_night_out($1, $2) as ok', [planId, 'probe-bar']],
      ];
      for (const [sql, params] of gatedWrites) {
        const { rows: out } = await db.query(sql, params);
        expect(out[0].ok, `a non-member's ${sql.match(/public\.(\w+)/)![1]} was not refused`).toBe(false);
      }

      // And nothing it tried actually landed.
      await db.query('RESET ROLE');
      const leaked = await db.query(
        'select 1 from public.night_out_members where night_out_id = $1 and user_id = $2',
        [planId, stranger],
      );
      expect(leaked.rowCount, 'a refused write still created a membership row').toBe(0);
    });
  });


  it('an explicit accept and an explicit decline both survive and are exactly-once (criterion 8, round-2 fixes)', async () => {
    // What this DOES cover: the conversion paths 0046 restructured — a pending
    // invite converting on a link tap, a fresh recipient declining, and a
    // declined member rejoining explicitly — each landing in the right terminal
    // state with exactly one event.
    //
    // What it does NOT cover, stated plainly: the 20-member CAP BOUNDARY, which
    // is where the round-2 HIGH actually lived. Reaching it needs 21 distinct
    // fixture identities and public.profiles is FK'd to auth.users, which this
    // suite does not manufacture. The ordering invariant that fixes the
    // boundary is guarded statically in nightOutsMigration.test.ts instead.
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      expect(people.length, 'need 2 profiles').toBe(2);
      const [owner, guest] = people.map((r) => r.id as string);

      await asRole('authenticated', owner);
      const { rows: made } = await db.query('select public.create_night_out(current_date, $1) as id', ['accept path probe']);
      const planId = made[0].id as string;
      const { rows: invited } = await db.query('select public.invite_to_night_out($1, $2) as ok', [planId, guest]);
      expect(invited[0].ok, 'owner could not invite').toBe(true);

      await db.query('RESET ROLE');
      const { rows: tok } = await db.query('select share_token from public.night_outs where id = $1', [planId]);
      const token = tok[0].share_token as string;

      // Pending invitee taps the link: converts, and says so.
      await asRole('authenticated', guest);
      const { rows: joined } = await db.query('select public.join_night_out_by_token($1) as id', [token]);
      expect(joined[0].id, 'the invitee could not join by token').toBe(planId);

      await db.query('RESET ROLE');
      const after = await db.query(
        'select invite_status, responded_at from public.night_out_members where night_out_id = $1 and user_id = $2',
        [planId, guest],
      );
      expect(after.rows[0].invite_status, 'an explicit accept did not stick').toBe('accepted');
      expect(after.rows[0].responded_at, 'accepted without a responded_at').not.toBeNull();
      const accepted = await db.query(
        "select count(*)::int as n from public.night_out_events where night_out_id = $1 and actor_id = $2 and kind = 'accepted'",
        [planId, guest],
      );
      expect(accepted.rows[0].n, 'accepted event is not exactly-once').toBe(1);

      // Explicit "Not tonight" after accepting, then an explicit rejoin.
      await asRole('authenticated', guest);
      const { rows: no } = await db.query('select public.respond_night_out($1, false) as ok', [planId]);
      expect(no[0].ok, 'an accepted member could not decline').toBe(true);
      await db.query('RESET ROLE');
      const declined = await db.query(
        'select invite_status from public.night_out_members where night_out_id = $1 and user_id = $2',
        [planId, guest],
      );
      expect(declined.rows[0].invite_status).toBe('declined');

      // A mere link visit must NOT resurrect a declined member (round-1 rule,
      // preserved through two rewrites of this function).
      await asRole('authenticated', guest);
      await db.query('select public.join_night_out_by_token($1) as id', [token]);
      await db.query('RESET ROLE');
      const stillDeclined = await db.query(
        'select invite_status from public.night_out_members where night_out_id = $1 and user_id = $2',
        [planId, guest],
      );
      expect(stillDeclined.rows[0].invite_status, 'visiting a link silently re-accepted a declined member')
        .toBe('declined');

      // ...but an EXPLICIT rejoin does, when there is room.
      await asRole('authenticated', guest);
      const { rows: back } = await db.query('select public.respond_night_out($1, true) as ok', [planId]);
      expect(back[0].ok, 'an explicit rejoin was refused while under the cap').toBe(true);
      await db.query('RESET ROLE');
      const rejoined = await db.query(
        'select invite_status from public.night_out_members where night_out_id = $1 and user_id = $2',
        [planId, guest],
      );
      expect(rejoined.rows[0].invite_status).toBe('accepted');
    });
  });


  it('a FRESH bearer-link recipient can join, and a different one can decline (criterion 2, round-3 gap)', async () => {
    // Round-3 review (Codex): the lifecycle test above invites the guest first,
    // so it only ever exercised the CONVERSION branches. Removing either
    // fresh-row INSERT in 0046 would have left every behavioral gate green
    // while criterion 2 — "an invited account OR link recipient can accept and
    // decline" — was broken for the link-recipient half.
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      expect(people.length, 'need 2 profiles').toBe(2);
      const [owner, guest] = people.map((r) => r.id as string);

      await asRole('authenticated', owner);
      const { rows: a } = await db.query('select public.create_night_out(current_date, $1) as id', ['fresh join probe']);
      const { rows: b } = await db.query('select public.create_night_out(current_date + 1, $1) as id', ['fresh decline probe']);
      const planJoin = a[0].id as string;
      const planDecline = b[0].id as string;

      await db.query('RESET ROLE');
      const { rows: tokens } = await db.query(
        'select id, share_token from public.night_outs where id = any($1::uuid[])',
        [[planJoin, planDecline]],
      );
      const tokenFor = (id: string) => tokens.find((r) => r.id === id)!.share_token as string;

      // No invite anywhere: the guest holds only the link.
      const priorMembership = await db.query(
        'select 1 from public.night_out_members where user_id = $1 and night_out_id = any($2::uuid[])',
        [guest, [planJoin, planDecline]],
      );
      expect(priorMembership.rowCount, 'the guest was already a member; this test proves nothing').toBe(0);

      await asRole('authenticated', guest);
      const { rows: joined } = await db.query('select public.join_night_out_by_token($1) as id', [tokenFor(planJoin)]);
      expect(joined[0].id, 'a fresh link recipient could not join').toBe(planJoin);
      const { rows: declined } = await db.query('select public.decline_night_out_by_token($1) as id', [tokenFor(planDecline)]);
      expect(declined[0].id, 'a fresh link recipient could not decline').toBe(planDecline);

      await db.query('RESET ROLE');
      const rows = await db.query(
        'select night_out_id, invite_status from public.night_out_members where user_id = $1 and night_out_id = any($2::uuid[])',
        [guest, [planJoin, planDecline]],
      );
      const byPlan = new Map(rows.rows.map((r) => [r.night_out_id as string, r.invite_status as string]));
      expect(byPlan.get(planJoin), 'a fresh join did not create an accepted row').toBe('accepted');
      expect(byPlan.get(planDecline), 'a fresh decline did not create a declined row').toBe('declined');

      // Declining without joining must not have announced an acceptance.
      const events = await db.query(
        "select count(*)::int as n from public.night_out_events where night_out_id = $1 and actor_id = $2",
        [planDecline, guest],
      );
      expect(events.rows[0].n, 'declining emitted an event').toBe(0);
    });
  });

  it('share_token is not readable through a direct table read, at any membership status (round-3 HIGH)', async () => {
    // 0045 gated share_token inside get_night_out; 0047 had to take it out of
    // the authenticated column grant, because the RPC gate was decorative while
    // the table grant admitted every member status.
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      const [owner, guest] = people.map((r) => r.id as string);

      await asRole('authenticated', owner);
      const { rows: made } = await db.query('select public.create_night_out(current_date, $1) as id', ['token grant probe']);
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1, $2) as ok', [planId, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      let denied: string | null = null;
      try {
        await db.query('select share_token from public.night_outs where id = $1', [planId]);
      } catch (error) {
        denied = (error as { message: string }).message;
      }
      expect(denied, 'a member read share_token straight off the table').toMatch(/permission denied/i);
    });
  });

  /**
   * THE CAP BOUNDARY, BEHAVIORALLY. Finally.
   *
   * This gap was recorded three times as "not testable — it needs 21 distinct
   * fixture identities and public.profiles is FK-bound to auth.users, which
   * this suite does not manufacture", and the 20-member invariant shipped
   * guarded only by SQL text-order assertions. A cold reviewer made the sharper
   * point: those assertions would still pass if someone changed the advisory
   * lock to a per-USER key, which would let concurrent callers sail past the
   * cap.
   *
   * The claim was never checked. auth.users requires exactly one NOT NULL
   * column without a default (id), and an AFTER INSERT trigger
   * (on_auth_user_created) creates the profile row. Inside a rolled-back
   * transaction that is a fixture factory, and it always was.
   */
  async function makeIdentities(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [id]);
      ids.push(id);
    }
    // The trigger owes us a profile for each, or the FK below would fail anyway.
    const { rows } = await db.query(
      'select count(*)::int as n from public.profiles where id = any($1::uuid[])',
      [ids],
    );
    expect(rows[0].n, 'the auth.users trigger did not create profiles').toBe(count);
    return ids;
  }

  it('enforces the 20-member cap, and lets a pending invitee convert AT the boundary (criterion 8)', async () => {
    await inRollback(async () => {
      const ids = await makeIdentities(22);
      const [owner, boundary, extra, ...fillers] = ids;

      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(current_date, $1) as id',
        ['cap boundary probe'],
      );
      const planId = made[0].id as string;

      // Owner is member 1 (accepted). 18 fillers + the boundary invitee = 20.
      for (const uid of fillers.slice(0, 18)) {
        const { rows } = await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, uid]);
        expect(rows[0].ok, 'filling below the cap was refused').toBe(true);
      }
      const { rows: inv20 } = await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, boundary]);
      expect(inv20[0].ok).toBe(true);

      await db.query('RESET ROLE');
      const seats = await db.query('select public.night_out_seat_count($1) as n', [planId]);
      expect(seats.rows[0].n, 'the fixture did not actually reach the cap').toBe(20);

      // The cap is real: a 21st NEW member is refused.
      await asRole('authenticated', owner);
      const { rows: over } = await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, extra]);
      expect(over[0].ok, 'the member cap did not hold at 20').toBe(false);

      // ...and the pending invitee can still accept. This is the invariant the
      // ordering fix exists for: converting your own invite is not a new seat,
      // so a full plan must not refuse it.
      await db.query('RESET ROLE');
      const { rows: tok } = await db.query('select share_token from public.night_outs where id=$1', [planId]);
      await asRole('authenticated', boundary);
      const { rows: joined } = await db.query('select public.join_night_out_by_token($1) as id', [tok[0].share_token]);
      expect(joined[0].id, 'a pending invitee could not accept at the cap boundary').toBe(planId);

      await db.query('RESET ROLE');
      const after = await db.query(
        'select invite_status from public.night_out_members where night_out_id=$1 and user_id=$2',
        [planId, boundary],
      );
      expect(after.rows[0].invite_status, 'the accept was lost at the boundary').toBe('accepted');
      const still = await db.query('select public.night_out_seat_count($1) as n', [planId]);
      expect(still.rows[0].n, 'converting an invite consumed a new seat').toBe(20);
    });
  });

  it('refuses a declined member rejoining a full plan, and lets them in once a seat frees', async () => {
    await inRollback(async () => {
      const ids = await makeIdentities(22);
      const [owner, quitter, replacement, ...fillers] = ids;

      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(current_date, $1) as id',
        ['rejoin boundary probe'],
      );
      const planId = made[0].id as string;
      for (const uid of fillers.slice(0, 18)) {
        await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, uid]);
      }
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, quitter]);

      // quitter declines, freeing a seat; replacement takes it; plan full again.
      await db.query('RESET ROLE');
      await asRole('authenticated', quitter);
      expect((await db.query('select public.respond_night_out($1,false) as ok', [planId])).rows[0].ok).toBe(true);
      await db.query('RESET ROLE');
      await asRole('authenticated', owner);
      expect((await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, replacement])).rows[0].ok).toBe(true);
      await db.query('RESET ROLE');
      expect((await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n).toBe(20);

      // The rejoin hole: a declined member must not get back into a full plan.
      await asRole('authenticated', quitter);
      const { rows: back } = await db.query('select public.respond_night_out($1,true) as ok', [planId]);
      expect(back[0].ok, 'a declined member rejoined past the cap').toBe(false);
      await db.query('RESET ROLE');
      expect(
        (await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n,
        'accepted membership exceeded the cap via rejoin',
      ).toBe(20);

      // Free one seat; now the rejoin is legitimate and must succeed.
      await asRole('authenticated', replacement);
      await db.query('select public.respond_night_out($1,false) as ok', [planId]);
      await db.query('RESET ROLE');
      await asRole('authenticated', quitter);
      const { rows: back2 } = await db.query('select public.respond_night_out($1,true) as ok', [planId]);
      expect(back2[0].ok, 'a declined member could not rejoin a plan with room').toBe(true);
    });
  });

  /**
   * Criterion 3, and the ONLY test in this file that commits.
   *
   * 0050 fixed a check-then-act seam that exists only ACROSS two sessions: B's
   * pre-lock duplicate check runs against a snapshot taken before A's insert
   * commits, so B reaches the advisory lock believing the target is not a
   * member, and — before 0050 — asked about capacity instead of re-reading its
   * own subject, returning false for an invite that had in fact just succeeded.
   *
   * A single connection inside a rolled-back transaction cannot express that:
   * one session never observes its own uncommitted rows as a race. So the
   * fixture is committed and torn down in `finally` instead. Two facts make
   * that acceptable on the serving database: the rows are synthetic identities
   * created by this file, and the plan cascade removes everything hanging off
   * it. Nothing here touches a row it did not create.
   *
   * The handoff is gated on `pg_stat_activity` showing B parked on a Lock
   * rather than on a sleep. That is not a speed optimisation — a sleep would
   * make the test pass for the wrong reason whenever B had not yet reached the
   * lock, which is exactly the interleaving under test.
   */
  itCommitting('a concurrent duplicate invite at the cap boundary is idempotent, not a failure (criterion 3)', async () => {
    const db2 = new Client({
      connectionString: URL as string,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30000,
      application_name: 'v8-3-invite-race-b',
    });
    await db2.connect();

    let planId: string | null = null;
    let identities: string[] = [];
    try {
      // Collected INCREMENTALLY, not by assigning makeIdentities' return value
      // (round 2, Codex): each identity is its own autocommitted insert, so a
      // throw partway through — the profile-trigger assertion, a transient
      // error — left `identities` still [] and stranded every row already
      // committed. The cleanup can only delete what it knows about, so it has
      // to learn each id at the moment that id becomes real.
      for (let i = 0; i < 21; i += 1) {
        identities.push(...(await makeIdentities(1)));
      }
      const [owner, target, extra, ...fillers] = identities;

      // Committed fixture: 19 seats (owner + 18 fillers), one seat left, and
      // `target` deliberately NOT yet a member. This transaction COMMITS —
      // `SET LOCAL ROLE` and the jwt claim are transaction-scoped, so the
      // fixture has to be built inside one and then made visible to session B.
      await db.query('BEGIN');
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(current_date, $1) as id',
        ['invite race probe'],
      );
      planId = made[0].id as string;
      for (const uid of fillers.slice(0, 18)) {
        await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, uid]);
      }
      await db.query('COMMIT');

      expect(
        (await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n,
        'the fixture did not stop one seat short of the cap',
      ).toBe(19);
      // Baseline, not a hard-coded fixture count: the invariant under test is
      // that the DUPLICATE adds no event, whatever the setup happened to emit.
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.night_out_events"
        + " where night_out_id=$1 and kind='invited'",
        [planId],
      );
      const invitedEventsBefore = before[0].n as number;

      const { rows: pidRows } = await db2.query('select pg_backend_pid() as pid');
      const bPid = pidRows[0].pid as number;

      // A: invite target, hold the transaction open. The lock is held and the
      // insert is uncommitted.
      await db.query('BEGIN');
      await asRole('authenticated', owner);
      const { rows: aRows } = await db.query(
        'select public.invite_to_night_out($1,$2) as ok',
        [planId, target],
      );
      expect(aRows[0].ok, 'the uncontended invite failed before the race started').toBe(true);

      // B: the same invite. Passes the fast path (A is uncommitted, so target
      // is invisible), then parks on the advisory lock.
      const bInvite = (async () => {
        await db2.query('BEGIN');
        await db2.query('SET LOCAL ROLE authenticated');
        await db2.query("SELECT set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: owner, role: 'authenticated' }),
        ]);
        return db2.query('select public.invite_to_night_out($1,$2) as ok', [planId, target]);
      })();

      // Wait for B to be genuinely blocked ON THE LOCK before releasing A.
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        const { rows } = await db.query(
          "select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
          [bPid],
        );
        blocked = rows.length === 1;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked, 'session B never reached the advisory lock; the race did not happen').toBe(true);

      await db.query('COMMIT');

      // THE ASSERTION. Seats are now 20 and target is already a member. Before
      // 0050 this returned false — "your invite failed" for an invite that had
      // just succeeded.
      const bResult = await bInvite;
      expect(
        bResult.rows[0].ok,
        'a duplicate invite at the cap boundary reported failure instead of being idempotent',
      ).toBe(true);
      await db2.query('COMMIT');

      // Idempotent means idempotent: one row, one event, one seat consumed.
      const { rows: memberRows } = await db.query(
        'select count(*)::int as n from public.night_out_members where night_out_id=$1 and user_id=$2',
        [planId, target],
      );
      expect(memberRows[0].n, 'the racing invites created two membership rows').toBe(1);
      expect(
        (await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n,
        'the race consumed more than one seat',
      ).toBe(20);
      const { rows: eventRows } = await db.query(
        "select count(*)::int as n from public.night_out_events"
        + " where night_out_id=$1 and kind='invited'",
        [planId],
      );
      expect(
        eventRows[0].n - invitedEventsBefore,
        'the racing pair emitted more than the one invited event that actually happened',
      ).toBe(1);

      // And the cap still holds for a genuinely new member — the idempotent
      // answer must not have become "always true". Rolled back: this one is
      // only interesting for its return value.
      await db.query('BEGIN');
      await asRole('authenticated', owner);
      const { rows: over } = await db.query(
        'select public.invite_to_night_out($1,$2) as ok',
        [planId, extra],
      );
      expect(over[0].ok, 'the cap stopped being enforced for a new member').toBe(false);
      await db.query('ROLLBACK');
    } finally {
      // Best-effort unwind, in reverse order of creation. Any transaction left
      // open by a failed assertion is rolled back first, or the deletes block
      // on their own locks.
      await db2.query('ROLLBACK').catch(() => {});
      await db.query('ROLLBACK').catch(() => {});
      await db.query('RESET ROLE').catch(() => {});
      if (planId !== null) {
        await db.query('delete from public.night_outs where id=$1', [planId]).catch(() => {});
      }
      if (identities.length > 0) {
        await db
          .query('delete from auth.users where id = any($1::uuid[])', [identities])
          .catch(() => {});
      }
      await db2.end().catch(() => {});
    }
  });

  it('two plans on the SAME night stay isolated from each other (criterion 9)', async () => {
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      expect(people.length, 'need 2 profiles to prove same-night isolation').toBe(2);
      const [a, b] = people.map((r) => r.id as string);

      await asRole('authenticated', a);
      const { rows: ra } = await db.query('select public.create_night_out(current_date, $1) as id', ['plan A']);
      const planA = ra[0].id as string;

      await db.query('RESET ROLE');
      await asRole('authenticated', b);
      const { rows: rb } = await db.query('select public.create_night_out(current_date, $1) as id', ['plan B']);
      const planB = rb[0].id as string;
      expect(planA).not.toEqual(planB);

      // B is looking: B sees exactly B's plan, on a night both plans share.
      const visible = await db.query(
        'select id from public.night_outs where night = current_date order by id',
      );
      const ids = visible.rows.map((r) => r.id as string);
      expect(ids, 'same-night plans leaked across owners').toContain(planB);
      expect(ids, 'same-night plans leaked across owners').not.toContain(planA);
    });
  });
});
