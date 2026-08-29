import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * WP6 BEHAVIOURAL RLS/RPC negatives for 0067_groups.sql.
 *
 * WHY THIS FILE EXISTS, and it is the same finding three review rounds have now raised. Round 1
 * (Codex, medium): "no repository test references the group RPCs or validates authenticated
 * behavior for GRP-001 through GRP-008." Round 8 (Codex, medium) restated it with a trigger that
 * settles the argument — remove the caller-membership predicate from `send_group_message` and
 * every existing focused test stays green, because `groups.server.test.ts` reads SQL TEXT and the
 * browser suite stubs the transport. Neither can tell you whether the database actually DENIES
 * anyone.
 *
 * `groups.server.test.ts` proves the security SHAPE. `e2e/groups.spec.ts` proves what the client
 * RENDERS once the server has decided. This file is the third thing, and the only one that asks
 * the database: it connects as the real `anon` and `authenticated` roles and asserts the refusals
 * happen.
 *
 * NOT EXECUTED IN THIS LANE, AND SAID PLAINLY. WP6 is forbidden from applying migrations to any
 * shared database, so 0067 is written-only here and this suite cannot pass in this worktree:
 * `stagingDatabaseTarget` REFUSES — loudly, by throwing — a target it cannot verify as staging,
 * and an unattended lane is deliberately never handed the credential that would name one. That is
 * the same refusal `nightOutsRls.live.test.ts`, `storiesRls.live.test.ts` and
 * `friendScoreRls.live.test.ts` produce in the same environment, and it is the intended behaviour:
 * a missing target is a loud failure, never a green run. It executes at the attended integration
 * gate against an applied schema. Treat what is below as the behavioural receipt now owed and
 * RUNNABLE, not as evidence it has passed.
 *
 * Everything runs inside a transaction that ROLLS BACK, which is what makes it safe to point at a
 * live database. `SET LOCAL ROLE` plus `request.jwt.claims` is how Supabase RLS is exercised from
 * SQL: policies read `auth.uid()` out of those claims, so switching role and claim inside a
 * transaction reproduces what PostgREST would do for that user without a running API.
 */

const SUITE = 'groupsRls.live.test.ts';

/**
 * The staging-only gate, the TLS chain and the CI acknowledgement all live in ./liveDbTarget —
 * one copy shared with the other live suites, because a second COPY of a security gate is how one
 * of them ends up ungated.
 */
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;

const describeLive = TARGET ? describe : describe.skip;

describeLive('0067 groups — live RLS/RPC denials', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      // Exactly the TLS the gate authorised — rebuilding it here would let the suite connect with
      // a config nobody verified. See ./liveDbTarget for the pooler's self-signed chain.
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 'wp6-groups-rls-negatives',
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end().catch(() => {});
  });

  /** Run fn inside a rolled-back transaction, so nothing persists. */
  async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
    // READ WRITE explicitly — this suite INSERTs fixtures and the pooler-pinned backend defaults
    // to read-only.
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

  /** Real identities, so the profiles trigger and every FK behave as they do in production. */
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

  /** A group owned by `admin`, with `others` added as ordinary members. */
  async function makeGroup(admin: string, others: string[] = []): Promise<string> {
    await asRole('authenticated', admin);
    const { rows } = await db.query('select public.create_group($1) as id', ['probe group']);
    const groupId = rows[0].id as string;
    for (const uid of others) {
      const { rows: added } = await db.query(
        'select public.add_group_member($1,$2) as ok', [groupId, uid],
      );
      expect(added[0].ok, 'the fixture could not add a member').toBe(true);
    }
    return groupId;
  }

  const refusal = async (sql: string, params: unknown[] = []): Promise<string | null> => {
    try {
      await db.query(sql, params);
      return null;
    } catch (error) {
      return (error as { message: string }).message;
    }
  };

  const TABLES = ['groups', 'group_members', 'group_messages', 'group_reads'];

  it('anon cannot read ANY group table directly', async () => {
    for (const table of TABLES) {
      const denied = await inRollback(async () => {
        await asRole('anon');
        return refusal(`select * from public.${table} limit 1`);
      });
      expect(denied, `anon could read public.${table}`).toMatch(/permission denied/i);
    }
  });

  it('anon cannot execute any group RPC', async () => {
    const calls: Array<[string, string]> = [
      ['create_group', "select public.create_group('x')"],
      ['rename_group', `select public.rename_group('${randomUUID()}'::uuid, 'x')`],
      ['add_group_member', `select public.add_group_member('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
      ['remove_group_member', `select public.remove_group_member('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
      ['leave_group', `select public.leave_group('${randomUUID()}'::uuid)`],
      ['send_group_message', `select public.send_group_message('${randomUUID()}'::uuid, 'x')`],
      ['delete_group_message', `select public.delete_group_message('${randomUUID()}'::uuid)`],
      ['mark_group_read', `select public.mark_group_read('${randomUUID()}'::uuid, now())`],
      ['group_unread_counts', 'select public.group_unread_counts()'],
      ['get_group_members', `select public.get_group_members('${randomUUID()}'::uuid)`],
      ['get_group_thread', `select public.get_group_thread('${randomUUID()}'::uuid)`],
      ['group_message_is_visible', `select public.group_message_is_visible('${randomUUID()}'::uuid)`],
      ['is_group_member', `select public.is_group_member('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
      ['is_group_admin', `select public.is_group_admin('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
      ['get_my_night_out_invitation_notifications', 'select public.get_my_night_out_invitation_notifications()'],
      ['mark_night_out_invitation_notification_read', 'select public.mark_night_out_invitation_notification_read(1)'],
      ['invite_group_to_night_out', `select public.invite_group_to_night_out('${randomUUID()}'::uuid, '${randomUUID()}'::uuid)`],
    ];
    for (const [name, sql] of calls) {
      const denied = await inRollback(async () => {
        await asRole('anon');
        return refusal(sql);
      });
      expect(denied, `anon could execute ${name}`).toMatch(/permission denied|not authenticated/i);
    }
  });

  it('a NON-MEMBER cannot send into a group (V8-R-GRP-002)', async () => {
    // THE ROUND-8 TRIGGER, EXECUTED. Delete the membership predicate from send_group_message and
    // this is the assertion that goes red — the one no SQL-text scan and no stubbed browser run
    // can make.
    await inRollback(async () => {
      const [admin, outsider] = await makeIdentities(2);
      const groupId = await makeGroup(admin);

      await asRole('authenticated', outsider);
      const denied = await refusal('select public.send_group_message($1, $2)', [groupId, 'hello']);
      expect(denied, 'a non-member was allowed to send into a group').not.toBeNull();
    });
  });

  it('a NON-MEMBER cannot read the thread or the roster (V8-R-GRP-001)', async () => {
    await inRollback(async () => {
      const [admin, member, outsider] = await makeIdentities(3);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', admin);
      await db.query('select public.send_group_message($1, $2)', [groupId, 'members only']);

      await asRole('authenticated', outsider);
      // Whether it raises or returns nothing, what must NOT happen is the message coming back.
      const thread = await db
        .query('select * from public.get_group_thread($1)', [groupId])
        .catch(() => ({ rows: [] as unknown[] }));
      expect(thread.rows, 'an outsider read a group thread').toHaveLength(0);

      const roster = await db
        .query('select * from public.get_group_members($1)', [groupId])
        .catch(() => ({ rows: [] as unknown[] }));
      expect(roster.rows, 'an outsider read a group roster').toHaveLength(0);

      // And the base table is not a way around the RPC.
      const direct = await db
        .query('select * from public.group_messages where group_id = $1', [groupId])
        .catch(() => ({ rows: [] as unknown[] }));
      expect(direct.rows, 'RLS let an outsider read group_messages directly').toHaveLength(0);
    });
  });

  it('an ORDINARY MEMBER cannot rename, add, or remove (V8-R-GRP-004 / GRP-005)', async () => {
    await inRollback(async () => {
      const [admin, member, stranger] = await makeIdentities(3);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', member);

      // Either a raise or a false return is a refusal, and 0067 does not promise which. What the
      // requirement promises is that the STATE does not change, so that is what is asserted.
      await refusal('select public.rename_group($1,$2)', [groupId, 'hijacked']);
      await refusal('select public.add_group_member($1,$2)', [groupId, stranger]);
      await refusal('select public.remove_group_member($1,$2)', [groupId, admin]);

      await db.query('RESET ROLE');
      const { rows: name } = await db.query('select name from public.groups where id=$1', [groupId]);
      expect(name[0].name, 'an ordinary member renamed the group').toBe('probe group');

      const { rows: roster } = await db.query(
        'select profile_id from public.group_members where group_id=$1', [groupId],
      );
      const ids = roster.map((r: { profile_id: string }) => r.profile_id).sort();
      expect(ids, 'an ordinary member changed the membership').toEqual([admin, member].sort());

    });
  });

  it('D-C-38: the last administrator leaving PROMOTES a successor (V8-R-GRP-006)', async () => {
    await inRollback(async () => {
      const [admin, member] = await makeIdentities(2);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', admin);
      await db.query('select public.leave_group($1)', [groupId]);

      await db.query('RESET ROLE');
      const { rows } = await db.query(
        'select profile_id, is_admin from public.group_members where group_id=$1', [groupId],
      );
      expect(rows, 'the departing admin was not removed').toHaveLength(1);
      expect(rows[0].profile_id).toBe(member);
      expect(rows[0].is_admin, 'succession left the group with no administrator').toBe(true);
    });
  });

  it('the LAST member leaving DELETES the group (V8-R-GRP-006)', async () => {
    await inRollback(async () => {
      const [admin] = await makeIdentities(1);
      const groupId = await makeGroup(admin);

      await asRole('authenticated', admin);
      await db.query('select public.leave_group($1)', [groupId]);

      await db.query('RESET ROLE');
      const { rows } = await db.query('select id from public.groups where id=$1', [groupId]);
      expect(rows, 'an empty group survived its last member').toHaveLength(0);
    });
  });

  it('reporting a group message HIDES it for the reporter alone (V8-R-FEED-010)', async () => {
    // WP6's share of the cross-lane requirement: the CHECK constraint admits 'group_message' and
    // report_content resolves it, in the same migration. The hide is per-reporter, so the other
    // member must still see the message.
    await inRollback(async () => {
      const [admin, member] = await makeIdentities(2);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', admin);
      await db.query('select public.send_group_message($1, $2)', [groupId, 'reportable']);

      await db.query('RESET ROLE');
      const { rows: msg } = await db.query(
        'select id from public.group_messages where group_id=$1', [groupId],
      );
      expect(msg, 'the fixture message was not created').toHaveLength(1);
      const messageId = msg[0].id as string;

      await asRole('authenticated', member);
      const { rows: reported } = await db.query(
        'select public.report_content($1,$2,$3) as id',
        ['group_message', messageId, 'probe'],
      );
      expect(reported[0].id, 'reporting a group message was refused').not.toBeNull();

      // HIDDEN FOR THE REPORTER.
      const { rows: mine } = await db.query('select id from public.get_group_thread($1)', [groupId]);
      expect(
        mine.map((r: { id: string }) => r.id),
        'the reported message is still visible to the reporter',
      ).not.toContain(messageId);

      // STILL THERE FOR EVERYONE ELSE — a report is not a delete.
      await asRole('authenticated', admin);
      const { rows: theirs } = await db.query('select id from public.get_group_thread($1)', [groupId]);
      expect(
        theirs.map((r: { id: string }) => r.id),
        'one member-s report removed the message for another member',
      ).toContain(messageId);
    });
  });

  it('mark_group_read advances the caller-s watermark and never moves it BACKWARDS', async () => {
    // Round 8 deleted the unseen-message guard, so what remains to prove is the monotonic write
    // itself — and monotonicity is a database fact no mocked client can reach.
    await inRollback(async () => {
      const [admin, member] = await makeIdentities(2);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', admin);
      await db.query('select public.send_group_message($1, $2)', [groupId, 'one']);

      await asRole('authenticated', member);
      const { rows: newest } = await db.query(
        'select max(created_at) as at from public.get_group_thread($1)', [groupId],
      );
      const at = newest[0].at as string;

      const { rows: first } = await db.query('select public.mark_group_read($1,$2) as ok', [groupId, at]);
      expect(first[0].ok, 'opening the thread did not read it').toBe(true);

      await db.query('RESET ROLE');
      const { rows: mark1 } = await db.query(
        'select last_read_at from public.group_reads where group_id=$1 and profile_id=$2',
        [groupId, member],
      );
      expect(mark1, 'no watermark was written').toHaveLength(1);

      // An older watermark arriving late must not resurrect what was already read.
      await asRole('authenticated', member);
      await db.query('select public.mark_group_read($1, $2::timestamptz)', [groupId, '2000-01-01T00:00:00Z']);
      await db.query('RESET ROLE');
      const { rows: mark2 } = await db.query(
        'select last_read_at from public.group_reads where group_id=$1 and profile_id=$2',
        [groupId, member],
      );
      expect(
        new Date(mark2[0].last_read_at as string).getTime(),
        'the watermark moved backwards',
      ).toBe(new Date(mark1[0].last_read_at as string).getTime());
    });
  });

  it('a NULL watermark is a no-op, not "everything up to now"', async () => {
    await inRollback(async () => {
      const [admin, member] = await makeIdentities(2);
      const groupId = await makeGroup(admin, [member]);

      await asRole('authenticated', member);
      const { rows } = await db.query('select public.mark_group_read($1, null) as ok', [groupId]);
      expect(rows[0].ok, 'an empty thread claimed a read').toBe(false);

      await db.query('RESET ROLE');
      const { rows: marks } = await db.query(
        'select 1 from public.group_reads where group_id=$1 and profile_id=$2',
        [groupId, member],
      );
      expect(marks, 'a null watermark still wrote a read row').toHaveLength(0);
    });
  });
});
