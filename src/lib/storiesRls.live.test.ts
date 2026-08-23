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
 *
 * WHAT THIS SUITE STILL DOES NOT PROVE, named rather than left for a reader to
 * discover. It seeds profile rows directly and injects `auth.uid()` through
 * `SET LOCAL ROLE` + `request.jwt.claims`, which is exactly what PostgREST does
 * to evaluate a policy — but it is NOT a real Supabase session. Signup, token
 * issuance, refresh, and the mapping from a JWT to `auth.uid()` in the running
 * API are all outside it, and could break with every assertion here still
 * green. Closing that needs two real accounts against a running project, which
 * is a separate attended step from running this file.
 *
 * WHAT IT DOES NOW COVER THAT IT DID NOT: `storage.objects`. The four bucket
 * policies are the gate on the BYTES — the highest-risk new authorization
 * surface in 0065, and the one place the audience predicate is written twice
 * rather than shared — and nothing anywhere exercised them, while the coverage
 * accounting in the spec headers read as complete. A missed `deleted_at` or
 * expiry clause in the duplicated predicate would have shipped undetected.
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
      // `public.profiles.id` REFERENCES `auth.users(id)` (0001, line 20), so a bare
      // profile insert with a random UUID violates the FK on the very first seed and
      // the whole suite dies before asserting anything. Create the identity first.
      //
      // Minimal shape on purpose: every other auth.users column is nullable or
      // defaulted, and inventing values for columns this suite never reads would be
      // asserting things about GoTrue's schema that nobody verified.
      await db.query(
        `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())
         on conflict (id) do nothing`,
        [id, `${handle}_${id.slice(0, 8)}@stories-rls.test`],
      );
      // 0001's `on_auth_user_created` trigger has ALREADY inserted this profile row
      // — id only, so `handle`/`display_name` are null and `is_private` took its
      // table default of TRUE. `do nothing` would therefore leave every fixture
      // private and handle-less, and the audience tests would fail for a reason that
      // has nothing to do with the policies under test. Upsert the fields we assert.
      await db.query(
        `insert into public.profiles (id, handle, display_name, is_private)
         values ($1, $2, $2, false)
         on conflict (id) do update
           set handle = excluded.handle,
               display_name = excluded.display_name,
               is_private = excluded.is_private`,
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

/**
   * Put a real `storage.objects` row under an author's prefix, as the owner.
   *
   * `publish_story` refuses a media_path that names no uploaded object — owning
   * the prefix is not the same as having uploaded anything — so the fixture has
   * to model the upload half of upload-then-publish. It is created as the table
   * owner because the WRITE policy is not what these tests are asserting; the
   * ones that DO assert it insert as `authenticated` on purpose.
   */
  async function putObject(author: string, key: string): Promise<string> {
    await asOwner();
    await db.query(
      `insert into storage.objects (bucket_id, name, owner)
       values ('story-media', $1, $2) on conflict do nothing`,
      [key, author],
    );
    return key;
  }

  /** Publish as `author`, through the RPC, exactly as the app does. */
  async function publishAs(
    author: string,
    args: { audience?: string; audienceIds?: string[]; tagIds?: string[] } = {},
  ): Promise<{ id: string; mediaPath: string }> {
    const mediaPath = await putObject(author, `${author}/${randomUUID()}/main`);
    await asRole('authenticated', author);
    const { rows } = await db.query(
      `select (public.publish_story(
         $1, 'single', null, null, null, $2, $3::uuid[], $4::uuid[]
       )).id as id`,
      [mediaPath, args.audience ?? 'friends', args.audienceIds ?? [], args.tagIds ?? []],
    );
    return { id: rows[0].id as string, mediaPath };
  }

  /** Can `viewer` read the OBJECT — the bytes, not the metadata row? */
  async function objectVisibleTo(viewer: string, key: string): Promise<boolean> {
    await asRole('authenticated', viewer);
    const { rows } = await db.query(
      "select 1 from storage.objects where bucket_id = 'story-media' and name = $1",
      [key],
    );
    return rows.length > 0;
  }

  const visibleTo = async (viewer: string, storyId: string): Promise<boolean> => {
    await asRole('authenticated', viewer);
    const { rows } = await db.query('select 1 from public.stories where id = $1', [storyId]);
    return rows.length > 0;
  };

  it('an accepted mutual friend can read the story', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const { id: story } = await publishAs(alice);
      expect(await visibleTo(bob, story)).toBe(true);
    });
  });

  it('a ONE-WAY follower is not a friend and is denied', async () => {
    await inRollback(async () => {
      // Alice follows Bob but Bob does not follow Alice back.
      const { alice, bob } = await seed({ mutual: false });
      const { id: story } = await publishAs(bob);
      expect(await visibleTo(alice, story)).toBe(false);
    });
  });

  it('a stranger is denied', async () => {
    await inRollback(async () => {
      const { alice, carol } = await seed({ mutual: true });
      const { id: story } = await publishAs(alice);
      expect(await visibleTo(carol, story)).toBe(false);
    });
  });

  it('anon reads nothing at all', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const { id: story } = await publishAs(alice);
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
      const { id: story } = await publishAs(alice, { audience: 'custom', audienceIds: [bob] });
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
      const { id: story } = await publishAs(alice);
      expect(await visibleTo(bob, story)).toBe(true);
      // Age the row past its own expiry. Physical cleanup has NOT run.
      await asOwner();
      await db.query(
        "update public.stories set expires_at = now() - interval '1 second' where id = $1",
        [story],
      );
      expect(await visibleTo(bob, story)).toBe(false);
      // AND SO IS THE AUTHOR'S OWN READ. This used to assert `true` — the
      // author was exempt from expiry, which contradicted 0065's own header
      // ("a story becomes unreadable exactly when expires_at <= now()") and
      // left an author able to read, and to sign media URLs for, content the
      // product told them was gone after 24 hours. The boundary is uniform now.
      expect(await visibleTo(alice, story)).toBe(false);
    });
  });

  it('server time sets created_at and expires_at 24 hours apart', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const { id: story } = await publishAs(alice);
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
      const { id: story } = await publishAs(alice);

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
      const { id: story } = await publishAs(alice, { tagIds: [bob, carol] });

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
      const { id: story } = await publishAs(alice, { tagIds: [bob] });
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

  /* ---------------------------------------------------------------------- */
  /* storage.objects — the gate on the BYTES                                 */
  /* ---------------------------------------------------------------------- */

  it('an audience member can read the OBJECT a readable story points at', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      expect(await visibleTo(bob, story)).toBe(true);
      // The bytes follow the row: same audience, same answer.
      expect(await objectVisibleTo(bob, mediaPath)).toBe(true);
      // And a stranger reaches neither.
      expect(await objectVisibleTo(carol, mediaPath)).toBe(false);
    });
  });

  it('a custom audience gates the BYTES as well as the row', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      await asOwner();
      await db.query(
        `insert into public.follows (follower_id, followee_id)
         values ($1, $2), ($2, $1) on conflict do nothing`,
        [alice, carol],
      );
      const { mediaPath } = await publishAs(alice, {
        audience: 'custom', audienceIds: [bob],
      });
      expect(await objectVisibleTo(bob, mediaPath)).toBe(true);
      // Carol is a mutual friend and still cannot reach the object: the
      // audience predicate is duplicated into the storage policy, and this is
      // the assertion that catches it drifting from the table's copy.
      expect(await objectVisibleTo(carol, mediaPath)).toBe(false);
    });
  });

  it('expiry closes the BYTES too — for the audience AND for the owner', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      expect(await objectVisibleTo(alice, mediaPath)).toBe(true);
      expect(await objectVisibleTo(bob, mediaPath)).toBe(true);

      await asOwner();
      await db.query(
        "update public.stories set expires_at = now() - interval '1 second' where id = $1",
        [story],
      );

      expect(await objectVisibleTo(bob, mediaPath)).toBe(false);
      // The owner-prefix policy used to be prefix-only, so an author could
      // mint a signed URL for its own expired media forever. Ownership is not
      // a bypass of the lifetime.
      expect(await objectVisibleTo(alice, mediaPath)).toBe(false);
    });
  });

  it('a soft-deleted story closes the BYTES immediately', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      await asRole('authenticated', alice);
      await db.query('select * from public.delete_story($1)', [story]);
      // The read gate closes whether or not the byte cleanup succeeded — that
      // is what makes a failed cleanup an orphan rather than readable content.
      expect(await objectVisibleTo(bob, mediaPath)).toBe(false);
      expect(await objectVisibleTo(alice, mediaPath)).toBe(false);
    });
  });

  it('nobody can write an object under somebody else\'s prefix', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      await asRole('authenticated', bob);
      await expect(
        db.query(
          `insert into storage.objects (bucket_id, name) values ('story-media', $1)`,
          [`${alice}/${randomUUID()}/main`],
        ),
      ).rejects.toThrow(/violates row-level security|permission denied/i);
      // Under his OWN prefix he may.
      await expect(
        db.query(
          `insert into storage.objects (bucket_id, name) values ('story-media', $1)`,
          [`${bob}/${randomUUID()}/main`],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('an unreferenced object stays readable by its owner — the upload window', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      // Upload-then-publish: between the two there is no story row at all, and
      // the owner still has to be able to reach (and clean up) its own bytes.
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      expect(await objectVisibleTo(alice, key)).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* the mutuality helper is not an oracle                                   */
  /* ---------------------------------------------------------------------- */

  it('is_mutual_friend refuses a caller asking about two other people', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      await asRole('authenticated', carol);
      // SECURITY DEFINER is exactly what lets this function see both follows
      // edges, so without a party check it is a pairwise oracle over the
      // private graph 0007 restricts to the parties themselves.
      await expect(
        db.query('select public.is_mutual_friend($1, $2) as ok', [alice, bob]),
      ).rejects.toThrow(/may only ask about itself/i);
      // Asking about ITSELF is fine, in either argument position.
      const own = await db.query('select public.is_mutual_friend($1, $2) as ok', [carol, alice]);
      expect(own.rows[0].ok).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* publish_story input rules                                               */
  /* ---------------------------------------------------------------------- */

  it('tagging a stranger is REFUSED, exactly like a custom audience naming one', async () => {
    await inRollback(async () => {
      const { alice, carol } = await seed({ mutual: true });
      // A tag is a write onto ANOTHER person's consent surface — the tagged
      // profile can read its own story_tags row — so an unchecked tag list let
      // any account attach a stranger to a story that stranger cannot see.
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'friends', '{}'::uuid[], $2::uuid[])`,
          [key, [carol]],
        ),
      ).rejects.toThrow(/only tag friends who follow you back/i);
    });
  });

  it('tagging YOURSELF is still allowed', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'friends', '{}'::uuid[], $2::uuid[])`,
          [key, [alice]],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('publishing a media_path that names no uploaded object is REFUSED', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      await asRole('authenticated', alice);
      // Owning the prefix is not the same as having uploaded anything. Without
      // this check any account could publish a live, photo-less story.
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'friends', '{}'::uuid[], '{}'::uuid[])`,
          [`${alice}/${randomUUID()}/main`],
        ),
      ).rejects.toThrow(/names no uploaded object/i);
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
