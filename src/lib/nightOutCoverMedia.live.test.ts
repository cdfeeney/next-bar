import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * S-06c — a library photo as a plan cover, against STAGING (0082). Skips, with
 * the reason in the title, until the owner applies 0082. Every case runs inside
 * a transaction that is rolled back; nothing touches Storage — the read window
 * and the sweeps decide from the registry and the plan row alone.
 */
const SUITE = 'nightOutCoverMedia.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

describeLive('0082 night_outs.cover = media:<id> — readable to members, kept from the sweeps, released on cancel', () => {
  let db: Client;
  let applied = false;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 's06c-cover-media',
    });
    await db.connect();
    const { rows } = await db.query(
      "select pg_get_functiondef('public.media_read_window(text)'::regprocedure) as src",
    );
    applied = /v_cover_readable/.test(rows[0].src as string);
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

  /** A plan owned by `owner` with `member` accepted, plus a 25-hour-old registered upload of the owner's. */
  async function fixture() {
    const owner = await account();
    const member = await account();
    const stranger = await account();
    await asRole('authenticated', owner);
    const { rows } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['S-06c cover']);
    const planId = rows[0].id as string;
    await asPostgres();
    await db.query(
      `insert into public.night_out_members (night_out_id, user_id, role, invite_status)
       values ($1, $2, 'member', 'accepted')`,
      [planId, member],
    );
    const mediaId = randomUUID();
    const storagePath = `${owner}/${mediaId}`;
    await db.query(
      `insert into public.media_objects (id, owner_id, bucket_id, storage_path, content_type, byte_size, server_verified, created_at)
       values ($1, $2, 'story-media', $3, 'image/jpeg', 1234, true, now() - interval '25 hours')`,
      [mediaId, owner, storagePath],
    );
    return { owner, member, stranger, planId, mediaId, storagePath };
  }

  const readable = async (storagePath: string): Promise<boolean> => {
    const { rows } = await db.query('select readable from public.media_read_window($1)', [storagePath]);
    return rows[0].readable as boolean;
  };

  it('applied-or-skipped is stated, never silent', () => {
    expect(typeof applied).toBe('boolean');
  });

  it('the owner may set a media cover they own; not someone else\'s object, not a made-up id', async ({ skip }) => {
    if (!applied) skip('0082 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { owner, stranger, planId, mediaId } = await fixture();
      await asPostgres();
      const otherId = randomUUID();
      await db.query(
        `insert into public.media_objects (id, owner_id, bucket_id, storage_path) values ($1, $2, 'story-media', $3)`,
        [otherId, stranger, `${stranger}/${otherId}`],
      );
      await asRole('authenticated', owner);
      const own = await db.query('select public.set_night_out_cover($1, $2) as ok', [planId, `media:${mediaId}`]);
      expect(own.rows[0].ok).toBe(true);
      const theirs = await db.query('select public.set_night_out_cover($1, $2) as ok', [planId, `media:${otherId}`]);
      expect(theirs.rows[0].ok, "another account's object is refused").toBe(false);
      const nothing = await db.query('select public.set_night_out_cover($1, $2) as ok', [planId, `media:${randomUUID()}`]);
      expect(nothing.rows[0].ok, 'an unregistered id is refused').toBe(false);
      const template = await db.query('select public.set_night_out_cover($1, $2) as ok', [planId, 'template:rooftop']);
      expect(template.rows[0].ok, 'templates still work exactly as in S-06b').toBe(true);
      await asPostgres();
      const { rows } = await db.query('select cover from public.night_outs where id = $1', [planId]);
      expect(rows[0].cover).toBe('template:rooftop');
    });
  });

  it('a member can read the cover object; a non-member cannot; the plan\'s cancellation withdraws it', async ({ skip }) => {
    if (!applied) skip('0082 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { owner, member, stranger, planId, mediaId, storagePath } = await fixture();
      await asRole('authenticated', owner);
      await db.query('select public.set_night_out_cover($1, $2)', [planId, `media:${mediaId}`]);

      await asRole('authenticated', member);
      expect(await readable(storagePath), 'an accepted member reads the cover').toBe(true);
      await asRole('authenticated', stranger);
      expect(await readable(storagePath), 'a non-member does not').toBe(false);
      await asRole('authenticated', owner);
      expect(await readable(storagePath), 'the uploader always could').toBe(true);

      await db.query('select public.cancel_night_out($1)', [planId]);
      await asRole('authenticated', member);
      expect(await readable(storagePath), 'a cancelled plan authorises nobody').toBe(false);
    });
  });

  it('the sweep does not claim a referenced cover object; cancelling the plan makes it claimable', async ({ skip }) => {
    if (!applied) skip('0082 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { owner, planId, mediaId } = await fixture();
      await asRole('authenticated', owner);
      // 25 hours old, no destination, unreferenced: claimable before the cover exists.
      const before = await db.query('select public.media_live_reference_count($1)::int as n', [mediaId]);
      expect(before.rows[0].n).toBe(0);

      await db.query('select public.set_night_out_cover($1, $2)', [planId, `media:${mediaId}`]);
      const held = await db.query('select public.media_live_reference_count($1)::int as n', [mediaId]);
      expect(held.rows[0].n, 'a live plan cover is one live reference').toBe(1);
      const kept = await db.query('select media_id from public.claim_media_for_removal($1, 25)', [mediaId]);
      expect(kept.rows, 'the sweep leaves a referenced cover alone').toEqual([]);

      await db.query('select public.cancel_night_out($1)', [planId]);
      const released = await db.query('select public.media_live_reference_count($1)::int as n', [mediaId]);
      expect(released.rows[0].n, 'cancelling the plan releases the reference').toBe(0);
      const claimed = await db.query('select media_id from public.claim_media_for_removal($1, 25)', [mediaId]);
      expect(claimed.rows.map((r) => r.media_id)).toEqual([mediaId]);
    });
  });
});
