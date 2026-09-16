import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * S-08a — saved_night_bars + get_saved_night_bars against STAGING (0083). Skips,
 * with the reason in the title, until the owner applies 0083. Every case runs
 * inside a transaction that is rolled back.
 *
 * archive_night_out's fill of this table is pinned by the static shape test
 * (savedNightBarsMigration.test.ts): its media/window preconditions make a full
 * live archive expensive to stage, and the insert is byte-identical to the
 * reviewed SQL. Here we prove the READ, its ordering, and the own-row RLS.
 */
const SUITE = 'savedNightBars.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

describeLive('0083 saved_night_bars — the owner reads their ordered, rated stops; nobody else can', () => {
  let db: Client;
  let applied = false;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 's08a-saved-night-bars',
    });
    await db.connect();
    const { rows } = await db.query(
      "select count(*)::int as n from pg_proc where proname = 'get_saved_night_bars'",
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

  const asRole = async (role: string, uid?: string) => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };
  const asPostgres = async () => {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims', '', true)");
  };

  async function account(): Promise<string> {
    const id = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [id]);
    return id;
  }

  it('applied-or-skipped is stated, never silent', () => {
    expect(typeof applied).toBe('boolean');
  });

  it('returns the caller\'s own stops in sort order with their ratings; a stranger gets none and cannot select the table', async ({ skip }) => {
    if (!applied) skip('0083 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const owner = await account();
      const stranger = await account();
      await asPostgres();
      const { rows } = await db.query(
        `insert into public.saved_nights (owner_id, title, night, bar_count)
         values ($1, 'S-08a', current_date, 2) returning id`,
        [owner],
      );
      const savedId = rows[0].id as string;
      // Inserted out of order to prove the read orders by sort_order.
      await db.query(
        `insert into public.saved_night_bars (saved_night_id, bar_id, sort_order, rating) values
         ($1, 'please-dont-tell', 2, 'pass'), ($1, 'attaboy', 1, 'loved')`,
        [savedId],
      );

      await asRole('authenticated', owner);
      const mine = await db.query('select * from public.get_saved_night_bars($1)', [savedId]);
      expect(mine.rows).toEqual([
        { bar_id: 'attaboy', sort_order: 1, rating: 'loved' },
        { bar_id: 'please-dont-tell', sort_order: 2, rating: 'pass' },
      ]);

      // A stranger's owner-scoped read returns nothing...
      await asRole('authenticated', stranger);
      const theirs = await db.query('select * from public.get_saved_night_bars($1)', [savedId]);
      expect(theirs.rows, 'a non-owner reads none of another account\'s stops').toEqual([]);
      // ...and RLS refuses a direct table select of a row they do not own.
      const direct = await db.query(
        'select count(*)::int as n from public.saved_night_bars where saved_night_id = $1',
        [savedId],
      );
      expect(direct.rows[0].n, 'own-row RLS hides the rows from a direct select').toBe(0);
    });
  });

  it('a NULL rating (unrated at save time) round-trips as null', async ({ skip }) => {
    if (!applied) skip('0083 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const owner = await account();
      await asPostgres();
      const { rows } = await db.query(
        `insert into public.saved_nights (owner_id, title, night, bar_count)
         values ($1, 'S-08a', current_date, 1) returning id`,
        [owner],
      );
      const savedId = rows[0].id as string;
      await db.query(
        `insert into public.saved_night_bars (saved_night_id, bar_id, sort_order, rating)
         values ($1, 'attaboy', 1, null)`,
        [savedId],
      );
      await asRole('authenticated', owner);
      const { rows: got } = await db.query('select rating from public.get_saved_night_bars($1)', [savedId]);
      expect(got).toEqual([{ rating: null }]);
    });
  });
});
