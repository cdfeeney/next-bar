import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * MIGRATION 0077 — the orphan sweep must make forward progress.
 *
 * This is the runnable form of the rehearsal that justified 0077, kept so the
 * claim survives the session that made it. Everything runs inside a
 * transaction that is ROLLED BACK, and 0077 itself is applied inside that same
 * transaction, so the migration is proven WITHOUT being applied and the suite
 * leaves no fixtures behind.
 *
 * THE DEFECT. `claim_orphan_paths` takes the 25 OLDEST candidates and only then,
 * in the loop body, skips two populations it can never claim: a prefix that is
 * not a uuid, and a prefix whose account no longer exists. Both skips are AFTER
 * the LIMIT, so those objects are re-selected every tick, occupy the whole
 * batch, and no later eligible orphan is ever reached.
 *
 * AND THE TWO HALVES ARE ONE BUG. `media_objects.owner_id` was
 * `not null references profiles(id) ON DELETE CASCADE`, so deleting an account
 * DESTROYED its registry rows — turning that account's photos into exactly the
 * unregistered orphans this function collects, which it then skipped for having
 * no profile. They are also the oldest, so they sort to the front.
 *
 * WHAT THIS CANNOT PROVE, stated rather than left for a reader to discover: it
 * seeds `storage.objects` directly and injects `auth.uid()` through
 * `SET LOCAL ROLE` + `request.jwt.claims`, which is what PostgREST does to
 * evaluate a policy but is NOT a real Supabase session. It also proves the
 * migration against the staging schema only — production is a separate,
 * attended apply.
 */

const SUITE = 'orphanSweepForwardProgress.live.test.ts';

/**
 * OPT-IN, AND THE REASON IS MEASURED RATHER THAN CAUTIOUS.
 *
 * Vitest runs test FILES in parallel, and this suite WRITES: it inserts storage
 * objects, adopts media rows and removes a profile, all inside long
 * transactions. Run alongside the two existing live suites — which seed their
 * own profiles in their own transactions against the same staging database — it
 * produced `deadlock detected` and took the full gate from its known 2 failures
 * to 5. It passes 6/6 on its own.
 *
 * Serialising it from this side alone is not possible: a deadlock needs both
 * parties, and the other suites would have to cooperate. Making the whole gate
 * single-file would slow every run for one file's benefit, and changing shared
 * vitest config is not this batch's to do.
 *
 * So it is explicit rather than automatic, which is the honest trade: a test
 * that deadlocks the gate is worse than one you run deliberately.
 *
 *   RUN_MIGRATION_LIVE=1 npx vitest run src/lib/orphanSweepForwardProgress.live.test.ts
 *
 * Run it before applying 0077 to any database.
 */
const OPTED_IN = process.env.RUN_MIGRATION_LIVE === '1';
const TARGET = OPTED_IN ? stagingDatabaseTarget(SUITE) : null;
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

/** 0077, with nothing stripped: it owns no transaction, the runner does. */
const MIGRATION = readFileSync(
  'supabase/migrations/0077_orphan_sweep_forward_progress.sql',
  'utf8',
);

const OWNERLESS = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

describeLive('0077 — orphan sweep forward progress (staging, rolled back)', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 60000,
      application_name: 'v8-0077-orphan-sweep',
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  /** Everything inside a rolled-back transaction, so nothing persists. */
  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    // READ WRITE explicitly: this suite INSERTs fixtures and the pooler-pinned
    // backend defaults to read-only.
    await db.query('BEGIN READ WRITE');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  const asOwner = async (): Promise<void> => {
    await db.query('SET LOCAL ROLE postgres');
    await db.query("SELECT set_config('request.jwt.claims', '', true)");
  };

  const asUser = async (uid: string): Promise<void> => {
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
  };

  const applyMigration = async (): Promise<void> => {
    await db.query(MIGRATION);
  };

  /** An account this suite created, so deleting it is safe. */
  async function makeAccount(): Promise<string> {
    const { rows } = await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', gen_random_uuid()::text || '@0077.test')
       returning id`,
    );
    const id = rows[0].id as string;
    await db.query(
      `insert into public.profiles (id) values ($1)
       on conflict (id) do nothing`,
      [id],
    );
    return id;
  }

  const object = async (name: string, age: string): Promise<void> => {
    await db.query(
      `insert into storage.objects (bucket_id, name, created_at)
       values ('story-media', $1, now() - $2::interval)`,
      [name, age],
    );
  };

  const sweep = async (limit = 25): Promise<string[]> => {
    const { rows } = await db.query('select storage_path from public.claim_orphan_paths($1)', [limit]);
    return rows.map((r) => r.storage_path as string);
  };

  it('25 ownerless objects cannot starve a later eligible orphan', async () => {
    await inRollback(async () => {
      await asOwner();
      const owner = await makeAccount();
      for (let i = 0; i < 25; i++) await object(`${OWNERLESS(i)}/p${i}.jpg`, '40 days');
      await object(`${owner}/eligible.jpg`, '10 days');

      // BEFORE the migration: the batch is filled by objects it will skip, so
      // the later eligible orphan is never reached — on this tick or any other.
      expect(await sweep()).toHaveLength(0);
      expect(await sweep()).toHaveLength(0);

      await applyMigration();

      const first = await sweep();
      const second = await sweep();
      expect(first).toHaveLength(25);
      expect(second).toEqual([`${owner}/eligible.jpg`]);
    });
  });

  it('an invalid prefix cannot consume a slot in the candidate batch', async () => {
    await inRollback(async () => {
      await asOwner();
      const owner = await makeAccount();
      for (let i = 0; i < 25; i++) await object(`not-a-uuid-${i}/junk.jpg`, '40 days');
      await object(`${owner}/eligible.jpg`, '10 days');

      await applyMigration();

      // The unusable prefixes are filtered before the LIMIT, so a single tick
      // reaches the eligible orphan rather than spending all 25 slots on rows
      // it can only skip.
      expect(await sweep()).toEqual([`${owner}/eligible.jpg`]);
    });
  });

  it('deleting an account KEEPS its media rows, with a null owner', async () => {
    await inRollback(async () => {
      await asOwner();
      await applyMigration();
      const owner = await makeAccount();
      await db.query(
        `insert into public.media_objects (owner_id, bucket_id, storage_path)
         values ($1, 'story-media', $2)`,
        [owner, `${owner}/kept.jpg`],
      );

      // A REAL deletion of the row the FK under test actually references.
      // media_objects.owner_id references public.profiles(id), so removing the
      // profile IS the event 0077 changes the behaviour of. It also keeps this
      // suite out of the auth schema, which carries its own consent guard after
      // the 2026-08-28 staging incident — and nothing here needs to reach it.
      await db.query('delete from public.profiles where id = $1', [owner]);

      const { rows } = await db.query(
        `select owner_id from public.media_objects where storage_path = $1`,
        [`${owner}/kept.jpg`],
      );
      // Under the old CASCADE this row was destroyed with the account, which is
      // how the bytes outlived every sweep that could have collected them.
      expect(rows).toHaveLength(1);
      expect(rows[0].owner_id).toBeNull();
    });
  });

  it('media a LIVE story references is never claimed', async () => {
    await inRollback(async () => {
      await asOwner();
      await applyMigration();
      const owner = await makeAccount();
      await object(`${owner}/referenced.jpg`, '30 days');
      await db.query(
        `insert into public.stories (author_id, media_path, media_kind, audience, expires_at)
         values ($1, $2, 'single', 'friends', now() + interval '12 hours')`,
        [owner, `${owner}/referenced.jpg`],
      );

      expect(await sweep()).not.toContain(`${owner}/referenced.jpg`);
    });
  });

  it('an unrelated signed-in user can neither read nor reclaim ownerless media', async () => {
    await inRollback(async () => {
      await asOwner();
      await applyMigration();
      const stranger = await makeAccount();
      await object(`${OWNERLESS(1)}/secret.jpg`, '40 days');
      await db.query(
        `insert into public.media_objects (owner_id, bucket_id, storage_path)
         values (null, 'story-media', $1)`,
        [`${OWNERLESS(1)}/secret.jpg`],
      );

      await asUser(stranger);
      // RLS compares owner_id = auth.uid(); NULL is not equal to anything, so an
      // ownerless row matches no policy for any user.
      const read = await db.query(
        `select 1 from public.media_objects where storage_path = $1`,
        [`${OWNERLESS(1)}/secret.jpg`],
      );
      expect(read.rowCount).toBe(0);

      // And the sweep, run AS THAT USER, narrows to their own prefix — so a
      // signed-in caller cannot use it to reach someone else's ownerless bytes.
      const claimed = await sweep();
      expect(claimed).not.toContain(`${OWNERLESS(1)}/secret.jpg`);
    });
  });

  it('one transaction owns both the schema change and the ledger row', async () => {
    // The reason 0077 carries no `begin;`/`commit;` of its own: the runner
    // wraps migration + ledger insert in ONE transaction, and a `commit;` inside
    // the file would end it early, landing the schema before the ledger entry
    // and leaving a failure unable to roll the schema back.
    expect(/^\s*begin;\s*$/mi.test(MIGRATION)).toBe(false);
    expect(/^\s*commit;\s*$/mi.test(MIGRATION)).toBe(false);

    // An injected failure after the ledger insert must roll BOTH back.
    await db.query('BEGIN READ WRITE');
    try {
      await db.query(MIGRATION);
      await db.query(
        `insert into public.schema_migrations (name, checksum)
         values ('0077_orphan_sweep_forward_progress.sql', 'rehearsal')`,
      );
      throw new Error('injected failure after the ledger insert');
    } catch {
      await db.query('ROLLBACK');
    }

    const ledger = await db.query(
      `select 1 from public.schema_migrations where name like '0077%'`,
    );
    const column = await db.query(
      `select is_nullable from information_schema.columns
        where table_schema='public' and table_name='media_objects' and column_name='owner_id'`,
    );
    // Neither half survived: no ledger row, and owner_id is still NOT NULL.
    expect(ledger.rowCount).toBe(0);
    expect(column.rows[0].is_nullable).toBe('NO');
  });
});
