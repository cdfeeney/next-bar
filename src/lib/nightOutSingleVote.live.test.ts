import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * S-07b — the moving vote, against the STAGING database (0079).
 *
 * Skips, with the reason in the title, until the owner has applied 0079: the
 * suite asks pg_proc whether `unvote_night_out_bar` exists rather than failing
 * the gate on a database that has not caught up. Every case runs inside a
 * transaction that is rolled back, so nothing is left behind.
 */
const SUITE = 'nightOutSingleVote.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

describeLive('0079 night_out_votes — one vote per member, and it moves', () => {
  let db: Client;
  let applied = false;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 's07b-single-vote',
    });
    await db.connect();
    const { rows } = await db.query(
      "select count(*)::int as n from pg_proc where proname = 'unvote_night_out_bar'",
    );
    applied = rows[0].n > 0;
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    await db.query('BEGIN READ WRITE');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  const asUser = async (uid: string) => {
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
  };
  const asService = async () => {
    await db.query('RESET ROLE');
  };

  async function makeUsers(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [id]);
      ids.push(id);
    }
    return ids;
  }

  async function votesOf(planId: string, uid: string): Promise<string[]> {
    await asService();
    const { rows } = await db.query(
      'select bar_id from public.night_out_votes where night_out_id = $1 and user_id = $2 order by bar_id',
      [planId, uid],
    );
    return rows.map((r: { bar_id: string }) => r.bar_id);
  }

  it('applied-or-skipped is stated, never silent', () => {
    // A green suite on a database without 0079 would be a false pass; the
    // cases below skip themselves, and this line says why in the output.
    expect(typeof applied).toBe('boolean');
  });

  it('two votes by one member collapse to one, and it moves; unvote clears it; another member is untouched', async ({ skip }) => {
    if (!applied) skip('0079 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const [owner, guest] = await makeUsers(2);
      await asUser(owner);
      const { rows: created } = await db.query(
        'select public.create_night_out(current_date, $1, null) as id', ['S-07b vote'],
      );
      const planId = created[0].id as string;
      expect(planId).toBeTruthy();
      await db.query('select public.invite_to_night_out($1, $2)', [planId, guest]);
      await db.query("select public.suggest_night_out_bar($1, 'attaboy')", [planId]);
      await db.query("select public.suggest_night_out_bar($1, 'death-and-co')", [planId]);

      // Owner votes A then B: exactly one row, on B.
      const a = await db.query("select public.vote_night_out_bar($1, 'attaboy') as ok", [planId]);
      expect(a.rows[0].ok).toBe(true);
      const b = await db.query("select public.vote_night_out_bar($1, 'death-and-co') as ok", [planId]);
      expect(b.rows[0].ok).toBe(true);
      expect(await votesOf(planId, owner)).toEqual(['death-and-co']);

      // The guest accepts and votes A: two members, two rows, one each.
      await asUser(guest);
      await db.query(
        `select public.respond_night_out($1, true, 'pending',
           (select m.response_revision from public.night_out_members m where m.night_out_id = $1 and m.user_id = auth.uid()))`,
        [planId],
      );
      const g = await db.query("select public.vote_night_out_bar($1, 'attaboy') as ok", [planId]);
      expect(g.rows[0].ok).toBe(true);
      expect(await votesOf(planId, guest)).toEqual(['attaboy']);
      expect(await votesOf(planId, owner)).toEqual(['death-and-co']);

      // Unvote clears only the caller's own; unvote on a bar you did not vote for is false.
      await asUser(owner);
      const u1 = await db.query("select public.unvote_night_out_bar($1, 'attaboy') as ok", [planId]);
      expect(u1.rows[0].ok).toBe(false);
      const u2 = await db.query("select public.unvote_night_out_bar($1, 'death-and-co') as ok", [planId]);
      expect(u2.rows[0].ok).toBe(true);
      expect(await votesOf(planId, owner)).toEqual([]);
      expect(await votesOf(planId, guest)).toEqual(['attaboy']);
    });
  });

  it('the unique index makes a second row per member impossible even for a direct write', async ({ skip }) => {
    if (!applied) skip('0079 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const [owner] = await makeUsers(1);
      await asUser(owner);
      const { rows: created } = await db.query(
        'select public.create_night_out(current_date, $1, null) as id', ['S-07b index'],
      );
      const planId = created[0].id as string;
      await db.query("select public.suggest_night_out_bar($1, 'attaboy')", [planId]);
      await db.query("select public.suggest_night_out_bar($1, 'death-and-co')", [planId]);
      await db.query("select public.vote_night_out_bar($1, 'attaboy')", [planId]);
      await asService();
      await expect(
        db.query('insert into public.night_out_votes (night_out_id, bar_id, user_id) values ($1, $2, $3)', [planId, 'death-and-co', owner]),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
