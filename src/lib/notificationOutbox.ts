import type {
  ApnsOutcome,
  ApnsPayload,
  NotificationEventType,
} from './apnsSender';

/**
 * V8-4 — draining the server-owned outbox. SERVER ONLY.
 *
 * The outbox itself (0052) decides WHAT happened and to WHOM; this module
 * decides whether it may be delivered and to which devices, then records the
 * result. Everything it needs from the database arrives through `DrainDeps`,
 * so the delivery rules below are unit-testable against mocked APNs responses
 * with no database and no socket — which is the only way they can be tested at
 * all while the migrations are unapplied and the APNs key is an attended
 * credential that does not exist yet.
 *
 * Why opt-outs and rate limiting live HERE and not in the enqueue trigger:
 * enqueuing is cheap and the outbox is the audit record of what actually
 * happened. Suppressing at send time means a preference change is honoured for
 * events already queued, and it means "we chose not to send this" is a
 * recorded state (`suppressed`) rather than an absence.
 */

export type NotificationPreferences = Readonly<
  Record<NotificationEventType, boolean>
>;

/** No stored row means the user has never changed anything: everything is on. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  invited: true,
  accepted: true,
  bar_suggested: true,
  plan_changed: true,
};

export function isEventAllowed(
  preferences: NotificationPreferences | null | undefined,
  eventType: NotificationEventType,
): boolean {
  return (preferences ?? DEFAULT_PREFERENCES)[eventType] !== false;
}

/**
 * Basic per-recipient rate limiting (criterion 7). A Night Out with a dozen
 * people suggesting bars can otherwise fan out into a phone buzzing thirty
 * times in a minute, which is the fastest way to get every notification
 * disabled at the OS level.
 *
 * ponytail: a fixed rolling window per recipient, counted from the deliveries
 * already recorded. Per-event-type budgets or a token bucket are only worth it
 * if this proves too blunt in real use.
 */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT_PER_WINDOW = 8;

export function isWithinRateLimit(
  recentSendCount: number,
  limit: number = RATE_LIMIT_PER_WINDOW,
): boolean {
  return recentSendCount < limit;
}

export type OutboxRow = {
  readonly id: number;
  readonly event_type: NotificationEventType;
  readonly night_out_id: string;
  readonly recipient_user_id: string;
  readonly actor_id: string | null;
  readonly bar_id: string | null;
  /** Drains already spent on this row. Bounded by MAX_ATTEMPTS below. */
  readonly attempts: number;
};

/**
 * A retryable APNs answer leaves the row pending so the next drain picks it up
 * — but "retry forever" is how an outbox turns into an infinite send loop
 * against a permanently sick token. After this many passes the row is failed
 * with its last APNs reason recorded, and a human can read why.
 */
export const MAX_ATTEMPTS = 5;

export type DeviceToken = {
  readonly id: string;
  readonly token: string;
};

export type NotificationContext = {
  /** The share token the tap deep-links to — never the internal night_out id. */
  readonly nightOutToken: string;
  readonly nightOutTitle: string | null;
  readonly actorName: string | null;
};

export function buildNotificationPayload(
  row: OutboxRow,
  context: NotificationContext,
): ApnsPayload {
  const who = context.actorName?.trim() || 'Someone';
  const plan = context.nightOutTitle?.trim()
    ? `"${context.nightOutTitle.trim()}"`
    : 'your Night Out';

  const copy: Record<NotificationEventType, { title: string; body: string }> = {
    invited: {
      title: "You're invited",
      body: `${who} invited you to ${plan}.`,
    },
    accepted: {
      title: 'Invitation accepted',
      body: `${who} is in for ${plan}.`,
    },
    bar_suggested: {
      title: 'New bar suggested',
      body: `${who} suggested a bar for ${plan}.`,
    },
    plan_changed: {
      title: 'Plan updated',
      body: `${plan} has changed.`,
    },
  };

  return {
    ...copy[row.event_type],
    nightOutToken: context.nightOutToken,
    eventType: row.event_type,
  };
}

export type DeliveryStatus = 'sent' | 'failed' | 'invalid_token';
export type OutboxStatus = 'sent' | 'failed' | 'suppressed';

export type DrainDeps = {
  fetchPending(limit: number): Promise<readonly OutboxRow[]>;
  fetchPreferences(userId: string): Promise<NotificationPreferences | null>;
  fetchContext(row: OutboxRow): Promise<NotificationContext | null>;
  fetchLiveTokens(userId: string): Promise<readonly DeviceToken[]>;
  countRecentSends(userId: string, sinceIso: string): Promise<number>;
  send(
    deviceToken: string,
    payload: ApnsPayload,
  ): Promise<{ outcome: ApnsOutcome; status: number; reason: string | null }>;
  recordDelivery(input: {
    outboxId: number;
    deviceTokenId: string;
    status: DeliveryStatus;
    apnsStatus: number | null;
    apnsReason: string | null;
  }): Promise<void>;
  revokeToken(deviceTokenId: string): Promise<void>;
  markOutbox(
    outboxId: number,
    status: OutboxStatus,
    lastError: string | null,
  ): Promise<void>;
  /** Leave the row pending for the next drain, but count the attempt. */
  deferOutbox(outboxId: number, lastError: string | null): Promise<void>;
  now(): number;
};

export type DrainSummary = {
  processed: number;
  sent: number;
  suppressed: number;
  failed: number;
  /**
   * Left pending because something we needed could not be READ — a preference
   * or a recent-send count. Distinct from `suppressed` (a decision was made)
   * and from `failed` (terminal). A deferred row is retried next drain, which
   * is the only safe answer when consent is unknown.
   */
  deferred: number;
  invalidTokensRevoked: number;
};

const DEFAULT_BATCH = 100;

export async function drainNotificationOutbox(
  deps: DrainDeps,
  batchSize: number = DEFAULT_BATCH,
): Promise<DrainSummary> {
  const summary: DrainSummary = {
    processed: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
    deferred: 0,
    invalidTokensRevoked: 0,
  };

  const pending = await deps.fetchPending(batchSize);

  for (const row of pending) {
    summary.processed += 1;

    // CONSENT IS FAIL-CLOSED. The adapter previously swallowed query errors and
    // returned null here, which isEventAllowed treats as DEFAULT_PREFERENCES —
    // and every default is `true`. A database blip therefore NOTIFIED people
    // who had opted out (cold panel, both lanes). An unknown preference is not
    // permission: leave the row pending and try again next drain.
    let preferences: NotificationPreferences | null;
    try {
      preferences = await deps.fetchPreferences(row.recipient_user_id);
    } catch {
      summary.deferred += 1;
      continue;
    }
    if (!isEventAllowed(preferences, row.event_type)) {
      await deps.markOutbox(row.id, 'suppressed', 'opted_out');
      summary.suppressed += 1;
      continue;
    }

    // Same reasoning for the rate limit: a failed count used to read as zero,
    // which is "no recent sends" — the most permissive answer available.
    const sinceIso = new Date(deps.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    let recent: number;
    try {
      recent = await deps.countRecentSends(row.recipient_user_id, sinceIso);
    } catch {
      summary.deferred += 1;
      continue;
    }
    if (!isWithinRateLimit(recent)) {
      await deps.markOutbox(row.id, 'suppressed', 'rate_limited');
      summary.suppressed += 1;
      continue;
    }

    // fetchContext and fetchLiveTokens now surface read errors rather than
    // swallowing them, so an unreadable answer must defer rather than be
    // mistaken for "no plan" (terminal) or "no devices" (suppressed) — both of
    // which would retire a notification that was perfectly deliverable.
    let context: NotificationContext | null;
    try {
      context = await deps.fetchContext(row);
    } catch {
      summary.deferred += 1;
      continue;
    }
    if (!context) {
      // The plan was deleted between enqueue and drain. There is nothing to
      // deep-link to, so this is terminal rather than retryable.
      await deps.markOutbox(row.id, 'failed', 'missing_context');
      summary.failed += 1;
      continue;
    }

    let devices: Awaited<ReturnType<DrainDeps['fetchLiveTokens']>>;
    try {
      devices = await deps.fetchLiveTokens(row.recipient_user_id);
    } catch {
      summary.deferred += 1;
      continue;
    }
    if (devices.length === 0) {
      // Not a failure of ours: the user has no registered device, or revoked
      // the only one. Recorded as suppressed so it is never retried forever.
      await deps.markOutbox(row.id, 'suppressed', 'no_devices');
      summary.suppressed += 1;
      continue;
    }

    const payload = buildNotificationPayload(row, context);
    let anySent = false;
    let anyRetryable = false;
    let lastReason: string | null = null;

    for (const device of devices) {
      const result = await deps.send(device.token, payload);
      lastReason = result.reason;

      if (result.outcome === 'sent') {
        anySent = true;
        await deps.recordDelivery({
          outboxId: row.id,
          deviceTokenId: device.id,
          status: 'sent',
          apnsStatus: result.status,
          apnsReason: result.reason,
        });
        continue;
      }

      if (result.outcome === 'invalid-token') {
        // Criterion 4: an invalid token is retired, not retried. Revoking
        // rather than deleting keeps the audit trail and lets a later
        // re-registration on the same installation simply un-revoke.
        await deps.revokeToken(device.id);
        summary.invalidTokensRevoked += 1;
        await deps.recordDelivery({
          outboxId: row.id,
          deviceTokenId: device.id,
          status: 'invalid_token',
          apnsStatus: result.status,
          apnsReason: result.reason,
        });
        continue;
      }

      if (result.outcome === 'retry') anyRetryable = true;
      await deps.recordDelivery({
        outboxId: row.id,
        deviceTokenId: device.id,
        status: 'failed',
        apnsStatus: result.status,
        apnsReason: result.reason,
      });
    }

    if (anySent) {
      await deps.markOutbox(row.id, 'sent', null);
      summary.sent += 1;
    } else if (anyRetryable && row.attempts + 1 < MAX_ATTEMPTS) {
      // Left pending on purpose so the next drain retries it. Still counted as
      // a failure of THIS pass so the caller's numbers are honest.
      await deps.deferOutbox(row.id, lastReason);
      summary.failed += 1;
    } else {
      await deps.markOutbox(row.id, 'failed', lastReason ?? 'no_delivery');
      summary.failed += 1;
    }
  }

  return summary;
}
