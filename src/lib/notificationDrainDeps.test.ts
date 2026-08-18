import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { buildDrainDeps } from './notificationDrainDeps';
import {
  MAX_ATTEMPTS,
  drainNotificationOutbox,
  type OutboxRow,
} from './notificationOutbox';

/**
 * The database half of the drain, against a fake Supabase client.
 *
 * These adapters used to DISCARD every error a mutation returned, which is
 * the class of defect a mocked-rules test cannot see: notificationOutbox.test.ts
 * asserts what the drain decides given honest dependencies, and this file
 * asserts the dependencies are honest. Every case below is "the database said
 * no" — the drain must hear it.
 */

type Result = { data?: unknown; error?: unknown; count?: number | null };

const ERROR: Result = { data: null, error: { code: '42501' } };
const OK: Result = { data: null, error: null };

/**
 * Enough of the PostgREST builder to run these adapters: every chaining call
 * returns the same thenable, which resolves to the result the table was given.
 * Records each mutation so the fenced writes can be asserted.
 */
function fakeAdmin(options: {
  results?: Record<string, Result>;
  rpc?: Result;
}): { admin: SupabaseClient; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];

  function builder(table: string, operation: string, payload?: unknown) {
    const filters: Record<string, unknown> = {};
    const result =
      options.results?.[`${table}:${operation}`] ?? options.results?.[table] ?? OK;
    const chain = {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      is: () => chain,
      gte: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      in: (column: string, values: unknown) => {
        filters[column] = values;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: () => chain,
      then: (resolve: (value: Result) => unknown) => {
        calls.push({ table, operation, payload, ...filters });
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  }

  const admin = {
    from: (table: string) => ({
      select: (...args: unknown[]) => builder(table, 'select', args[0]),
      insert: (payload: unknown) => builder(table, 'insert', payload),
      update: (payload: unknown) => builder(table, 'update', payload),
      upsert: (payload: unknown) => builder(table, 'upsert', payload),
    }),
    rpc: async () => options.rpc ?? { data: [], error: null },
  } as unknown as SupabaseClient;

  return { admin, calls };
}

const SEND = async () => ({ outcome: 'sent' as const, status: 200, reason: null });
const CLAIM = 'claim-token-1';

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 7,
    event_type: 'invited',
    night_out_id: '99999999-8888-4777-8666-555555555555',
    recipient_user_id: 'user-recipient',
    actor_id: 'user-actor',
    bar_id: null,
    attempts: 1,
    claim_token: 'claim-token-1',
    ...overrides,
  };
}

describe('read adapters surface database errors instead of guessing', () => {
  it('fetchContext THROWS on a night_outs read error rather than reporting a deleted plan', async () => {
    // The dropped error read as "the plan is gone", which is TERMINAL: one
    // transient blip permanently retired a deliverable notification.
    const { admin } = fakeAdmin({ results: { night_outs: ERROR } });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.fetchContext(row())).rejects.toThrow(/night out unavailable/);
  });

  it('fetchContext THROWS on a profiles read error rather than sending as "Someone"', async () => {
    const { admin } = fakeAdmin({
      results: {
        night_outs: { data: { share_token: 'tok', title: 'Friday' }, error: null },
        profiles: ERROR,
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.fetchContext(row())).rejects.toThrow(/actor profile unavailable/);
  });

  it('fetchContext still reports a genuinely missing plan as null', async () => {
    const { admin } = fakeAdmin({ results: { night_outs: { data: null, error: null } } });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.fetchContext(row())).resolves.toBeNull();
  });

  it('fetchPreferences THROWS rather than granting consent nobody gave', async () => {
    const { admin } = fakeAdmin({ results: { notification_preferences: ERROR } });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.fetchPreferences('user-1')).rejects.toThrow(/preferences unavailable/);
  });
});

describe('mutation adapters surface database errors', () => {
  const cases: Array<[string, (deps: ReturnType<typeof buildDrainDeps>) => Promise<unknown>, string, string]> = [
    [
      'recordDelivery',
      (deps) =>
        deps.recordDelivery({
          outboxId: 7,
          deviceTokenId: 'device-1',
          claimToken: CLAIM,
          status: 'sent',
          apnsStatus: 200,
          apnsReason: null,
        }),
      'notification_deliveries',
      'delivery record unavailable',
    ],
    [
      'revokeToken',
      (deps) => deps.revokeToken('device-1', 'a'.repeat(64)),
      'native_device_tokens',
      'token revocation unavailable',
    ],
    [
      'markOutbox',
      (deps) => deps.markOutbox(7, 'claim-token-1', 'sent', null, true),
      'notification_outbox',
      'outbox status write unavailable',
    ],
    [
      'deferOutbox',
      (deps) => deps.deferOutbox(7, 'claim-token-1', 'ServiceUnavailable', false),
      'notification_outbox',
      'outbox defer unavailable',
    ],
  ];

  for (const [name, call, table, message] of cases) {
    it(`${name} throws when the write is rejected`, async () => {
      const { admin } = fakeAdmin({ results: { [table]: ERROR } });
      await expect(call(buildDrainDeps(admin, SEND))).rejects.toThrow(message);
    });
  }
});

describe('reserveDelivery', () => {
  it('takes the (row, device) pair and reports it as ours', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).resolves.toBe('reserved');
    expect(calls).toEqual([
      {
        table: 'notification_deliveries',
        operation: 'insert',
        payload: {
        outbox_id: 7,
        device_token_id: 'device-1',
        status: 'pending',
        claim_token: CLAIM,
      },
      },
    ]);
  });

  it('treats a unique violation as a decision, NOT as an error', async () => {
    // The unique violation is the fence doing its job: another pass already
    // reached this device. It resolves to an outcome rather than throwing.
    const { admin } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [], error: null },
        'notification_deliveries:select': { data: { status: 'sent' }, error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).resolves.not.toBe('reserved');
  });

  it('RETAKES an unsettled reservation, and only an unsettled one', async () => {
    // 'failed' means APNs said it did not arrive; 'pending' means the pass that
    // reserved it never came back, and only an EXPIRED outbox claim can show
    // such a row to a second drain. Both are retryable. 'sent' and
    // 'invalid_token' are settled and must never appear in this filter, or a
    // delivered push would be repeated.
    const { admin, calls } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [{ id: 1 }], error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).resolves.toBe('reserved');
    expect(calls[1]).toMatchObject({
      table: 'notification_deliveries',
      operation: 'update',
      outbox_id: 7,
      device_token_id: 'device-1',
      status: ['pending', 'failed'],
    });
    expect(calls[1].status).not.toContain('sent');
    expect(calls[1].status).not.toContain('invalid_token');
  });

  it('FENCES the delivery write on the reservation this drain made', async () => {
    // The outbox claim protected the row's STATUS but not the delivery row, so
    // a sender that stalled past its lease could return and overwrite a
    // delivery a later drain had already settled - turning 'sent' into a stale
    // 'failed' and buying a retry nobody owed.
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.recordDelivery({
      outboxId: 7,
      deviceTokenId: 'device-1',
      claimToken: CLAIM,
      status: 'sent',
      apnsStatus: 200,
      apnsReason: null,
    });

    expect(calls[0]).toMatchObject({
      table: 'notification_deliveries',
      operation: 'update',
      outbox_id: 7,
      device_token_id: 'device-1',
      claim_token: CLAIM,
    });
  });

  it('revokes the exact TOKEN it sent, not merely the row', async () => {
    // save_native_device_token rotates a token in place for the same
    // installation, so revoking by id alone could retire a fresh working token
    // because a send for the previous one came back rejected.
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.revokeToken('device-1', 'a'.repeat(64));

    expect(calls[0]).toMatchObject({
      table: 'native_device_tokens',
      operation: 'update',
      id: 'device-1',
      token: 'a'.repeat(64),
    });
  });

  it('takes OWNERSHIP of a retaken reservation, so the superseded drain cannot settle it', async () => {
    const { admin, calls } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [{ id: 1 }], error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await deps.reserveDelivery(7, 'device-1', 'claim-token-2');

    expect(calls[1]).toMatchObject({
      table: 'notification_deliveries',
      operation: 'update',
      payload: {
        status: 'pending',
        apns_status: null,
        apns_reason: null,
        claim_token: 'claim-token-2',
      },
    });
  });

  it('reports a device an earlier pass DELIVERED to as already-sent, not merely settled', async () => {
    // The difference matters: a row deferred for one flaky phone comes back
    // with the other phone already served, and a pass that read that as
    // nothing marked the whole row failed and kept it out of the rate-limit
    // count.
    const { admin } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [], error: null },
        'notification_deliveries:select': { data: { status: 'sent' }, error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).resolves.toBe('already-sent');
  });

  it('reports a retired token as settled, which is not a delivery', async () => {
    const { admin } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [], error: null },
        'notification_deliveries:select': { data: { status: 'invalid_token' }, error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).resolves.toBe('settled');
  });

  it('passes the attempt ceiling to the claim so SQL can enforce it too', async () => {
    // A worker killed between the claim committing and the drain reading
    // `attempts` never runs the caller-side ceiling check, so the statement
    // itself has to refuse an exhausted row.
    const rpcArgs: unknown[] = [];
    const { admin } = fakeAdmin({});
    (admin as unknown as { rpc: unknown }).rpc = async (fn: string, args: unknown) => {
      rpcArgs.push({ fn, args });
      return { data: [], error: null };
    };
    const deps = buildDrainDeps(admin, SEND);

    await deps.fetchPending(100);

    expect(rpcArgs[0]).toMatchObject({
      fn: 'claim_notification_outbox',
      args: { p_limit: 100, p_max_attempts: MAX_ATTEMPTS },
    });
  });

  it('still throws on any OTHER write failure', async () => {
    const { admin } = fakeAdmin({ results: { notification_deliveries: ERROR } });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1', CLAIM)).rejects.toThrow(
      /delivery reservation unavailable/,
    );
  });
});

describe('claim ownership fence', () => {
  it('conditions the status write on the claim token this drain was handed', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.markOutbox(7, 'claim-token-1', 'sent', null, true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: 'notification_outbox',
      operation: 'update',
      id: 7,
      claim_token: 'claim-token-1',
    });
  });

  it('stamps delivered_at only when the pass actually reached a phone', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.markOutbox(7, CLAIM, 'sent', null, true);
    await deps.markOutbox(8, CLAIM, 'suppressed', 'opted_out', false);

    expect(calls[0].payload).toHaveProperty('delivered_at');
    expect(calls[1].payload).not.toHaveProperty('delivered_at');
  });

  it('counts the rate-limit window on delivered_at, not on the row status', async () => {
    // Counting rows marked 'sent' missed a row still pending for a second
    // device's retry, even though the first device already had it.
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.countRecentSends('user-1', '2026-08-18T00:00:00.000Z');

    expect(calls[0]).toMatchObject({
      table: 'notification_outbox',
      operation: 'select',
      recipient_user_id: 'user-1',
    });
    expect(calls[0]).not.toHaveProperty('status');
  });

  it('releases the claim on defer so the next drain need not wait out the lease', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.deferOutbox(7, 'claim-token-1', 'ServiceUnavailable', false);

    expect(calls[0]).toMatchObject({
      table: 'notification_outbox',
      claim_token: 'claim-token-1',
      payload: {
        last_error: 'ServiceUnavailable',
        claimed_at: null,
        claim_token: null,
      },
    });
  });
});

describe('drain end to end against the fake client', () => {
  it('defers a row whose status write is rejected rather than reporting it sent', async () => {
    // The whole point of the adapters throwing: an unconfirmed write must not
    // be counted as a delivery, and must leave the row for the next drain.
    const { admin } = fakeAdmin({
      rpc: { data: [row()], error: null },
      results: {
        notification_preferences: { data: null, error: null },
        night_outs: { data: { share_token: 'tok', title: 'Friday' }, error: null },
        profiles: { data: { display_name: 'Sam', handle: 'sam' }, error: null },
        native_device_tokens: { data: [{ id: 'device-1', token: 'a'.repeat(64) }], error: null },
        // The rate-limit count reads this table and must succeed; only the
        // status WRITE is rejected.
        'notification_outbox:select': { data: null, error: null, count: 0 },
        'notification_outbox:update': ERROR,
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    const summary = await drainNotificationOutbox(deps);

    expect(summary).toMatchObject({ processed: 1, sent: 0, deferred: 1 });
  });
});
