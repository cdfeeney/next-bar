import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { stagingDatabaseTarget } from './liveDbTarget';

/**
 * G-01 — the named guest RSVP and the account funnel, against STAGING (0080).
 * Skips, with the reason in the title, until the owner applies 0080. Every case
 * runs inside a transaction that is rolled back.
 */
const SUITE = 'anonGuestName.live.test.ts';
const TARGET = stagingDatabaseTarget(SUITE);
const URL = TARGET?.url ?? null;
const describeLive = TARGET ? describe : describe.skip;

describeLive('0080 night_out_anon_rsvps — a guest RSVPs with a name', () => {
  let db: Client;
  let applied = false;
  /** R-04 (0081): the trim became a regex and the guests read carries nameless rows. */
  let applied81 = false;

  beforeAll(async () => {
    db = new Client({
      connectionString: URL as string,
      ssl: (TARGET as { ssl: object }).ssl,
      statement_timeout: 30000,
      application_name: 'g01-guest-name',
    });
    await db.connect();
    const { rows } = await db.query(
      "select count(*)::int as n from pg_proc where proname = 'get_night_out_anon_guests'",
    );
    applied = rows[0].n > 0;
    if (applied) {
      const { rows: def } = await db.query(
        "select pg_get_functiondef('public.rsvp_night_out_by_token(uuid, uuid, text, text)'::regprocedure) as src",
      );
      applied81 = /regexp_replace\(p_guest_name/.test(def[0].src as string);
    }
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

  /**
   * A permission error ABORTS the whole transaction in Postgres, so every later
   * query in the same test dies with "current transaction is aborted" — which
   * is what this suite did the first time it ran against an applied 0080. Take
   * an expected denial inside a savepoint and the transaction survives it.
   */
  async function expectDenied(sql: string, params: unknown[]) {
    await db.query('SAVEPOINT denial');
    await expect(db.query(sql, params)).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/i),
    });
    await db.query('ROLLBACK TO SAVEPOINT denial');
  }

  const asRole = async (role: string, uid?: string) => {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role }),
      ]);
    }
  };

  async function ownerWithPlan(): Promise<{ owner: string; planId: string; token: string }> {
    const owner = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [owner]);
    await asRole('authenticated', owner);
    const { rows } = await db.query('select public.create_night_out(current_date, $1, null) as id', ['G-01 guest']);
    const planId = rows[0].id as string;
    await db.query('RESET ROLE');
    const { rows: tok } = await db.query('select share_token from public.night_outs where id = $1', [planId]);
    return { owner, planId, token: tok[0].share_token as string };
  }

  it('applied-or-skipped is stated, never silent', () => {
    expect(typeof applied).toBe('boolean');
  });

  it('Going needs a name; declined may be anonymous; a later nameless answer keeps the name', async ({ skip }) => {
    if (!applied) skip('0080 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { planId, token } = await ownerWithPlan();
      const key = randomUUID();
      await asRole('anon');

      const nameless = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'going', null) as ok", [token, key],
      );
      expect(nameless.rows[0].ok, 'Going without a name must be refused').toBe(false);

      const named = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'going', '  Alex  ') as ok", [token, key],
      );
      expect(named.rows[0].ok).toBe(true);

      // Changing to "can't make it" without re-typing keeps the name on the row.
      const declined = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'declined', null) as ok", [token, key],
      );
      expect(declined.rows[0].ok).toBe(true);

      await db.query('RESET ROLE');
      const { rows } = await db.query(
        'select guest_name, response from public.night_out_anon_rsvps where night_out_id = $1 and rsvp_key = $2',
        [planId, key],
      );
      expect(rows[0]).toEqual({ guest_name: 'Alex', response: 'declined' });

      // A nameless "can't make it" from a NEW key is allowed.
      await asRole('anon');
      const anonDecline = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'declined', null) as ok", [token, randomUUID()],
      );
      expect(anonDecline.rows[0].ok).toBe(true);
    });
  });

  it('members read the named guests; a non-member and anon cannot', async ({ skip }) => {
    if (!applied) skip('0080 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { owner, planId, token } = await ownerWithPlan();
      await asRole('anon');
      await db.query("select public.rsvp_night_out_by_token($1, $2, 'going', 'Sam') as ok", [token, randomUUID()]);

      await asRole('authenticated', owner);
      const { rows } = await db.query('select * from public.get_night_out_anon_guests($1)', [planId]);
      expect(rows).toEqual([{ guest_name: 'Sam', response: 'going' }]);

      const stranger = randomUUID();
      await db.query('RESET ROLE');
      await db.query('insert into auth.users (id) values ($1)', [stranger]);
      await asRole('authenticated', stranger);
      const { rows: none } = await db.query('select * from public.get_night_out_anon_guests($1)', [planId]);
      expect(none, 'a non-member sees no guests').toEqual([]);

      await asRole('anon');
      await expectDenied('select * from public.get_night_out_anon_guests($1)', [planId]);
    });
  });

  it('R-04 (0081): a name of non-breaking spaces is no name; the guests read carries the nameless too', async ({ skip }) => {
    if (!applied81) skip('0081 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { owner, planId, token } = await ownerWithPlan();
      await asRole('anon');

      // U+00A0 only: String.trim() leaves nothing, and so must the server.
      const nbsp = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'going', $3) as ok", [token, randomUUID(), '  '],
      );
      expect(nbsp.rows[0].ok, 'a Going under a name of U+00A0 must be refused').toBe(false);

      // The same padding around a real name is stripped, U+FEFF included.
      const key = randomUUID();
      const padded = await db.query(
        "select public.rsvp_night_out_by_token($1, $2, 'going', $3) as ok", [token, key, '  Al ﻿'],
      );
      expect(padded.rows[0].ok).toBe(true);
      // ...and a nameless "can't make it" sits beside it.
      await db.query("select public.rsvp_night_out_by_token($1, $2, 'declined', null)", [token, randomUUID()]);

      await asRole('authenticated', owner);
      const { rows } = await db.query('select * from public.get_night_out_anon_guests($1)', [planId]);
      expect(rows).toEqual([
        { guest_name: 'Al', response: 'going' },
        { guest_name: null, response: 'declined' },
      ]);
    });
  });

  it('the funnel: anon can no longer read attendee NAMES, only the count', async ({ skip }) => {
    if (!applied) skip('0080 not applied on staging yet — the owner runs apply-migration-set');
    await inRollback(async () => {
      const { token } = await ownerWithPlan();
      await asRole('anon');
      await expectDenied('select * from public.preview_night_out_attendees($1)', [token]);
      // The preview (with its accepted COUNT) is still anon-readable.
      const { rows } = await db.query('select * from public.preview_night_out($1)', [token]);
      expect(rows.length).toBe(1);
    });
  });
});
