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

  /**
   * respond_night_out, carrying the caller's CURRENT view.
   *
   * 0059 made the response revision part of the contract and dropped the
   * 3-argument overload, so every call needs the pair. In these sequential
   * single-connection tests the caller always acts on the row as it stands, so
   * the revision is read inline — the same thing a UI does when it renders a
   * card immediately before the tap. Tests that need a STALE revision (the
   * replay cases) pass it explicitly instead and do not use this.
   *
   * For a non-member the subquery yields NULL, which the RPC refuses — which is
   * exactly what the gated-write probes assert.
   *
   * Params: [planId, accept, expectedStatus].
   */
  const RESPOND = `select public.respond_night_out($1, $2, $3,
    (select m.response_revision from public.night_out_members m
      where m.night_out_id = $1 and m.user_id = auth.uid())) as ok`;

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
      ['respond_night_out', `select public.respond_night_out('${randomUUID()}'::uuid, true, 'pending', 0)`],
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
      ['get_my_night_outs', 'select public.get_my_night_outs()'],
      // 0059's revision trigger function. It `returns trigger`, so PostgreSQL
      // would refuse a direct call anyway — but it is SECURITY DEFINER, and the
      // EXECUTE privilege is checked BEFORE the trigger-context error, so the
      // revoke is what actually answers here and is worth asserting. Verified:
      // both anon and authenticated get "permission denied for function".
      ['night_out_members_bump_revision', 'select public.night_out_members_bump_revision()'],
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
      const { rows } = await db.query('select public.create_night_out(current_date, $1, null) as id', [
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
      const { rows } = await db.query('select public.create_night_out(current_date, $1, null) as id', [
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
        [RESPOND, [planId, true, 'declined']],
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
      const { rows: made } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['accept path probe']);
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
      const { rows: no } = await db.query(
        RESPOND,
        [planId, false, 'accepted'],
      );
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
      const { rows: back } = await db.query(
        RESPOND,
        [planId, true, 'declined'],
      );
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
      const { rows: a } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['fresh join probe']);
      const { rows: b } = await db.query('select public.create_night_out(current_date + 1, $1, null) as id', ['fresh decline probe']);
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
      const { rows: made } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['token grant probe']);
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
        'select public.create_night_out(current_date, $1, null) as id',
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
        'select public.create_night_out(current_date, $1, null) as id',
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
      expect(
        (await db.query(RESPOND, [planId, false, 'pending']))
          .rows[0].ok,
      ).toBe(true);
      await db.query('RESET ROLE');
      await asRole('authenticated', owner);
      expect((await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, replacement])).rows[0].ok).toBe(true);
      await db.query('RESET ROLE');
      expect((await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n).toBe(20);

      // The rejoin hole: a declined member must not get back into a full plan.
      await asRole('authenticated', quitter);
      const { rows: back } = await db.query(
        RESPOND,
        [planId, true, 'declined'],
      );
      expect(back[0].ok, 'a declined member rejoined past the cap').toBe(false);
      await db.query('RESET ROLE');
      expect(
        (await db.query('select public.night_out_seat_count($1) as n', [planId])).rows[0].n,
        'accepted membership exceeded the cap via rejoin',
      ).toBe(20);

      // Free one seat; now the rejoin is legitimate and must succeed.
      await asRole('authenticated', replacement);
      await db.query(RESPOND, [planId, false, 'pending']);
      await db.query('RESET ROLE');
      await asRole('authenticated', quitter);
      const { rows: back2 } = await db.query(
        RESPOND,
        [planId, true, 'declined'],
      );
      expect(back2[0].ok, 'a declined member could not rejoin a plan with room').toBe(true);
    });
  });

  it('get_my_night_outs shows each caller only their own memberships (criterion 3)', async () => {
    await inRollback(async () => {
      const [owner, guest, stranger] = await makeIdentities(3);

      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(current_date + 3, $1, null) as id',
        ['my-invites probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      // The invitee sees it.
      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      const mine = await db.query('select * from public.get_my_night_outs()');
      const row = mine.rows.find((r) => r.night_out_id === planId);
      expect(row, 'an invited account could not see its own invitation').toBeTruthy();
      expect(row.my_status).toBe('pending');
      expect(row.owner_handle ?? row.owner_display_name, 'the card cannot name who invited you').toBeDefined();

      // A stranger does not.
      await db.query('RESET ROLE');
      await asRole('authenticated', stranger);
      const theirs = await db.query('select * from public.get_my_night_outs()');
      expect(
        theirs.rows.some((r) => r.night_out_id === planId),
        'a stranger saw a plan they were never invited to',
      ).toBe(false);
    });
  });

  it('get_my_night_outs releases share_token ONLY to an accepted member (0047 rule)', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);

      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(current_date + 3, $1, null) as id',
        ['token gating probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      const readAs = async (uid: string) => {
        await db.query('RESET ROLE');
        await asRole('authenticated', uid);
        const { rows } = await db.query('select * from public.get_my_night_outs()');
        return rows.find((r) => r.night_out_id === planId);
      };

      // Pending: no token. "View plan" is not reachable before accepting.
      expect((await readAs(guest)).share_token, 'a pending invitee was handed the share token').toBeNull();

      // Accepted: token, because that is how the plan page is reached. The
      // invitee is PENDING here — that is the state this accept acts on.
      await db.query(RESPOND, [planId, true, 'pending']);
      const accepted = await readAs(guest);
      expect(accepted.my_status).toBe('accepted');
      expect(accepted.share_token, 'an accepted member could not reach the plan').not.toBeNull();

      // Declined: token withdrawn again.
      await db.query(RESPOND, [planId, false, 'accepted']);
      const declined = await readAs(guest);
      expect(declined.my_status).toBe('declined');
      expect(declined.share_token, 'a declined member kept the share token').toBeNull();
    });
  });

  it('get_my_night_outs hides cancelled plans and flags a plan changed after you responded', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: a } = await db.query(
        'select public.create_night_out(current_date + 3, $1, null) as id', ['updated probe'],
      );
      const { rows: b } = await db.query(
        'select public.create_night_out(current_date + 4, $1, null) as id', ['cancelled probe'],
      );
      const updatedPlan = a[0].id as string;
      const cancelledPlan = b[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [updatedPlan, guest]);
      await db.query('select public.invite_to_night_out($1,$2) as ok', [cancelledPlan, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      // This invitee is pending — they are accepting for the first time.
      await db.query(
        RESPOND,
        [updatedPlan, true, 'pending'],
      );

      // A plan_changed event AFTER the response is what "Updated" means.
      await db.query('RESET ROLE');
      // created_at is given an EXPLICIT later stamp on purpose: inside a single
      // transaction now() is frozen, so a defaulted event would carry exactly
      // the same timestamp as the response and `created_at > responded_at`
      // would be false. Production writes these in separate transactions. The
      // strict `>` is correct and deliberate — `>=` would flag the moment of
      // your own acceptance as an update to it.
      await db.query(
        "insert into public.night_out_events (night_out_id, actor_id, kind, created_at)"
        + " values ($1,$2,'plan_changed', now() + interval '1 minute')",
        [updatedPlan, owner],
      );
      await asRole('authenticated', owner);
      await db.query('select public.cancel_night_out($1) as ok', [cancelledPlan]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      const { rows } = await db.query('select * from public.get_my_night_outs()');
      const updated = rows.find((r) => r.night_out_id === updatedPlan);
      expect(updated.plan_updated, 'a change after responding was not flagged').toBe(true);
      expect(
        rows.some((r) => r.night_out_id === cancelledPlan),
        'a cancelled plan still appeared in the invite list',
      ).toBe(false);
    });
  });

  it('the night rollover is NYC with a 6am boundary, not UTC (cold panel HIGH)', async () => {
    // Pinned instants, because the defect lives in a three-to-four hour window
    // each evening and a test that reads the wall clock passes by accident.
    const cases: Array<[string, string, string]> = [
      ['2026-08-17T02:00:00Z', '2026-08-16', '22:00 EDT — the hours the bug lived in'],
      ['2026-08-17T09:00:00Z', '2026-08-16', '05:00 EDT — before the 6am rollover'],
      ['2026-08-17T11:00:00Z', '2026-08-17', '07:00 EDT — after it'],
      ['2026-01-15T02:00:00Z', '2026-01-14', '21:00 EST — winter, UTC-5'],
    ];
    for (const [instant, expected, why] of cases) {
      const { rows } = await db.query('select public.nyc_night_key($1::timestamptz) as night', [instant]);
      expect(rows[0].night.toISOString().slice(0, 10), why).toBe(expected);
    }
    // And the thing that actually broke: UTC disagrees at those instants.
    const { rows: utc } = await db.query(
      "select ($1::timestamptz at time zone 'UTC')::date as d",
      ['2026-08-17T02:00:00Z'],
    );
    expect(
      utc[0].d.toISOString().slice(0, 10),
      'if UTC agreed here there would have been no bug to fix',
    ).toBe('2026-08-17');
  });

  it('an invitation to TONIGHT is not expired during tonight (cold panel HIGH)', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['tonight'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      const { rows } = await db.query('select * from public.get_my_night_outs()');
      const row = rows.find((r) => r.night_out_id === planId);
      expect(row, 'the invitee cannot see tonight-s invitation at all').toBeTruthy();
      expect(row.is_past, 'an invitation to tonight was marked expired').toBe(false);
      expect(row.my_status).toBe('pending');
    });
  });

  it('get_my_night_outs lists invitations, not the plans you own', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: mine } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['my own plan'],
      );
      const ownPlan = mine[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [ownPlan, guest]);

      // The owner holds an accepted membership row for their own plan; it must
      // not surface on a surface that means "what am I invited to?".
      const { rows: ownerSees } = await db.query('select * from public.get_my_night_outs()');
      expect(
        ownerSees.some((r) => r.night_out_id === ownPlan),
        'your own plan appeared as an invitation to yourself',
      ).toBe(false);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      const { rows: guestSees } = await db.query('select * from public.get_my_night_outs()');
      expect(
        guestSees.some((r) => r.night_out_id === ownPlan),
        'the invitee could not see the invitation',
      ).toBe(true);
    });
  });

  it('a retried create with the same key returns the SAME plan, not a second one', async () => {
    await inRollback(async () => {
      const [owner] = await makeIdentities(1);
      await asRole('authenticated', owner);
      const key = randomUUID();

      const first = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, $2::uuid) as id',
        ['idempotency probe', key],
      );
      const second = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, $2::uuid) as id',
        ['idempotency probe', key],
      );
      expect(second.rows[0].id, 'the retry created a SECOND plan').toBe(first.rows[0].id);

      await db.query('RESET ROLE');
      const { rows: count } = await db.query(
        'select count(*)::int as n from public.night_outs where owner_id = $1 and idempotency_key = $2',
        [owner, key],
      );
      expect(count[0].n).toBe(1);
    });
  });

  it('a DIFFERENT key from the same owner still creates a distinct plan', async () => {
    await inRollback(async () => {
      const [owner] = await makeIdentities(1);
      await asRole('authenticated', owner);
      const a = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, $2::uuid) as id',
        ['first', randomUUID()],
      );
      const b = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, $2::uuid) as id',
        ['second', randomUUID()],
      );
      expect(b.rows[0].id).not.toBe(a.rows[0].id);
    });
  });

  it('a REPLAYED accept cannot reverse a later decline (cold panel HIGH, criterion 8)', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['replay probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);

      // 1. The invitee accepts, from a pending card.
      expect(
        (await db.query(RESPOND, [planId, true, 'pending']))
          .rows[0].ok,
      ).toBe(true);

      // 2. They change their mind and decline. This is their real, later decision.
      expect(
        (await db.query(RESPOND, [planId, false, 'accepted']))
          .rows[0].ok,
      ).toBe(true);

      // 3. The step-1 request is REPLAYED — a retried fetch, a double tap, a
      //    queued request finally landing. It still carries 'pending', the
      //    state the user was looking at when they first tapped Accept.
      const replay = await db.query(
        RESPOND,
        [planId, true, 'pending'],
      );
      expect(replay.rows[0].ok, 'a replayed accept was applied').toBe(false);

      await db.query('RESET ROLE');
      const { rows: after } = await db.query(
        'select invite_status from public.night_out_members where night_out_id=$1 and user_id=$2',
        [planId, guest],
      );
      expect(
        after[0].invite_status,
        'the replay reversed a consent decision the user had already made',
      ).toBe('declined');

      // And it recorded no second acceptance.
      const { rows: events } = await db.query(
        "select count(*)::int as n from public.night_out_events where night_out_id=$1 and actor_id=$2 and kind='accepted'",
        [planId, guest],
      );
      expect(events[0].n, 'the replay logged another accepted event').toBe(1);
    });
  });

  it('an honest change of mind still works — declined to accepted with the right expectation', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['rejoin probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      await db.query(RESPOND, [planId, false, 'pending']);
      // "Count me back in", acting on the declined card actually on screen.
      expect(
        (await db.query(RESPOND, [planId, true, 'declined']))
          .rows[0].ok,
        'a legitimate change of mind was refused',
      ).toBe(true);

      await db.query('RESET ROLE');
      const { rows: after } = await db.query(
        'select invite_status from public.night_out_members where night_out_id=$1 and user_id=$2',
        [planId, guest],
      );
      expect(after[0].invite_status).toBe('accepted');
    });
  });

  it('rejects a malformed or absent expected state rather than guessing', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['expectation probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);

      await db.query('RESET ROLE');
      await asRole('authenticated', guest);
      for (const bogus of [null, 'made-up', '']) {
        const { rows } = await db.query(RESPOND, [planId, true, bogus]);
        expect(rows[0].ok, `expected state ${JSON.stringify(bogus)} was accepted`).toBe(false);
      }

      // 0059: the revision is the other half of the expectation and gets the
      // same treatment. A missing revision must not read as "skip the check",
      // and a revision from the FUTURE must be refused too — a comparison
      // written as >= or <> instead of = would let it through.
      for (const bogusRevision of [null, -1, 999]) {
        const { rows } = await db.query(
          `select public.respond_night_out($1, true, $2, $3) as ok`,
          [planId, 'pending', bogusRevision],
        );
        expect(
          rows[0].ok,
          `expected revision ${JSON.stringify(bogusRevision)} was accepted`,
        ).toBe(false);
      }
      await db.query('RESET ROLE');
      const { rows: after } = await db.query(
        'select invite_status from public.night_out_members where night_out_id=$1 and user_id=$2',
        [planId, guest],
      );
      expect(after[0].invite_status, 'a bogus expectation still changed the row').toBe('pending');
    });
  });

  /**
   * CRITERION 4, the database-side half — the one this file was missing.
   *
   * "No caller can invoke the unguarded form" was only ever proved from the
   * migration TEXT: 0057 drops the 2-argument overload, 0059 drops the
   * 3-argument one. But `drop function if exists` is silently a no-op if the
   * overload is later re-created, and three applied files (0044/0046/0048)
   * still contain a `create or replace` of the 2-argument form — a partial
   * hand-apply or a replayed hotfix puts it back. Every other call in this file
   * now uses the 4-argument form, so nothing here would notice; the replay hole
   * would simply be reachable again through the old signature (round-3 review,
   * Claude, medium).
   *
   * 42883 is undefined_function: the name resolves to no such argument list.
   */
  it('the superseded respond_night_out overloads are GONE from this database (criterion 4)', async () => {
    const superseded: Array<[string, string]> = [
      ['2-argument (dropped by 0057)', `select public.respond_night_out('${randomUUID()}'::uuid, true)`],
      ['3-argument (dropped by 0059)', `select public.respond_night_out('${randomUUID()}'::uuid, true, 'pending')`],
    ];
    for (const [label, sql] of superseded) {
      const code = await inRollback(async () => {
        try {
          await db.query(sql);
          return null;
        } catch (error) {
          return (error as { code?: string }).code ?? null;
        }
      });
      expect(code, `the ${label} overload still resolves on this database`).toBe('42883');
    }

    // The two probes above only cover the signatures we thought to name. This
    // is the same prove-the-list assertion the anon-denial test carries: ask the
    // catalog what actually exists, so a THIRD overload nobody listed cannot
    // sit there unnoticed.
    const { rows } = await db.query(`
      select pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'respond_night_out'`);
    // Argument NAMES are asserted too, not just types: PostgREST resolves an
    // RPC by the named keys in the JSON body, so a rename is a caller-breaking
    // change on the same footing as a signature change.
    expect(rows.map((r) => r.args as string), 'respond_night_out has an unexpected overload set')
      .toEqual([
        'p_night_out uuid, p_accept boolean, p_expected_status text, p_expected_revision integer',
      ]);
  });

  /**
   * 0059 — a status is not a version.
   *
   * 0057 refused a caller whose expected STATUS no longer matched, and 0058 put
   * that guard in the UPDATE's own predicate so it held under concurrency.
   * Neither stopped a REPLAY, because a row can return to a status it already
   * held and the stale request then matches again. Reproduced against this
   * database on 2026-08-17 before the fix.
   *
   * Both directions are asserted. A fix that only guards one of them passes the
   * first half and is still wrong.
   */
  it('a replayed response cannot reverse a later decision (0059, both directions)', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['replay probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);
      await db.query('RESET ROLE');

      /** The pair a caller would have rendered, read as the owner would not. */
      const held = async (): Promise<{ status: string; revision: number }> => {
        const { rows } = await db.query(
          `select invite_status, response_revision from public.night_out_members
            where night_out_id = $1 and user_id = $2`,
          [planId, guest],
        );
        return { status: rows[0].invite_status as string, revision: Number(rows[0].response_revision) };
      };
      /** Respond carrying a REMEMBERED pair — replaying means reusing one. */
      const respondHolding = async (
        accept: boolean,
        view: { status: string; revision: number },
      ): Promise<boolean> => {
        await asRole('authenticated', guest);
        const { rows } = await db.query(
          'select public.respond_night_out($1, $2, $3, $4) as ok',
          [planId, accept, view.status, view.revision],
        );
        await db.query('RESET ROLE');
        return rows[0].ok as boolean;
      };

      // Forward: decline, accept, decline — then replay the ACCEPT.
      const v0 = await held();
      expect(v0.revision, 'a fresh membership must start at revision 0').toBe(0);
      await respondHolding(false, v0);
      const vAccept = await held(); // the view the replayed request carried
      await respondHolding(true, vAccept);
      const vDecline = await held();
      await respondHolding(false, vDecline);
      expect((await held()).status, 'setup: the last real decision was decline').toBe('declined');

      expect(
        await respondHolding(true, vAccept),
        'a replayed accept was applied',
      ).toBe(false);
      expect(
        (await held()).status,
        'a replayed accept reversed the last decline — the ABA hole is open',
      ).toBe('declined');

      // Reverse: the same hole in the other direction, on the same row.
      const vBack = await held();
      await respondHolding(true, vBack);
      const vReverseDecline = await held(); // this one gets replayed
      await respondHolding(false, vReverseDecline);
      const vReverseAccept = await held();
      await respondHolding(true, vReverseAccept);
      expect((await held()).status, 'setup: the last real decision was accept').toBe('accepted');

      expect(
        await respondHolding(false, vReverseDecline),
        'a replayed decline was applied',
      ).toBe(false);
      expect(
        (await held()).status,
        'a replayed decline reversed the last accept — the fix guards only one direction',
      ).toBe('accepted');

      // The honest path must still work, and every accepted transition must
      // have moved the revision — a counter that stands still is not a version.
      const now = await held();
      expect(now.revision, 'the revision did not advance across six state changes')
        .toBeGreaterThanOrEqual(6);
      expect(await respondHolding(false, now), 'an honest decline was refused').toBe(true);
      expect((await held()).status).toBe('declined');
    });
  });

  /**
   * The revision READ contract, at the SQL boundary.
   *
   * Found by review: everything else tests the revision somewhere it is mocked
   * or read directly. The live ABA test queries `night_out_members` itself; the
   * wrapper and component tests supply RPC rows by hand. So both read functions
   * could return a constant 0 and the entire suite would stay green — while
   * every legitimate UI response failed the moment a membership passed revision
   * 0, because the caller would send 0 against a row that had moved on.
   *
   * This asserts the two reads that feed the two response surfaces actually
   * carry the row's revision, and that it MOVES.
   */
  it('get_night_out and get_my_night_outs return the live response_revision (0059)', async () => {
    await inRollback(async () => {
      const [owner, guest] = await makeIdentities(2);
      await asRole('authenticated', owner);
      const { rows: made } = await db.query(
        'select public.create_night_out(public.nyc_night_key(), $1, null) as id',
        ['revision read probe'],
      );
      const planId = made[0].id as string;
      await db.query('select public.invite_to_night_out($1,$2) as ok', [planId, guest]);
      await db.query('RESET ROLE');

      const rowRevision = async (): Promise<number> => {
        const { rows } = await db.query(
          `select response_revision from public.night_out_members
            where night_out_id = $1 and user_id = $2`, [planId, guest],
        );
        return Number(rows[0].response_revision);
      };
      const readBack = async (): Promise<{ plan: number; list: number }> => {
        await asRole('authenticated', guest);
        const { rows: one } = await db.query(
          'select caller_revision from public.get_night_out($1)', [planId]);
        const { rows: many } = await db.query(
          'select night_out_id, my_revision from public.get_my_night_outs()');
        await db.query('RESET ROLE');
        const mine = many.find((r) => r.night_out_id === planId);
        expect(mine, 'the invitee could not see the plan in get_my_night_outs').toBeTruthy();
        return { plan: Number(one[0].caller_revision), list: Number(mine.my_revision) };
      };

      const atZero = await readBack();
      expect(atZero.plan, 'get_night_out did not report the fresh revision 0').toBe(0);
      expect(atZero.list, 'get_my_night_outs did not report the fresh revision 0').toBe(0);

      // Move it, twice, so a hardcoded 0 cannot pass.
      await asRole('authenticated', guest);
      await db.query(RESPOND, [planId, false, 'pending']);
      await db.query(RESPOND, [planId, true, 'declined']);
      await db.query('RESET ROLE');

      const moved = await rowRevision();
      expect(moved, 'two responses did not advance the stored revision').toBe(2);
      const after = await readBack();
      expect(after.plan, 'get_night_out does not carry the live revision').toBe(moved);
      expect(after.list, 'get_my_night_outs does not carry the live revision').toBe(moved);
    });
  });

  it('two plans on the SAME night stay isolated from each other (criterion 9)', async () => {
    await inRollback(async () => {
      const { rows: people } = await db.query('select id from public.profiles limit 2');
      expect(people.length, 'need 2 profiles to prove same-night isolation').toBe(2);
      const [a, b] = people.map((r) => r.id as string);

      await asRole('authenticated', a);
      const { rows: ra } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['plan A']);
      const planA = ra[0].id as string;

      await db.query('RESET ROLE');
      await asRole('authenticated', b);
      const { rows: rb } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['plan B']);
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
