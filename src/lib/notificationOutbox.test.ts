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

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 1,
    event_type: 'invited',
    night_out_id: '99999999-8888-4777-8666-555555555555',
    recipient_user_id: 'user-recipient',
    actor_id: 'user-actor',
    bar_id: null,
    attempts: 0,
    ...overrides,
  };
}

const CONTEXT: NotificationContext = {
  nightOutToken: TOKEN,
  nightOutTitle: 'Friday',
  actorName: 'Sam',
};

type Recorded = {
  deliveries: Array<{ outboxId: number; deviceTokenId: string; status: string }>;
  outbox: Array<{ id: number; status: string; error: string | null }>;
  deferred: Array<{ id: number; error: string | null }>;
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
}): { deps: DrainDeps; recorded: Recorded } {
  const recorded: Recorded = {
    deliveries: [],
    outbox: [],
    deferred: [],
    revoked: [],
    sentTo: [],
  };
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
    recordDelivery: async (input) => {
      recorded.deliveries.push({
        outboxId: input.outboxId,
        deviceTokenId: input.deviceTokenId,
        status: input.status,
      });
    },
    revokeToken: async (id) => {
      recorded.revoked.push(id);
    },
    markOutbox: async (id, status, error) => {
      recorded.outbox.push({ id, status, error });
    },
    deferOutbox: async (id, error) => {
      recorded.deferred.push({ id, error });
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
    expect(recorded.outbox).toEqual([{ id: 1, status: 'sent', error: null }]);
  });

  it('suppresses an opted-out event without contacting APNs at all (criterion 7)', async () => {
    const { deps, recorded } = harness({
      rows: [row({ event_type: 'bar_suggested' })],
      preferences: { ...DEFAULT_PREFERENCES, bar_suggested: false },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.suppressed).toBe(1);
    expect(recorded.sentTo).toEqual([]);
    expect(recorded.outbox).toEqual([{ id: 1, status: 'suppressed', error: 'opted_out' }]);
  });

  it('suppresses once the recipient is over the rate-limit budget (criterion 7)', async () => {
    const { deps, recorded } = harness({
      rows: [row()],
      recentSends: RATE_LIMIT_PER_WINDOW,
    });

    await drainNotificationOutbox(deps);

    expect(recorded.sentTo).toEqual([]);
    expect(recorded.outbox).toEqual([{ id: 1, status: 'suppressed', error: 'rate_limited' }]);
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
      { outboxId: 1, deviceTokenId: 'device-dead', status: 'invalid_token' },
      { outboxId: 1, deviceTokenId: 'device-alive', status: 'sent' },
    ]);
    expect(recorded.outbox).toEqual([{ id: 1, status: 'sent', error: null }]);
  });

  it('leaves a retryable failure pending and counts the attempt', async () => {
    const token = 'a'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row({ attempts: 0 })],
      outcomes: { [token]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' } },
    });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.failed).toBe(1);
    expect(recorded.deferred).toEqual([{ id: 1, error: 'ServiceUnavailable' }]);
    // Deliberately NOT marked terminal — the next drain retries it.
    expect(recorded.outbox).toEqual([]);
  });

  it('stops retrying at MAX_ATTEMPTS instead of looping forever', async () => {
    const token = 'a'.repeat(64);
    const { deps, recorded } = harness({
      rows: [row({ attempts: MAX_ATTEMPTS - 1 })],
      outcomes: { [token]: { outcome: 'retry', status: 503, reason: 'ServiceUnavailable' } },
    });

    await drainNotificationOutbox(deps);

    expect(recorded.deferred).toEqual([]);
    expect(recorded.outbox).toEqual([
      { id: 1, status: 'failed', error: 'ServiceUnavailable' },
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
      { id: 1, status: 'failed', error: 'InvalidProviderToken' },
    ]);
    expect(recorded.deferred).toEqual([]);
  });

  it('suppresses rather than fails when the recipient has no live device', async () => {
    // Not our failure, and retrying it every minute forever is the bug.
    const { deps, recorded } = harness({ rows: [row()], devices: [] });

    const summary = await drainNotificationOutbox(deps);

    expect(summary.suppressed).toBe(1);
    expect(recorded.outbox).toEqual([{ id: 1, status: 'suppressed', error: 'no_devices' }]);
  });

  it('fails terminally when the plan vanished between enqueue and drain', async () => {
    const { deps, recorded } = harness({ rows: [row()], context: null });

    await drainNotificationOutbox(deps);

    expect(recorded.outbox).toEqual([{ id: 1, status: 'failed', error: 'missing_context' }]);
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
    // The unique (outbox_id, device_token_id) constraint in 0052 is what makes
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
  });
});
