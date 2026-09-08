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
 * WHERE THE BYTE GATE LIVES NOW, AND WHY THIS SECTION WAS REWRITTEN (0077).
 *
 * This suite used to assert the BYTES through four `storage.objects` policies,
 * because in 0065 a client reached the bucket directly and those policies were
 * the whole gate. `0071_story_media_legacy_policy_removal.sql` DROPPED three of
 * them on purpose — the INSERT policy was the re-encode bypass (V8-R-STO-014)
 * and the two SELECT policies were the signed-URL-lifetime bypass
 * (V8-R-STO-015), since Storage checks the SELECT policy at mint time and
 * accepts whatever `expiresIn` the caller asked for. Measured against staging
 * at ledger head 0076: `storage.objects` carries exactly ONE policy, the
 * retained DELETE ("story-media: owner deletes own prefix").
 *
 * So a direct object read now returns nothing FOR EVERYONE, its owner included,
 * and that is the intended contract rather than a defect. The read decision
 * moved into `public.media_read_window(name)` — a definer function that still
 * evaluates as the caller and carries the same audience, expiry, block and
 * report rules the dropped policies did — which `/api/media/:id/url` asks
 * before it signs with the service role.
 *
 * The assertions below therefore ask `media_read_window`, which is what decides
 * today, AND assert that the direct path stays shut. Asserting the old policies
 * would have been asking the database to reopen two bypasses the product
 * deliberately closed.
 *
 * DEFERRED, NOT FIXED, AND NOT THIS SUITE'S TO FIX — reported by the 0077 lane:
 * `src/lib/stories.server.ts` on this branch and on `release/v8` is still the
 * 0065-era module and uploads, signs and removes through the CALLER's
 * `client.storage`. Against a database at 0071+ every one of those calls is
 * refused. 0071's own header says the transition of those four call sites ships
 * "in the SAME CANDIDATE as this file"; it does not exist on any reachable
 * branch. That is a live integration defect in the media-boundary work package,
 * not a reason to restore the policies.
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

  /**
   * The read decision `/api/media/:id/url` asks before it signs — the gate on
   * the BYTES since 0071 withdrew the direct-client Storage policies.
   */
  async function readWindow(
    viewer: string, key: string,
  ): Promise<{ readable: boolean; expiresAt: Date | null }> {
    await asRole('authenticated', viewer);
    const { rows } = await db.query(
      'select readable, expires_at from public.media_read_window($1)', [key],
    );
    return { readable: rows[0].readable as boolean, expiresAt: rows[0].expires_at as Date | null };
  }

  /**
   * Run a statement that is EXPECTED TO FAIL, and return its error.
   *
   * A raised exception aborts the whole transaction, so every later statement
   * dies with `25P02 current transaction is aborted` — which is how two
   * assertions here failed for a reason that had nothing to do with the rule
   * they name. Any test that keeps going after a deliberate failure must issue
   * it through this, so the savepoint absorbs the abort.
   */
  async function refusal(text: string, values: unknown[] = []): Promise<Error | null> {
    await db.query('SAVEPOINT probe');
    try {
      await db.query(text, values);
      await db.query('RELEASE SAVEPOINT probe');
      return null;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT probe');
      return error as Error;
    }
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

  it('anon is denied SELECT on stories before RLS is reached', async () => {
    await inRollback(async () => {
      const { alice } = await seed({ mutual: true });
      const { id: story } = await publishAs(alice);
      await asRole('anon');
      // No anon table grant is intentional. Accepting an empty result would
      // miss an accidental GRANT that lets anon reach this private table.
      await expect(
        db.query('select 1 from public.stories where id = $1', [story]),
      ).rejects.toMatchObject({ code: '42501', message: 'permission denied for table stories' });
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
      // The object must EXIST for this assertion to mean anything. publish_story
      // checks "media_path names no uploaded object" BEFORE it checks the
      // audience, so passing an un-uploaded key made this test pass on the wrong
      // error entirely — it proved the object guard, never the mutuality rule it
      // is named for.
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'custom', $2::uuid[], '{}'::uuid[])`,
          [key, [carol]],
        ),
      ).rejects.toThrow(/mutual friend/i);
    });
  });

  // The rule this candidate added: a tagged person who cannot READ the story
  // could never reach "Remove me", which is their only consent withdrawal.
  // Both reviewers noted it shipped with no test anywhere.
  it('a CUSTOM story may not tag someone its audience excludes', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      await asOwner();
      // Carol is mutual with Alice too, so the tag passes the mutuality rule and
      // can only be refused by the audience-consistency rule.
      await db.query(
        'insert into public.follows (follower_id, followee_id) values ($1, $2), ($2, $1) on conflict do nothing',
        [alice, carol],
      );
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      await asRole('authenticated', alice);
      await expect(
        db.query(
          `select public.publish_story($1, 'single', null, null, null, 'custom', $2::uuid[], $3::uuid[])`,
          [key, [bob], [carol]],
        ),
      ).rejects.toThrow(/must be in a custom story/i);
    });
  });

  it('a CUSTOM story may still tag YOURSELF without naming yourself in the audience', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      await asRole('authenticated', alice);
      // The author always reads their own story, so the self-tag exception is
      // not a hole — and refusing it would make tagging yourself impossible on
      // exactly the audience where you are most likely to do it.
      const { rows } = await db.query(
        `select public.publish_story($1, 'single', null, null, null, 'custom', $2::uuid[], $3::uuid[]) as story`,
        [key, [bob], [alice]],
      );
      expect(rows).toHaveLength(1);
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
        // created_at moves too: 0065 carries
        // `check (expires_at > created_at)`, and a row inserted a moment ago has
        // created_at = now(), so pushing ONLY expires_at into the past violates
        // the constraint and the fixture dies before the assertion runs.
        `update public.stories
            set created_at = now() - interval '2 days',
                expires_at = now() - interval '1 second'
          where id = $1`,
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

  it('NO role reaches a story object directly — not the audience, not the owner', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      // The metadata row is readable by the audience, and that has not changed.
      expect(await visibleTo(bob, story)).toBe(true);
      // The BYTES are not reachable by table access at all any more: 0071 left
      // `storage.objects` with a DELETE policy and nothing else, so a SELECT
      // matches no row for anybody. This is what closes the mint-time
      // signed-URL bypass (V8-R-STO-015) — a viewer who could still SELECT the
      // object could call createSignedUrl with any expiresIn it liked.
      expect(await objectVisibleTo(bob, mediaPath)).toBe(false);
      expect(await objectVisibleTo(carol, mediaPath)).toBe(false);
      expect(await objectVisibleTo(alice, mediaPath)).toBe(false);
    });
  });

  it('an audience member reaches the bytes through the media window; a stranger does not', async () => {
    await inRollback(async () => {
      const { alice, bob, carol } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      // The window follows the row: same audience, same answer.
      const seen = await readWindow(bob, mediaPath);
      expect(seen.readable).toBe(true);
      // AND THE WINDOW IS BOUNDED BY THE STORY. `readable` alone is not the
      // whole answer: `/api/media/[mediaId]/url` hands this expiry to
      // `serverTtlSeconds`, which reads null as "no expiry of its own" and
      // grants the full SIGNED_URL_MAX_SECONDS ceiling. A window that answered
      // `(true, null)` for a LIVE referenced story would therefore mint a URL
      // that outlives the story it came from — V8-R-STO-015 through the front
      // door — while every assertion here that reads only `readable` stayed
      // green. The expiry is the second half of the answer, so assert it.
      await asOwner();
      const { rows } = await db.query(
        'select expires_at from public.stories where id = $1', [story],
      );
      expect(seen.expiresAt).not.toBeNull();
      expect(seen.expiresAt?.getTime()).toBe((rows[0].expires_at as Date).getTime());
      expect((await readWindow(carol, mediaPath)).readable).toBe(false);
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
      expect((await readWindow(bob, mediaPath)).readable).toBe(true);
      // Carol is a mutual friend and still cannot reach the bytes: the audience
      // predicate lives in media_read_window now rather than being duplicated
      // into a storage policy, and this is the assertion that catches it
      // drifting from the table's copy.
      expect((await readWindow(carol, mediaPath)).readable).toBe(false);
    });
  });

  it('expiry closes the BYTES too — for the audience AND for the owner', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      const { id: story, mediaPath } = await publishAs(alice);
      expect((await readWindow(alice, mediaPath)).readable).toBe(true);
      expect((await readWindow(bob, mediaPath)).readable).toBe(true);

      await asOwner();
      await db.query(
        // created_at moves too: 0065 carries
        // `check (expires_at > created_at)`, and a row inserted a moment ago has
        // created_at = now(), so pushing ONLY expires_at into the past violates
        // the constraint and the fixture dies before the assertion runs.
        `update public.stories
            set created_at = now() - interval '2 days',
                expires_at = now() - interval '1 second'
          where id = $1`,
        [story],
      );

      expect((await readWindow(bob, mediaPath)).readable).toBe(false);
      // The owner branch used to be prefix-only, so an author could mint a
      // signed URL for its own expired media forever. Ownership is not a bypass
      // of the lifetime: `story_media_is_dead` closes it for the author too.
      expect((await readWindow(alice, mediaPath)).readable).toBe(false);
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
      // Asked through the window: the direct object read is closed for
      // everybody at all times now, so asserting THAT here would have proved
      // nothing about deletion.
      expect((await readWindow(bob, mediaPath)).readable).toBe(false);
      expect((await readWindow(alice, mediaPath)).readable).toBe(false);
    });
  });

  it('no client may write to the bucket at all — its own prefix included', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      await asRole('authenticated', bob);
      // Somebody else's prefix: refused, as it always was.
      expect(
        (await refusal(
          `insert into storage.objects (bucket_id, name) values ('story-media', $1)`,
          [`${alice}/${randomUUID()}/main`],
        ))?.message,
      ).toMatch(/violates row-level security|permission denied/i);
      // AND his own, which 0065 allowed and 0071 withdrew. That INSERT policy
      // was the re-encode bypass (V8-R-STO-014): a modified client could put
      // its original GPS-bearing bytes under its own prefix and publish_story
      // only ever checked that the object EXISTS. Uploads go through
      // /api/media/upload, which re-encodes and writes with the service role.
      expect(
        (await refusal(
          `insert into storage.objects (bucket_id, name) values ('story-media', $1)`,
          [`${bob}/${randomUUID()}/main`],
        ))?.message,
      ).toMatch(/violates row-level security|permission denied/i);
    });
  });

  it('an unreferenced object keeps an UNBOUNDED window for its owner — the upload window', async () => {
    await inRollback(async () => {
      const { alice, bob } = await seed({ mutual: true });
      // Upload-then-publish: between the two there is no story row at all, and
      // the owner still has to be able to reach (and clean up) its own bytes.
      const key = await putObject(alice, `${alice}/${randomUUID()}/main`);
      const own = await readWindow(alice, key);
      expect(own.readable).toBe(true);
      // Null expiry here means "no story bounds these bytes", so only the
      // signed-URL ceiling applies. It is NOT the same null the viewer branch
      // returns, which means "nothing authorises you".
      expect(own.expiresAt).toBeNull();
      // Nobody else gets the upload window, and the object is still unreachable
      // by direct table access even for its owner.
      expect((await readWindow(bob, key)).readable).toBe(false);
      expect(await objectVisibleTo(alice, key)).toBe(false);
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
      //
      // Through `refusal`: the raise aborts the transaction, so the self-query
      // below used to die with 25P02 and this test failed while the guard it
      // names was working perfectly.
      expect(
        (await refusal('select public.is_mutual_friend($1, $2) as ok', [alice, bob]))?.message,
      ).toMatch(/may only ask about itself/i);
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
