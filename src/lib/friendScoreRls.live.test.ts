import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * 0064 — the numeric score crossing the FRIEND boundary, proven behaviorally.
 *
 * The founder approved the raw score crossing to accounts the caller follows.
 * That approval is not an approval of a sloppy exposure, so this file is the
 * point of the migration rather than a footnote to it: every test here asserts
 * a DENIAL, and each one FAILS if the grant is later widened — by a policy
 * change, a new overload, a blanket GRANT, or someone "just" relaxing the
 * EXISTS gate to include pending follow requests.
 *
 * A text scan cannot do this. `friendRatingsScore.test.ts` reads the SQL and
 * proves the migration's SHAPE; only a connection can tell you whether the
 * database actually refuses anyone. Both are needed and neither substitutes.
 *
 * Everything runs inside a transaction that ROLLS BACK — no row created here
 * survives, which is what makes it safe to point at a live database. The
 * staging-only gate, the TLS chain and the CI acknowledgement come from
 * ./liveDbTarget, one shared copy with nightOutsRls.live.test.ts.
 */

const SUITE = 'friendScoreRls.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const describeLive = TARGET ? describe : describe.skip;

/** The score the fixture owner records. Distinctive so a leak is unmistakable. */
const OWNER_SCORE = '8.5';
const OWNER_BAR = 'attaboy';

describeLive('0064 get_friend_ratings — the score stops at the follow edge', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: (TARGET as { url: string }).url,
      // Exactly the TLS the gate authorised; see ./liveDbTarget.
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 'v8-0064-friend-score-negatives',
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  /** Run fn inside a rolled-back transaction, so nothing persists. */
  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    // READ WRITE explicitly: the fixtures INSERT, and Supabase's transaction
    // pooler hands out a pinned backend whose session carries
    // default_transaction_read_only=on. Transaction-scoped, so it cannot leak
    // back onto that shared backend. See scripts/apply-migration-set.ts for
    // the measurement.
    await db.query('BEGIN READ WRITE');
    try {
      return await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  }

  /**
   * `SET LOCAL ROLE` + `request.jwt.claims` is how Supabase RLS is exercised
   * from SQL: `auth.uid()` reads the claim, so switching both inside a
   * transaction reproduces exactly what PostgREST would do for that user.
   */
  const asRole = async (role: string, uid?: string) => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };

  /**
   * Fixture identities. `auth.users` requires exactly one NOT NULL column
   * without a default (id) and an AFTER INSERT trigger creates the profile
   * row, so inside a rolled-back transaction this is a factory.
   */
  async function makeIdentities(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [id]);
      ids.push(id);
    }
    const { rows } = await db.query(
      'select count(*)::int as n from public.profiles where id = any($1::uuid[])',
      [ids],
    );
    expect(rows[0].n, 'the auth.users trigger did not create profiles').toBe(count);
    return ids;
  }

  /** An owner with one scored rating, plus however many other identities. */
  async function scoredOwner(extra: number): Promise<[string, ...string[]]> {
    const ids = await makeIdentities(1 + extra);
    await db.query(
      'insert into public.ratings (user_id, bar_id, tier, score) values ($1, $2, $3, $4)',
      [ids[0], OWNER_BAR, 'loved', OWNER_SCORE],
    );
    return ids as [string, ...string[]];
  }

  /** get_friend_ratings as `uid`, narrowed to `owner`'s rows. */
  async function ratingsSeenBy(uid: string, owner: string): Promise<Array<Record<string, unknown>>> {
    await asRole('authenticated', uid);
    const { rows } = await db.query(
      'select * from public.get_friend_ratings() where user_id = $1',
      [owner],
    );
    await db.query('RESET ROLE');
    return rows as Array<Record<string, unknown>>;
  }

  it('returns the numeric score to an account that FOLLOWS the owner (criterion 2)', async () => {
    await inRollback(async () => {
      const [owner, friend] = await scoredOwner(1);
      await db.query('insert into public.follows (follower_id, followee_id) values ($1, $2)', [friend, owner]);

      const rows = await ratingsSeenBy(friend, owner);
      expect(rows, 'a follower saw none of the owner rows').toHaveLength(1);
      // The whole reason 0064 exists. Postgres numerics arrive as strings.
      expect(Number(rows[0].score), 'the score did not cross the friend boundary').toBe(8.5);
      expect(rows[0].tier, '0064 must not drop what 0007 already returned').toBe('loved');
      expect(rows[0].bar_id).toBe(OWNER_BAR);
    });
  });

  it('gives a NON-FRIEND no row and therefore no score (criterion 4a)', async () => {
    await inRollback(async () => {
      const [owner, stranger] = await scoredOwner(1);
      // No follows row in either direction: a stranger by construction.
      const rows = await ratingsSeenBy(stranger, owner);
      expect(rows, 'a stranger received the owner rows').toHaveLength(0);
    });
  });

  it('gives an account the owner follows — but who does not follow back — nothing (criterion 4a)', async () => {
    await inRollback(async () => {
      const [owner, other] = await scoredOwner(1);
      // The edge points the WRONG way: owner follows other, not other follows
      // owner. 0007's gate is `follows.follower_id = auth.uid()`, so this must
      // not grant `other` anything. A future "or is followed by" widening would
      // turn this test red, which is the point.
      await db.query('insert into public.follows (follower_id, followee_id) values ($1, $2)', [owner, other]);

      const rows = await ratingsSeenBy(other, owner);
      expect(rows, 'a followee read the follower\'s scores').toHaveLength(0);
    });
  });

  it('refuses an ANONYMOUS caller outright (criterion 4b)', async () => {
    await inRollback(async () => {
      await db.query('SAVEPOINT probe');
      await asRole('anon');
      let denied: string | null = null;
      try {
        await db.query('select * from public.get_friend_ratings()');
      } catch (error) {
        denied = (error as { message: string }).message;
      }
      // The failed statement aborted the transaction; the savepoint is what lets
      // the suite keep using this connection.
      await db.query('ROLLBACK TO SAVEPOINT probe');
      expect(denied, 'anon could execute get_friend_ratings').toMatch(/permission denied/i);
    });
  });

  it('does not let anon reach ratings.score off the table either (criterion 4b, 5)', async () => {
    await inRollback(async () => {
      await db.query('SAVEPOINT probe');
      await asRole('anon');
      let denied: string | null = null;
      try {
        await db.query('select score from public.ratings limit 1');
      } catch (error) {
        denied = (error as { message: string }).message;
      }
      // The failed statement aborted the transaction; the savepoint is what lets
      // the suite keep using this connection.
      await db.query('ROLLBACK TO SAVEPOINT probe');
      expect(denied, 'anon could read ratings.score directly').toMatch(/permission denied/i);
    });
  });

  it('does not let a signed-in STRANGER reach ratings.score off the table either (criterion 4a, 5)', async () => {
    await inRollback(async () => {
      const [owner, stranger] = await scoredOwner(1);
      // The anon direct-table negative above cannot cover this. `authenticated`
      // is a DIFFERENT role and already holds SELECT on public.ratings, so the
      // only thing standing between a signed-in stranger and every score in the
      // table is RLS - not a missing grant. A future permissive SELECT policy
      // would hand scores to PostgREST callers while every get_friend_ratings
      // test in this file stayed green, because none of them reads the table.
      await db.query('SAVEPOINT probe');
      await asRole('authenticated', stranger);
      let rows: Array<Record<string, unknown>> = [];
      let denied: string | null = null;
      try {
        const result = await db.query(
          'select score from public.ratings where user_id = $1',
          [owner],
        );
        rows = result.rows as Array<Record<string, unknown>>;
      } catch (error) {
        denied = (error as { message: string }).message;
      }
      await db.query('ROLLBACK TO SAVEPOINT probe');
      // Either outcome is acceptable - refused outright, or allowed through to
      // zero rows - because both mean the stranger learned nothing. What must
      // never happen is a row carrying the owner's score.
      if (denied === null) {
        expect(rows, 'a signed-in stranger read the owner score straight off public.ratings').toHaveLength(0);
      } else {
        expect(denied).toMatch(/permission denied|policy/i);
      }
    });
  });

  it('lets the OWNER read their own score off the table, so the test above is not vacuous', async () => {
    await inRollback(async () => {
      const [owner] = await scoredOwner(0);
      // Without this control, the stranger test above would pass just as well
      // against a table nobody can read at all, or a fixture that never
      // inserted the rating - proving nothing about the gate.
      await db.query('SAVEPOINT probe');
      await asRole('authenticated', owner);
      const { rows } = await db.query('select score from public.ratings where user_id = $1', [owner]);
      await db.query('ROLLBACK TO SAVEPOINT probe');
      expect(rows, 'the owner could not read their own rating, so the stranger test proves nothing').toHaveLength(1);
      expect(Number(rows[0].score)).toBe(8.5);
    });
  });

  it('does NOT grant a score on a PENDING follow request (criterion 4c)', async () => {
    await inRollback(async () => {
      const [owner, requester] = await scoredOwner(1);
      // A request is not a follow. 0008's own header says the fence gates on
      // follows, not requests — this asserts the database agrees.
      await db.query(
        'insert into public.follow_requests (requester_id, target_id) values ($1, $2)',
        [requester, owner],
      );

      const rows = await ratingsSeenBy(requester, owner);
      expect(rows, 'a pending follow request granted score access').toHaveLength(0);

      // ...and accepting it does grant access, so the negative above is a real
      // gate rather than a fixture that never could have seen anything.
      await db.query('insert into public.follows (follower_id, followee_id) values ($1, $2)', [requester, owner]);
      await db.query('delete from public.follow_requests where requester_id = $1 and target_id = $2', [requester, owner]);
      const after = await ratingsSeenBy(requester, owner);
      expect(after, 'accepting the request did not grant access').toHaveLength(1);
    });
  });

  it('stops granting the score the moment the follow is REVOKED (criterion 4d)', async () => {
    await inRollback(async () => {
      const [owner, friend] = await scoredOwner(1);
      await db.query('insert into public.follows (follower_id, followee_id) values ($1, $2)', [friend, owner]);
      expect(await ratingsSeenBy(friend, owner), 'the fixture never had access to revoke').toHaveLength(1);

      await db.query('delete from public.follows where follower_id = $1 and followee_id = $2', [friend, owner]);
      const rows = await ratingsSeenBy(friend, owner);
      expect(rows, 'an unfollowed account still received the score').toHaveLength(0);
    });
  });

  it('keeps EXECUTE off anon and off PUBLIC (criterion 4b)', async () => {
    // The grant itself, not a call: a blanket `grant execute ... to public` in
    // some future migration would leave every behavioral test above green (they
    // assert on the gate, and anon still has no auth.uid()) while handing the
    // function to anyone who can reach PostgREST. This is the test that fails.
    //
    // Both halves are needed. The ACL says who was GRANTED it; the privilege
    // check says who can USE it, which also catches a grant inherited through
    // another role rather than written on this function.
    const { rows } = await db.query(`
      select coalesce(r.rolname, 'PUBLIC') as grantee
        from pg_proc p
        cross join lateral aclexplode(p.proacl) a
        left join pg_roles r on r.oid = a.grantee
       where p.oid = 'public.get_friend_ratings()'::regprocedure
         and a.privilege_type = 'EXECUTE'
    `);
    const grantees = rows.map((row) => row.grantee as string);
    expect(grantees, 'authenticated lost EXECUTE on get_friend_ratings').toContain('authenticated');
    expect(grantees, 'PUBLIC was granted EXECUTE on get_friend_ratings').not.toContain('PUBLIC');
    expect(grantees, 'anon was granted EXECUTE on get_friend_ratings').not.toContain('anon');

    const { rows: usable } = await db.query(`
      select has_function_privilege('anon', 'public.get_friend_ratings()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.get_friend_ratings()', 'execute') as authed
    `);
    expect(usable[0].anon, 'anon can execute get_friend_ratings').toBe(false);
    expect(usable[0].authed, 'authenticated cannot execute get_friend_ratings').toBe(true);
  });

  it('exposes NO score on the anonymous public-list surface (criterion 5)', async () => {
    // 0015's get_public_ratings is the widest audience any rating data has, and
    // 0064 deliberately does not touch it. Asked of the database, not the file:
    // a later migration could add the column without editing 0015. RETURNS
    // TABLE columns live in proargnames/proargmodes ('t'), not in a composite
    // type — prorettype is the `record` pseudo-type here.
    const { rows } = await db.query(`
      select a.name as column_name
        from pg_proc p
        cross join lateral unnest(p.proargnames, p.proargmodes) as a(name, mode)
       where p.oid = 'public.get_public_ratings(text)'::regprocedure
         and a.mode in ('o', 'b', 't')
    `);
    const columns = rows.map((row) => row.column_name as string);
    expect(columns.length, 'get_public_ratings returned no columns to inspect').toBeGreaterThan(0);
    expect(columns, 'the anonymous surface now returns a score').not.toContain('score');
  });
});
