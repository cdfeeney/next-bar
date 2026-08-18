import type {
  ApnsOutcome,
  ApnsPayload,
  NotificationEventType,
} from './apnsSender';

/**
 * V8-4 — draining the server-owned outbox. SERVER ONLY.
 *
 * The outbox itself (0061) decides WHAT happened and to WHOM; this module
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
 * The DECISION is not made here. Counting in the sender and then deciding is a
 * check-then-act, and three review rounds found three different ways for it to
 * be wrong; the window and the budget below are passed to
 * admit_notification_send, which counts and stamps while holding a
 * per-recipient advisory lock for its transaction. These constants are the
 * policy, in one place.
 *
 * ponytail: a fixed rolling window per recipient. Per-event-type budgets or a
 * token bucket are only worth it if this proves too blunt in real use.
 */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT_PER_WINDOW = 8;

export type OutboxRow = {
  readonly id: number;
  readonly event_type: NotificationEventType;
  readonly night_out_id: string;
  readonly recipient_user_id: string;
  readonly actor_id: string | null;
  readonly bar_id: string | null;
  /**
   * Drains already spent on this row, INCLUDING the one handing it to us: the
   * claim charges the attempt, so a drain that dies mid-row still burns one.
   * Bounded by MAX_ATTEMPTS below.
   */
  readonly attempts: number;
  /**
   * Proof this drain owns the row. Minted fresh by every claim; every write
   * back to the row is conditioned on it, so a drain whose lease expired
   * cannot overwrite the claim that replaced it.
   */
  readonly claim_token: string;
};

/**
 * A retryable APNs answer leaves the row pending so the next drain picks it up
 * — but "retry forever" is how an outbox turns into an infinite send loop
 * against a permanently sick token. After this many CLAIMS the row is failed
 * with its last APNs reason recorded, and a human can read why.
 *
 * Counted at claim time rather than on a graceful defer, because the row that
 * most needs a ceiling is the one that kills its drain before any defer can
 * run: that row used to be re-claimed forever with attempts still at zero.
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

/**
 * What happened when this drain tried to take a (row, device) pair.
 *
 * `already-sent` is not merely "skip": a row deferred for one flaky phone
 * comes back with the other phone's delivery already recorded, and a pass that
 * forgot it marked the whole row `failed` even though someone got the
 * notification.
 */
export type ReserveOutcome = 'reserved' | 'already-sent' | 'settled';

export type DrainDeps = {
  fetchPending(limit: number): Promise<readonly OutboxRow[]>;
  fetchPreferences(userId: string): Promise<NotificationPreferences | null>;
  fetchContext(row: OutboxRow): Promise<NotificationContext | null>;
  fetchLiveTokens(userId: string): Promise<readonly DeviceToken[]>;
  /**
   * Decide whether this row may be sent, and record the decision. Three
   * answers collapse into the boolean:
   *   - it had already been admitted on an earlier pass, so it keeps that slot
   *     and is re-admitted without being counted again;
   *   - it fits inside the recipient's window, so a slot is spent now;
   *   - it does not fit, or this drain no longer owns the row, so it is
   *     refused.
   * Counting and stamping happen under a per-recipient advisory lock held for
   * the transaction, which is what stops two drains holding different rows for
   * the same person from both being admitted on the same total.
   */
  admitSend(outboxId: number, claimToken: string): Promise<boolean>;
  send(
    deviceToken: string,
    payload: ApnsPayload,
  ): Promise<{ outcome: ApnsOutcome; status: number; reason: string | null }>;
  /**
   * Take this (row, device) pair BEFORE calling APNs. Only `'reserved'` may be
   * sent to. The other two both mean "skip the send" but are NOT
   * interchangeable: `'already-sent'` is a delivery of this event that a later
   * pass must still count, and treating it as `'settled'` is what once marked
   * partially-delivered rows terminally failed.
   */
  reserveDelivery(
    outboxId: number,
    deviceTokenId: string,
    claimToken: string,
  ): Promise<ReserveOutcome>;
  /**
   * Settle a reservation THIS drain made. Fenced on the same claim token, so a
   * drain whose lease expired cannot overwrite a delivery a later one settled.
   */
  recordDelivery(input: {
    outboxId: number;
    deviceTokenId: string;
    claimToken: string;
    status: DeliveryStatus;
    apnsStatus: number | null;
    apnsReason: string | null;
  }): Promise<void>;
  /**
   * Retire the token APNs rejected. The VALUE matters, not just the row: an
   * installation that re-registers rotates the token in place, so revoking by
   * id alone could retire a fresh, working token because an older send for the
   * previous one came back rejected.
   */
  revokeToken(deviceTokenId: string, token: string): Promise<void>;
  markOutbox(
    outboxId: number,
    claimToken: string,
    status: OutboxStatus,
    lastError: string | null,
  ): Promise<void>;
  /** Release the claim so the next drain retries. The attempt is already spent. */
  deferOutbox(
    outboxId: number,
    claimToken: string,
    lastError: string | null,
  ): Promise<void>;
};

export type DrainSummary = {
  processed: number;
  sent: number;
  suppressed: number;
  failed: number;
  /**
   * Left pending because something we needed could not be READ or WRITTEN — a
   * preference, a recent-send count, a status update. Distinct from
   * `suppressed` (a decision was made) and from `failed` (terminal). A
   * deferred row is retried next drain, which is the only safe answer when
   * consent — or whether our own write landed — is unknown.
   */
  deferred: number;
  invalidTokensRevoked: number;
  /**
   * Tokens APNs rejected that we could not retire. Reported rather than
   * swallowed, and rather than failing the row: the delivery is already
   * recorded, so deferring would only re-run a send to a device we know is
   * dead. The token is retired the next time an event reaches it.
   */
  revocationFailures: number;
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
    revocationFailures: 0,
  };

  const pending = await deps.fetchPending(batchSize);

  for (const row of pending) {
    summary.processed += 1;
    // An UNEXPECTED throw below is a write we could not confirm. It must not
    // abandon the rest of the batch, and it must not be read as a decision:
    // the row keeps its pending status and the next drain sees it again.
    try {
      await processOutboxRow(deps, row, summary);
    } catch {
      summary.deferred += 1;
    }
  }

  return summary;
}

async function processOutboxRow(
  deps: DrainDeps,
  row: OutboxRow,
  summary: DrainSummary,
): Promise<void> {
  // Belt and braces. claim_notification_outbox already refuses to hand out a
  // row at or past the budget and retires it in the same statement, which is
  // where the ceiling has to live: a worker killed before this line could run
  // was exactly how an exhausted row kept coming back. This stays as a guard
  // for a database that has not had the migration applied yet.
  if (row.attempts > MAX_ATTEMPTS) {
    await deps.markOutbox(row.id, row.claim_token, 'failed', 'max_attempts');
    summary.failed += 1;
    return;
  }

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
    return;
  }
  if (!isEventAllowed(preferences, row.event_type)) {
    await deps.markOutbox(row.id, row.claim_token, 'suppressed', 'opted_out');
    summary.suppressed += 1;
    return;
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
    return;
  }
  if (!context) {
    // The plan was deleted between enqueue and drain. There is nothing to
    // deep-link to, so this is terminal rather than retryable.
    await deps.markOutbox(row.id, row.claim_token, 'failed', 'missing_context');
    summary.failed += 1;
    return;
  }

  let devices: Awaited<ReturnType<DrainDeps['fetchLiveTokens']>>;
  try {
    devices = await deps.fetchLiveTokens(row.recipient_user_id);
  } catch {
    summary.deferred += 1;
    return;
  }
  if (devices.length === 0) {
    // Not a failure of ours: the user has no registered device, or revoked
    // the only one. Recorded as suppressed so it is never retried forever.
    await deps.markOutbox(row.id, row.claim_token, 'suppressed', 'no_devices');
    summary.suppressed += 1;
    return;
  }

  // RATE LIMIT, checked here rather than earlier on purpose: budget is only
  // spent on a row that is actually about to be sent, so an opted-out or
  // device-less row never costs the recipient a slot. Admission is atomic and
  // fail-closed — an unknown answer leaves the row pending, exactly like an
  // unknown preference.
  let admitted: boolean;
  try {
    admitted = await deps.admitSend(row.id, row.claim_token);
  } catch {
    summary.deferred += 1;
    return;
  }
  if (!admitted) {
    await deps.markOutbox(row.id, row.claim_token, 'suppressed', 'rate_limited');
    summary.suppressed += 1;
    return;
  }

  const payload = buildNotificationPayload(row, context);
  let anySent = false;
  let anyRetryable = false;
  let attemptedAny = false;
  let lastReason: string | null = null;

  for (const device of devices) {
    // RESERVE, then send. The reservation is committed before Apple is
    // contacted, so a device an earlier pass already reached is skipped
    // rather than buzzed a second time.
    const reservation = await deps.reserveDelivery(
      row.id,
      device.id,
      row.claim_token,
    );
    if (reservation !== 'reserved') {
      // A device an earlier pass already DELIVERED to still counts as a
      // delivery of this event; forgetting that is how a partially-delivered
      // row ended up terminally `failed`.
      if (reservation === 'already-sent') anySent = true;
      continue;
    }
    attemptedAny = true;
    const result = await deps.send(device.token, payload);
    lastReason = result.reason;

    if (result.outcome === 'sent') {
      anySent = true;
      await deps.recordDelivery({
        outboxId: row.id,
        deviceTokenId: device.id,
        claimToken: row.claim_token,
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
      //
      // SETTLE THE DELIVERY FIRST. Revoking first and then failing to record
      // left the reservation `pending` while the device dropped out of the
      // live-token list, so nothing could ever retake it and the audit row
      // stayed stuck. Recording first means a failed revoke merely defers: the
      // next drain finds the delivery already settled and moves on, and the
      // still-live token is retired the next time APNs rejects it.
      await deps.recordDelivery({
        outboxId: row.id,
        deviceTokenId: device.id,
        claimToken: row.claim_token,
        status: 'invalid_token',
        apnsStatus: result.status,
        apnsReason: result.reason,
      });
      try {
        await deps.revokeToken(device.id, device.token);
        summary.invalidTokensRevoked += 1;
      } catch {
        // NOT fatal to the row. The delivery is already settled above, so
        // deferring here would spend another pass on a device we know is dead
        // and would never reach the revocation again anyway. Counted so the
        // caller can see it; the token is retired the next time an event
        // reaches it and APNs rejects it again.
        summary.revocationFailures += 1;
      }
      continue;
    }

    if (result.outcome === 'retry') anyRetryable = true;
    await deps.recordDelivery({
      outboxId: row.id,
      deviceTokenId: device.id,
      claimToken: row.claim_token,
      status: 'failed',
      apnsStatus: result.status,
      apnsReason: result.reason,
    });
  }

  // A RETRYABLE DEVICE OUTRANKS A DELIVERED ONE. `anySent` used to be tested
  // first, so a two-phone user whose second phone got a 503 had the row marked
  // terminally 'sent' and that phone was never tried again. Deferring costs
  // nothing now that reserveDelivery refuses to retake a settled device: the
  // next drain skips the phone that already has it and retries only the one
  // that does not.
  if (anyRetryable && row.attempts < MAX_ATTEMPTS) {
    // Left pending on purpose so the next drain retries it. Counted as a
    // failure of THIS pass so the caller's numbers stay honest; which devices
    // actually got it lives in notification_deliveries, not in this status.
    await deps.deferOutbox(row.id, row.claim_token, lastReason);
    summary.failed += 1;
  } else if (anySent) {
    await deps.markOutbox(row.id, row.claim_token, 'sent', null);
    summary.sent += 1;
  } else if (!attemptedAny) {
    // Every device is SETTLED — delivered, or its token retired — so this row
    // has nothing left to do. Nothing was decided HERE and nothing failed
    // here: `suppressed` is the existing vocabulary for "we chose not to
    // send". The budget was already spent when this row was admitted, and a
    // status never changes that.
    await deps.markOutbox(
      row.id,
      row.claim_token,
      'suppressed',
      'already_attempted',
    );
    summary.suppressed += 1;
  } else {
    await deps.markOutbox(
      row.id,
      row.claim_token,
      'failed',
      lastReason ?? 'no_delivery',
    );
    summary.failed += 1;
  }
}
