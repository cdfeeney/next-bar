import { describe, expect, it } from 'vitest';
import type { ApnsOutcome, ApnsPayload } from './apnsSender';
import {
  buildNotificationPayload,
  DEFAULT_PREFERENCES,
  drainNotificationOutbox,
  isEventAllowed,
  isWithinRateLimit,
  MAX_ATTEMPTS,
  RATE_LIMIT_PER_WINDOW,
  type DeviceToken,
  type DrainDeps,
  type NotificationContext,
  type NotificationPreferences,
  type OutboxRow,
} from './notificationOutbox';

/**
 * V8-4 criteria 3, 4, 7 and 10 — the delivery rules.
 *
 * Every dependency is a fake, so this file asserts the DECISIONS: who gets
 * suppressed, which token gets retired, what happens on the fifth retry, and
 * that one dead device does not stop the next one from being notified.
 */

const NOW = Date.UTC(2026, 7, 16, 21, 0, 0);
const TOKEN = '11111111-2222-4333-8444-555555555555';
const CLAIM = 'claim-token-1';

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 1,
    event_type: 'invited',
    night_out_id: '99999999-8888-4777-8666-555555555555',
    recipient_user_id: 'user-recipient',
    actor_id: 'user-actor',
    bar_id: null,
    // The claim charges the attempt, so a freshly claimed row arrives at 1.
    attempts: 1,
    claim_token: CLAIM,
    ...overrides,
  };
}

const CONTEXT: NotificationContext = {
  nightOutToken: TOKEN,
  nightOutTitle: 'Friday',
  actorName: 'Sam',
};

type Recorded = {
  deliveries: Array<{
    outboxId: number;
    deviceTokenId: string;
    claimToken: string;
    status: string;
  }>;
  reserved: string[];
  reserveTokens: string[];
  outbox: Array<{ id: number; claimToken: string; status: string; error: string | null }>;
  deferred: Array<{ id: number; claimToken: string; error: string | null }>;
  revoked: string[];
  sentTo: string[];
};

function harness(options: {
  rows: OutboxRow[];
  devices?: readonly DeviceToken[];
  preferences?: NotificationPreferences | null;
  recentSends?: number;
  context?: NotificationContext | null;
  outcomes?: Record<string, { outcome: ApnsOutcome; status: number; reason: string | null }>;
  /** Devices a previous pass already reserved — reserveDelivery refuses these. */
  alreadyReserved?: readonly string[];
  /** Adapters that must reject, to stand in for a failed database write. */
  failing?: Partial<Record<'recordDelivery' | 'markOutbox' | 'revokeToken', true>>;
}): { deps: DrainDeps; recorded: Recorded } {
  const recorded: Recorded = {
    deliveries: [],
    reserved: [],
    reserveTokens: [],
    outbox: [],
    deferred: [],
    revoked: [],
    sentTo: [],
  };
  const taken = new Set(options.alreadyReserved ?? []);
  const devices = options.devices ?? [{ id: 'device-1', token: 'a'.repeat(64) }];

  const deps: DrainDeps = {
    fetchPending: async () => options.rows,
    fetchPreferences: async () =>
      options.preferences === undefined ? DEFAULT_PREFERENCES : options.preferences,
    fetchContext: async () =>
      options.context === undefined ? CONTEXT : options.context,
    fetchLiveTokens: async () => devices,
    countRecentSends: async () => options.recentSends ?? 0,
    send: async (deviceToken: string, _payload: ApnsPayload) => {
      recorded.sentTo.push(deviceToken);
      return (
        options.outcomes?.[deviceToken] ?? {
          outcome: 'sent' as ApnsOutcome,
          status: 200,
          reason: null,
        }
      );
    },
    reserveDelivery: async (outboxId, deviceTokenId, claimToken) => {
      recorded.reserveTokens.push(claimToken);
      const key = `${outboxId}:${deviceTokenId}`;
      if (taken.has(key)) return false;
      taken.add(key);
      recorded.reserved.push(key);
      return true;
    },
    recordDelivery: async (input) => {
      if (options.failing?.recordDelivery) throw new Error('delivery record unavailable');
      recorded.deliveries.push({
        outboxId: input.outboxId,
        deviceTokenId: input.deviceTokenId,
        claimToken: input.claimToken,
        status: input.status,
      });
    },
    revokeToken: async (id) => {
      if (options.failing?.revokeToken) throw new Error('token revocation unavailable');
      recorded.revoked.push(id);
    },
    markOutbox: async (id, claimToken, status, error) => {
      if (options.failing?.markOutbox) throw new Error('outbox status write unavailable');
      recorded.outbox.push({ id, claimToken, status, error });
    },
    deferOutbox: async (id, claimToken, error) => {
      recorded.deferred.push({ id, claimToken, error });
    },
    now: () => NOW,
  };

  return { deps, recorded };
}

describe('isEventAllowed (criterion 7)', () => {
  it('defaults every event type to ON when the user has no stored row', () => {
    for (const type of ['invited', 'accepted', 'bar_suggested', 'plan_changed'] as const) {
      expect(isEventAllowed(null, type)).toBe(true);
      expect(isEventAllowed(undefined, type)).toBe(true);
    }
  });

  it('honours a single per-event opt-out without touching the others', () => {
    const preferences = { ...DEFAULT_PREFERENCES, bar_suggested: false };
    expect(isEventAllowed(preferences, 'bar_suggested')).toBe(false);
    expect(isEventAllowed(preferences, 'invited')).toBe(true);
    expect(isEventAllowed(preferences, 'accepted')).toBe(true);
    expect(isEventAllowed(preferences, 'plan_changed')).toBe(true);
  });
});

describe('isWithinRateLimit (criterion 7)', () => {
  it('allows sends below the window budget and blocks at it', () => {
    expect(isWithinRateLimit(RATE_LIMIT_PER_WINDOW - 1)).toBe(true);
    expect(isWithinRateLimit(RATE_LIMIT_PER_WINDOW)).toBe(false);
    expect(isWithinRateLimit(RATE_LIMIT_PER_WINDOW + 5)).toBe(false);
  });
});

describe('buildNotificationPayload', () => {
  it('produces distinct copy for each of the four event types, all deep-linked', () => {
    const bodies = new Set<string>();
    for (const type of ['invited', 'accepted', 'bar_suggested', 'plan_changed'] as const) {
      const payload = buildNotificationPayload(row({ event_type: type }), CONTEXT);
      expect(payload.eventType).toBe(type);
      expect(payload.nightOutToken).toBe(TOKEN);
      bodies.add(payload.body);
    }
    expect(bodies.size).toBe(4);
  });

  it('falls back to neutral copy when the actor has no name and the plan no title', () => {
    const payload = buildNotificationPayload(row(), {
      nightOutToken: TOKEN,
      nightOutTitle: null,
      actorName: null,
    });
    expect(payload.body).toContain('Someone');
    expect(payload.body).toContain('your Night Out');
  });

  it('carries the SHARE token, never the internal night_out id', () => {
    const source = row();
    const payload = buildNotificationPayload(source, CONTEXT);
    expect(payload.nightOutToken).not.toBe(source.night_out_id);
  });
});

describe('drainNotificationOutbox', () => {
  it('sends a pending row to every live device and marks it sent', async () => {
    const { deps, recorded } = harness({
      rows: [row()],
      devices: [
        { id: 'device-1', token: 'a'.repeat(64) },
        { id: 'device-2', token: 'b'.repeat(64) },
      ],
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary).toMatchObject({ processed: 1, sent: 1, suppressed: 0 });
    expect(recorded.sentTo).toHaveLength(2);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'sent', error: null },
    ]);
  });

  it('suppresses an opted-out event without contacting APNs at all (criterion 7)', async () => {
    const { deps, recorded } = harness({
      rows: [row({ event_type: 'bar_suggested' })],
      preferences: { ...DEFAULT_PREFERENCES, bar_suggested: false },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.suppressed).toBe(1);
    expect(recorded.sentTo).toEqual([]);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'suppressed', error: 'opted_out' },
    ]);
  });

  it('suppresses once the recipient is over the rate-limit budget (criterion 7)', async () => {
    const { deps, recorded } = harness({
      rows: [row()],
      recentSends: RATE_LIMIT_PER_WINDOW,
    });

    await drainNotificationOutbox(deps);

    expect(recorded.sentTo).toEqual([]);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'suppressed', error: 'rate_limited' },
    ]);
  });

  it('retires an invalid token and STILL delivers to the healthy device (criteria 4, 10)', async () => {
    // The multi-device case. A dead token on one phone must not cost the user
    // the notification on the phone they actually carry.
    const dead = 'a'.repeat(64);
    const alive = 'b'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row()],
      devices: [
        { id: 'device-dead', token: dead },
        { id: 'device-alive', token: alive },
      ],
      outcomes: {
        [dead]: { outcome: 'invalid-token', status: 410, reason: 'Unregistered' },
      },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(recorded.revoked).toEqual(['device-dead']);
    expect(summary.invalidTokensRevoked).toBe(1);
    expect(recorded.deliveries).toEqual([
      { outboxId: 1, deviceTokenId: 'device-dead', claimToken: CLAIM, status: 'invalid_token' },
      { outboxId: 1, deviceTokenId: 'device-alive', claimToken: CLAIM, status: 'sent' },
    ]);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'sent', error: null },
    ]);
  });

  it('leaves a retryable failure pending and counts the attempt', async () => {
    const token = 'a'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row({ attempts: 1 })],
      outcomes: { [token]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' } },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.failed).toBe(1);
    expect(recorded.deferred).toEqual([
      { id: 1, claimToken: CLAIM, error: 'ServiceUnavailable' },
    ]);
    // Deliberately NOT marked terminal — the next drain retries it.
    expect(recorded.outbox).toEqual([]);
  });

  it('stops retrying at MAX_ATTEMPTS instead of looping forever', async () => {
    const token = 'a'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row({ attempts: MAX_ATTEMPTS })],
      outcomes: { [token]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' } },
    });

    await drainNotificationOutbox(deps);

    expect(recorded.deferred).toEqual([]);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'failed', error: 'ServiceUnavailable' },
    ]);
  });

  it('fails a row terminally when APNs says retrying cannot help', async () => {
    const token = 'a'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row()],
      outcomes: {
        [token]: { outcome: 'failed', status: 403, reason: 'InvalidProviderToken' },
      },
    });

    await drainNotificationOutbox(deps);

    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'failed', error: 'InvalidProviderToken' },
    ]);
    expect(recorded.deferred).toEqual([]);
  });

  it('suppresses rather than fails when the recipient has no live device', async () => {
    // Not our failure, and retrying it every minute forever is the bug.
    const { deps, recorded } = harness({ rows: [row()], devices: [] });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.suppressed).toBe(1);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'suppressed', error: 'no_devices' },
    ]);
  });

  it('fails terminally when the plan vanished between enqueue and drain', async () => {
    const { deps, recorded } = harness({ rows: [row()], context: null });

    await drainNotificationOutbox(deps);

    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'failed', error: 'missing_context' },
    ]);
    expect(recorded.sentTo).toEqual([]);
  });

  it('keeps draining the rest of the batch after one row is suppressed', async () => {
    const { deps, recorded } = harness({
      rows: [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
      recentSends: 0,
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.processed).toBe(3);
    expect(recorded.outbox.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('records one delivery row per (event, device) — the idempotency unit (criterion 3)', async () => {
    // The unique (outbox_id, device_token_id) constraint in 0061 is what makes
    // a re-drained row a no-op at the device level; this asserts the sender
    // writes exactly the key that constraint indexes.
    const { deps, recorded } = harness({
      rows: [row()],
      devices: [
        { id: 'device-1', token: 'a'.repeat(64) },
        { id: 'device-2', token: 'b'.repeat(64) },
      ],
    });

    await drainNotificationOutbox(deps);

    const keys = recorded.deliveries.map((d) => `${d.outboxId}:${d.deviceTokenId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['1:device-1', '1:device-2']);
    // Both halves of the write carry the claim they belong to, so a superseded
    // drain can settle neither the row nor any of its deliveries.
    expect(recorded.reserveTokens).toEqual([CLAIM, CLAIM]);
    expect(recorded.deliveries.map((d) => d.claimToken)).toEqual([CLAIM, CLAIM]);
  });

  it('RESERVES each device before calling APNs (criterion 3)', async () => {
    // Order matters and is the whole fix: the reservation is committed first,
    // so a drain that dies after the send still leaves the device taken.
    const order: string[] = [];
    const { deps } = harness({ rows: [row()] });
    const reserve = deps.reserveDelivery;
    const send = deps.send;
    const instrumented: DrainDeps = {
      ...deps,
      reserveDelivery: async (outboxId, deviceTokenId, claimToken) => {
        order.push('reserve');
        return reserve(outboxId, deviceTokenId, claimToken);
      },
      send: async (token, payload) => {
        order.push('send');
        return send(token, payload);
      },
    };

    await drainNotificationOutbox(instrumented);

    expect(order).toEqual(['reserve', 'send']);
  });

  it('does NOT re-send to a device an earlier pass already reserved', async () => {
    // The crash-after-send case. The row comes back after its lease expires;
    // the reserved device must be skipped rather than buzzed twice.
    const { deps, recorded } = harness({
      rows: [row()],
      devices: [
        { id: 'device-1', token: 'a'.repeat(64) },
        { id: 'device-2', token: 'b'.repeat(64) },
      ],
      alreadyReserved: ['1:device-1'],
    });

    await drainNotificationOutbox(deps);

    expect(recorded.sentTo).toEqual(['b'.repeat(64)]);
  });

  it('does not send at all when every device was already reserved', async () => {
    const { deps, recorded } = harness({
      rows: [row()],
      alreadyReserved: ['1:device-1'],
    });

    const summary = await drainNotificationOutbox(deps);

    expect(recorded.sentTo).toEqual([]);
    expect(summary.suppressed).toBe(1);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'suppressed', error: 'already_attempted' },
    ]);
  });

  it('RETRIES rather than terminalizing when one device sent and another can retry', async () => {
    // The two-phone case. Marking the row 'sent' because ONE device took it
    // stranded the other phone forever; the reservation fence means deferring
    // costs nothing, because the next drain skips the phone that already has
    // it and retries only the one that does not.
    const delivered = 'a'.repeat(64);
    const flaky = 'b'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row()],
      devices: [
        { id: 'device-delivered', token: delivered },
        { id: 'device-flaky', token: flaky },
      ],
      outcomes: {
        [flaky]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' },
      },
    });

    await drainNotificationOutbox(deps);

    expect(recorded.outbox).toEqual([]);
    expect(recorded.deferred).toEqual([
      { id: 1, claimToken: CLAIM, error: 'ServiceUnavailable' },
    ]);
  });

  it('marks the row sent once the retry budget is gone, even with a dead device', async () => {
    const delivered = 'a'.repeat(64);
    const flaky = 'b'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row({ attempts: MAX_ATTEMPTS })],
      devices: [
        { id: 'device-delivered', token: delivered },
        { id: 'device-flaky', token: flaky },
      ],
      outcomes: {
        [flaky]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' },
      },
    });

    await drainNotificationOutbox(deps);

    expect(recorded.deferred).toEqual([]);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'sent', error: null },
    ]);
  });

  it('retires a row whose claims have out-lived the attempt budget', async () => {
    // A drain that dies mid-row still spends the attempt at claim time, so a
    // row that kills every worker eventually stops being handed out.
    const { deps, recorded } = harness({ rows: [row({ attempts: MAX_ATTEMPTS + 1 })] });

    const summary = await drainNotificationOutbox(deps);

    expect(recorded.sentTo).toEqual([]);
    expect(summary.failed).toBe(1);
    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: CLAIM, status: 'failed', error: 'max_attempts' },
    ]);
  });

  it('fences every write on the claim token it was handed', async () => {
    const { deps, recorded } = harness({
      rows: [row({ claim_token: 'claim-token-2' })],
    });

    await drainNotificationOutbox(deps);

    expect(recorded.outbox).toEqual([
      { id: 1, claimToken: 'claim-token-2', status: 'sent', error: null },
    ]);
  });

  it('defers rather than deciding when a WRITE fails, and keeps the batch going', async () => {
    // A failed status write is not a decision. The row stays pending and the
    // next row in the batch is still processed.
    const { deps, recorded } = harness({
      rows: [row({ id: 1 }), row({ id: 2 })],
      failing: { markOutbox: true },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.processed).toBe(2);
    expect(summary.deferred).toBe(2);
    expect(summary.sent).toBe(0);
    expect(recorded.outbox).toEqual([]);
  });
});
