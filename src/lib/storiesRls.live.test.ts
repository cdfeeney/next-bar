import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * 0065 STORIES — live RLS/RPC behaviour with TWO REAL IDENTITIES.
 *
 * This is the half of the Stories acceptance that a unit test cannot reach.
 * `stories.server.test.ts` covers signed-URL lifetime, the key convention and
 * the client's failure handling; those are decisions this codebase makes. WHO
 * MAY READ A STORY is decided by the database, and the only honest way to prove
 * it is to connect as the real `authenticated` role under two different
 * `auth.uid()` claims and assert the denials happen.
 *
 * Everything runs inside a transaction that ROLLS BACK, which is what makes it
 * safe to point at a live database: no story, profile, follow edge or tag
 * created here survives the test.
 *
 * `SET LOCAL ROLE` + `request.jwt.claims` is how Supabase RLS is exercised from
 * SQL — policies read `auth.uid()` out of those claims, so switching role and
 * claim inside a transaction reproduces exactly what PostgREST would do for
 * that user, with no running API and no real JWTs.
 *
 * Skips only where CI=1 acknowledges that DATABASE_URL is absent; anywhere else
 * a missing target is a loud failure, not a green run. The staging-only gate,
 * the TLS chain and the CI acknowledgement all live in ./liveDbTarget — one
 * copy, shared with the other live suites, because a second copy of a security
 * gate is how one of them ends up ungated.
 *
 * NOT RUN in the cycle-2 local gate: this worktree has no DATABASE_URL and no
 * DB-write authorization. It is recorded as SKIPPED, never as passing. Running
 * it against staging with two accounts is the attended step the goal reports as
 * required before V8 can launch.
 */

const SUITE = 'storiesRls.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

describeLive('0065 stories — live RLS/RPC with two identities', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      // Exactly the TLS the gate authorised; rebuilding it here would let the
      // suite connect with a config nobody verified.
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 'v8-1f-stories-rls',
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  /** Everything inside a rolled-back transaction, so nothing persists. */
  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    // READ WRITE explicitly: this suite INSERTs fixtures and the pooler-pinned
    // backend defaults to read-only. Transaction-scoped, so nothing leaks.
    await db.query('BEGIN READ WRITE');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  const asRole = async (role: string, uid?: string): Promise<void> => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid !== undefined) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };

  const asOwner = async (): Promise<void> => {
    await db.query('SET LOCAL ROLE postgres');
    await db.query("SELECT set_config('request.jwt.claims', '', true)");
  };

  /**
   * Two real identities plus a third bystander, with the follow edges each test
   * needs. Returns their ids. Created as the table owner so fixture creation is
   * not itself gated by the policies under test.
   */
  async function seed(opts: { mutual: boolean }): Promise<{
    alice: string; bob: string; carol: string;
  }> {
    const alice = randomUUID();
    const bob = randomUUID();
    const carol = randomUUID();
    await asOwner();
    for (const [id, handle] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol']] as const) {
      await db.query(
        `insert into public.profiles (id, handle, display_name, is_private)
         values ($1, $2, $2, false) on conflict (id) do nothing`,
        [id, `${handle}_${id.slice(0, 8)}`],
      );
    }
    // Alice -> Bob always. Bob -> Alice only when the test wants MUTUALITY.
    await db.query(
      'insert into public.follows (follower_id, followee_id) values ($1, $2) on conflict do nothing',
      [alice, bob],
    );
    if (opts.mutual) {
      await db.query(
        'insert into public.follows (follower_id, followee_id) values ($1, $2) on conflict do nothing',
        [bob, alice],
      );
    }
    return { alice, bob, carol };
  }

  /** Publish as `author`, through the RPC, exactly as the app does. */
  async function publishAs(
    author: string,
    args: { audience?: string; audienceIds?: string[]; tagIds?: string[] } = {},
  ): Promise<string> {
    await asRole('authenticated', author);
    const { rows } = await db.query(
      `select (public.publish_story(
         $1, 'single', null, null, null, $2, $3::uuid[], $4::uuid[]
       )).id as id`,
      [
        `${author}/${randomUUID()}/main`,
        args.audience ?? 'friends',
        args.audienceIds ?? [],
        args.tagIds ?? [],
      ],
    );
    return rows[0].id as string;
  }

  const visibleTo = async (viewer: string, storyId: string): Promise<boolean> => {
    await asRole('authenticated', viewer);
    const { rows } = await db.query('select 1 from public.stories where id = $1', [storyId]);
    return rows.length > 0;
  };

  it('an accepted mutual friend can read the story', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const story = await publishAs(alice);
      expect(await visibleTo(bob, story)).toBe(true);
    });
  });

  it('a ONE-WAY follower is not a friend and is denied', async () => {
    await inRollback(async () => {
      // Alice follows Bob but Bob does not follow Alice back.
      const { alice, bob } = await seed({ mutual: false });
      const story = await publishAs(bob);
      expect(await visibleTo(alice, story)).toBe(false);
    });
  });

  it('a stranger is denied', async () => {
    await inRollback(async () => {
      const { alice, carol } = await seed({ mutual: true });
      const story = await publishAs(alice);
      expect(await visibleTo(carol, story)).toBe(false);
    });
  });

  it('anon reads nothing at all', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const story = await publishAs(alice);
      await asRole('anon');
      const { rows } = await db.query('select 1 from public.stories where id = $1', [story]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a custom audience reaches only the profiles it names', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      // Make Carol mutual too, so the ONLY thing excluding her is the audience.
      await asOwner();
      await db.query(
        `insert into public.follows (follower_id, followee_id)
         values ($1, $2), ($2, $1) on conflict do nothing`,
        [alice, carol],
      );
      const story = await publishAs(alice, { audience: 'custom', audienceIds: [bob] });
      expect(await visibleTo(bob, story)).toBe(true);
      expect(await visibleTo(carol, story)).toBe(false);
    });
  });

  it('a custom audience naming a non-friend is REFUSED, not silently widened', async () => {
    await inRollback(async () => {
      const { alice, carol } = await seed({ mutual: true });
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'custom', $2::uuid[], '{}'::uuid[])`,
          [`${alice}/${randomUUID()}/main`, [carol]],
        ),
      ).rejects.toThrow(/mutual friend/i);
    });
  });

  it('publishing a media path owned by someone else is refused', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'friends', '{}'::uuid[], '{}'::uuid[])`,
          [`${bob}/${randomUUID()}/main`],
        ),
      ).rejects.toThrow(/not owned by the caller/i);
    });
  });

  it('expiry is a QUERY gate: the row stops being readable at expires_at', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const story = await publishAs(alice);
      expect(await visibleTo(bob, story)).toBe(true);
      // Age the row past its own expiry. Physical cleanup has NOT run.
      await asOwner();
      await db.query(
        "update public.stories set expires_at = now() - interval '1 second' where id = $1",
        [story],
      );
      expect(await visibleTo(bob, story)).toBe(false);
      // And the author cannot read it back into visibility for anyone else.
      expect(await visibleTo(alice, story)).toBe(true);
    });
  });

  it('server time sets created_at and expires_at 24 hours apart', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const story = await publishAs(alice);
      await asOwner();
      const { rows } = await db.query(
        `select extract(epoch from (expires_at - created_at)) as span,
                abs(extract(epoch from (created_at - now()))) as drift
           from public.stories where id = $1`,
        [story],
      );
      expect(Number(rows[0].span)).toBe(24 * 60 * 60);
      // Stamped by the server during this transaction, not by any client.
      expect(Number(rows[0].drift)).toBeLessThan(60);
    });
  });

  it('only the author can delete, and deletion closes the read immediately', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const story = await publishAs(alice);

      // Bob cannot delete Alice's story: the RPC matches no row for him.
      await asRole('authenticated', bob);
      const asBob = await db.query('select * from public.delete_story($1)', [story]);
      expect(asBob.rows).toHaveLength(0);
      expect(await visibleTo(bob, story)).toBe(true);

      // Alice can, and it returns the object keys for byte cleanup.
      await asRole('authenticated', alice);
      const asAlice = await db.query('select * from public.delete_story($1)', [story]);
      expect(asAlice.rows).toHaveLength(1);
      expect(asAlice.rows[0].media_path).toContain(alice);
      expect(await visibleTo(bob, story)).toBe(false);
    });
  });

  it('a tagged person removes their OWN tag and nobody else\'s', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      await asOwner();
      await db.query(
        `insert into public.follows (follower_id, followee_id)
         values ($1, $2), ($2, $1) on conflict do nothing`,
        [alice, carol],
      );
      const story = await publishAs(alice, { tagIds: [bob, carol] });

      // Bob withdraws his consent.
      await asRole('authenticated', bob);
      const removed = await db.query('select public.remove_my_story_tag($1) as ok', [story]);
      expect(removed.rows[0].ok).toBe(true);

      await asOwner();
      const { rows } = await db.query(
        'select profile_id, removed_at from public.story_tags where story_id = $1 order by profile_id',
        [story],
      );
      const bobRow = rows.find((r) => r.profile_id === bob);
      const carolRow = rows.find((r) => r.profile_id === carol);
      expect(bobRow?.removed_at).not.toBeNull();
      // Carol's consent is untouched — one person's withdrawal is not another's.
      expect(carolRow?.removed_at).toBeNull();
    });
  });

  it('the author cannot withdraw a tag on someone else\'s behalf', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const story = await publishAs(alice, { tagIds: [bob] });
      await asRole('authenticated', alice);
      const result = await db.query('select public.remove_my_story_tag($1) as ok', [story]);
      // Alice is not tagged, so nothing of hers was withdrawn — and Bob's tag stands.
      expect(result.rows[0].ok).toBe(false);
      await asOwner();
      const { rows } = await db.query(
        'select removed_at from public.story_tags where story_id = $1 and profile_id = $2',
        [story, bob],
      );
      expect(rows[0].removed_at).toBeNull();
    });
  });

  it('no direct INSERT path exists — publish_story is the only way in', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `insert into public.stories (author_id, media_path) values ($1, $2)`,
          [alice, `${alice}/x/main`],
        ),
      ).rejects.toThrow(/permission denied|violates row-level security/i);
    });
  });

  it('a client cannot choose its own expiry through the RPC', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      await asRole('authenticated', alice);
      // The function takes no expiry parameter at all; naming one is an error
      // rather than a silently ignored argument.
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'friends', '{}'::uuid[], '{}'::uuid[],
             now() + interval '30 days')`,
          [`${alice}/${randomUUID()}/main`],
        ),
      ).rejects.toThrow();
    });
  });
});
