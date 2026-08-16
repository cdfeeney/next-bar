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

function databaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    return env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const URL = databaseUrl();
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
    const writes: Array<[string, string]> = [
      ['create_night_out', "select public.create_night_out(current_date, 'x')"],
      ['cancel_night_out', `select public.cancel_night_out('${randomUUID()}'::uuid)`],
      ['join_night_out_by_token', `select public.join_night_out_by_token('${randomUUID()}'::uuid)`],
      ['decline_night_out_by_token', `select public.decline_night_out_by_token('${randomUUID()}'::uuid)`],
      ['revoke_night_out_link', `select public.revoke_night_out_link('${randomUUID()}'::uuid)`],
      ['suggest_night_out_bar', `select public.suggest_night_out_bar('${randomUUID()}'::uuid, 'attaboy')`],
      ['vote_night_out_bar', `select public.vote_night_out_bar('${randomUUID()}'::uuid, 'attaboy')`],
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
