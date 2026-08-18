import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { buildDrainDeps } from './notificationDrainDeps';
import { drainNotificationOutbox, type OutboxRow } from './notificationOutbox';

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
      gte: () => chain,
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
          status: 'sent',
          apnsStatus: 200,
          apnsReason: null,
        }),
      'notification_deliveries',
      'delivery record unavailable',
    ],
    [
      'revokeToken',
      (deps) => deps.revokeToken('device-1'),
      'native_device_tokens',
      'token revocation unavailable',
    ],
    [
      'markOutbox',
      (deps) => deps.markOutbox(7, 'claim-token-1', 'sent', null),
      'notification_outbox',
      'outbox status write unavailable',
    ],
    [
      'deferOutbox',
      (deps) => deps.deferOutbox(7, 'claim-token-1', 'ServiceUnavailable'),
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

    await expect(deps.reserveDelivery(7, 'device-1')).resolves.toBe(true);
    expect(calls).toEqual([
      {
        table: 'notification_deliveries',
        operation: 'insert',
        payload: { outbox_id: 7, device_token_id: 'device-1', status: 'pending' },
      },
    ]);
  });

  it('reports a duplicate as taken, NOT as an error', async () => {
    // The unique violation is the fence doing its job: another pass already
    // reached this device and it must not be sent to again.
    const { admin } = fakeAdmin({
      results: { 'notification_deliveries:insert': { data: null, error: { code: '23505' } }, 'notification_deliveries:update': { data: [], error: null } },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1')).resolves.toBe(false);
  });

  it('RETAKES a reservation a previous pass recorded as failed', async () => {
    // APNs said the push did not arrive, so re-sending is the retry the
    // attempt budget exists for - not a duplicate.
    const { admin, calls } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [{ id: 1 }], error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1')).resolves.toBe(true);
    expect(calls[1]).toMatchObject({
      table: 'notification_deliveries',
      operation: 'update',
      outbox_id: 7,
      device_token_id: 'device-1',
      // The filter that makes this safe: only a FAILED row is retakeable.
      status: 'failed',
    });
  });

  it('does NOT retake a settled or still-ambiguous reservation', async () => {
    // 'sent' and 'invalid_token' are settled; 'pending' means an earlier pass
    // reserved it and we never learned whether Apple got the push. The
    // status='failed' filter matches none of them, so the update returns no
    // rows and the device is skipped.
    const { admin } = fakeAdmin({
      results: {
        'notification_deliveries:insert': { data: null, error: { code: '23505' } },
        'notification_deliveries:update': { data: [], error: null },
      },
    });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1')).resolves.toBe(false);
  });

  it('still throws on any OTHER write failure', async () => {
    const { admin } = fakeAdmin({ results: { notification_deliveries: ERROR } });
    const deps = buildDrainDeps(admin, SEND);

    await expect(deps.reserveDelivery(7, 'device-1')).rejects.toThrow(
      /delivery reservation unavailable/,
    );
  });
});

describe('claim ownership fence', () => {
  it('conditions the status write on the claim token this drain was handed', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.markOutbox(7, 'claim-token-1', 'sent', null);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: 'notification_outbox',
      operation: 'update',
      id: 7,
      claim_token: 'claim-token-1',
    });
  });

  it('releases the claim on defer so the next drain need not wait out the lease', async () => {
    const { admin, calls } = fakeAdmin({});
    const deps = buildDrainDeps(admin, SEND);

    await deps.deferOutbox(7, 'claim-token-1', 'ServiceUnavailable');

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
