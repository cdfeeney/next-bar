import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_PREFERENCES,
  MAX_ATTEMPTS,
  RATE_LIMIT_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
  type DrainDeps,
  type NotificationPreferences,
  type OutboxRow,
  type ReserveOutcome,
} from './notificationOutbox';

/**
 * The database half of the drain (V8-4). SERVER ONLY.
 *
 * Extracted from the route handler for one reason: a Next.js `route.ts` may
 * only export the handler and its route config, so anything exported from
 * there for a test is a build error. These adapters carry the rules that
 * decide whether a failed WRITE is noticed, which is exactly the thing that
 * needs tests.
 *
 * ONE RULE RUNS THROUGH ALL OF THEM: a Supabase result carrying an `error` is
 * an ANSWER WE DID NOT GET, and every one of them throws.
 * `drainNotificationOutbox` turns a throw into "leave this row pending and try
 * again", which is the only safe reading. The previous version discarded every
 * mutation error, so an unwritten delivery reported success, an un-revoked
 * dead token reported revoked, and an outbox row that had actually been SENT
 * stayed `pending` for the next drain to send a second time.
 */

/** How long a claim holds a row before another drain may take it back. */
export const CLAIM_LEASE_SECONDS = 300;

type SupabaseError = { readonly code?: string | null } | null;

function unavailable(what: string, error: SupabaseError): never {
  // The code, never the message: PostgREST messages can echo row values, and
  // this text reaches a server log.
  throw new Error(`${what} unavailable: ${error?.code ?? 'unknown'}`);
}

/** Postgres unique_violation — the reservation lost a race, which is not an error. */
const UNIQUE_VIOLATION = '23505';

export function buildDrainDeps(
  admin: SupabaseClient,
  send: DrainDeps['send'],
): DrainDeps {
  return {
    async fetchPending(limit) {
      // CLAIM, do not select. A plain read let two overlapping drains take the
      // same pending rows and send the same notification twice (cold panel,
      // both lanes, HIGH). claim_notification_outbox marks the rows under
      // `for update skip locked` in one statement, so concurrent drains get
      // disjoint sets, a crashed drain's rows return after the lease, and the
      // claim itself charges an attempt so a crash loop is bounded.
      const { data, error } = await admin.rpc('claim_notification_outbox', {
        p_limit: limit,
        p_lease_seconds: CLAIM_LEASE_SECONDS,
        // The ceiling is enforced in SQL as well as here. A worker killed
        // between the claim committing and the loop reading `attempts` never
        // reaches the caller-side check, so the statement itself has to refuse
        // an exhausted row and retire it.
        p_max_attempts: MAX_ATTEMPTS,
      });
      if (error) unavailable('outbox', error);
      return (data ?? []) as OutboxRow[];
    },

    async fetchPreferences(userId) {
      const { data, error } = await admin
        .from('notification_preferences')
        .select('invited, accepted, bar_suggested, plan_changed')
        .eq('user_id', userId)
        .maybeSingle();
      // THROW rather than fall back. `?? DEFAULT_PREFERENCES` made a failed
      // read indistinguishable from "no row", and every default is true - so a
      // database error granted consent nobody gave. A missing ROW is a genuine
      // default; a missing ANSWER is not.
      if (error) unavailable('preferences', error);
      return (data as NotificationPreferences | null) ?? DEFAULT_PREFERENCES;
    },

    async fetchContext(row) {
      // Both reads below THROW on error, for the same reason the two above do.
      // A dropped night_outs error read as "the plan was deleted", which is
      // TERMINAL - one transient blip permanently retired a deliverable
      // notification. A dropped profiles error read as "no actor", which sent
      // the notification under the anonymous "Someone" fallback.
      const { data: plan, error: planError } = await admin
        .from('night_outs')
        .select('share_token, title')
        .eq('id', row.night_out_id)
        .maybeSingle();
      if (planError) unavailable('night out', planError);
      if (!plan?.share_token) return null;

      let actorName: string | null = null;
      if (row.actor_id) {
        const { data: actor, error: actorError } = await admin
          .from('profiles')
          .select('display_name, handle')
          .eq('id', row.actor_id)
          .maybeSingle();
        if (actorError) unavailable('actor profile', actorError);
        actorName = actor?.display_name ?? actor?.handle ?? null;
      }

      return {
        nightOutToken: plan.share_token as string,
        nightOutTitle: (plan.title as string | null) ?? null,
        actorName,
      };
    },

    async fetchLiveTokens(userId) {
      const { data, error } = await admin
        .from('native_device_tokens')
        .select('id, token')
        .eq('user_id', userId)
        .is('revoked_at', null);
      // An unreadable token list is not "no devices" - suppressing on it would
      // permanently mark a deliverable notification as undeliverable.
      if (error) unavailable('device tokens', error);
      return data ?? [];
    },

    async admitSend(outboxId, claimToken) {
      // THE LOCK is what makes this safe, not the round trip. Reading a count
      // here and deciding in JavaScript is a check-then-act, and every version
      // of it was wrong in a different way: it counted the wrong rows, it let
      // a row count against its own retry, and it let two drains holding
      // different rows for the same recipient both pass on the same total.
      // admit_notification_send is several statements, but it holds a
      // per-recipient advisory lock for its whole transaction, so the count it
      // sees is still the count it acts on. Do not remove that lock on the
      // theory that a single function call is already atomic.
      const { data, error } = await admin.rpc('admit_notification_send', {
        p_id: outboxId,
        p_claim_token: claimToken,
        p_window_seconds: Math.floor(RATE_LIMIT_WINDOW_MS / 1000),
        p_limit: RATE_LIMIT_PER_WINDOW,
      });
      if (error) unavailable('rate-limit admission', error);
      // Only an explicit true admits. An unreadable answer is not permission.
      return data === true;
    },

    send,

    async reserveDelivery(outboxId, deviceTokenId, claimToken) {
      // COMMITTED BEFORE APNs IS CALLED. The unique (outbox_id,
      // device_token_id) constraint used to be reached only on the way OUT,
      // after the push had already been handed to Apple - so a drain that died
      // between the send and the status write re-sent the whole row once the
      // lease expired, and the user got the same notification twice. Taking
      // the row first turns that constraint into a real send fence.
      const { error } = await admin.from('notification_deliveries').insert({
        outbox_id: outboxId,
        device_token_id: deviceTokenId,
        status: 'pending',
        claim_token: claimToken,
      });
      if (!error) return 'reserved';
      if (error.code !== UNIQUE_VIOLATION) unavailable('delivery reservation', error);

      // A row already exists. Whether we may take it back depends on what it
      // says:
      //   'sent' / 'invalid_token' - SETTLED. Re-sending would be a duplicate
      //                              of a delivery that demonstrably happened,
      //                              so these are never retaken.
      //   'failed'  - APNs told us it did not arrive. That is the retry the
      //               outbox's attempt budget exists for.
      //   'pending' - reserved by a pass that never came back. Only an EXPIRED
      //               outbox claim can put such a row in front of a second
      //               drain, because the claim fence gives one drain at a time
      //               the right to this row - so the reserving worker is gone,
      //               and it may or may not have reached Apple first.
      //
      // Retaking 'pending' is a deliberate choice between two bad outcomes.
      // Refusing it strands the reservation forever and the invitation is
      // silently never delivered; taking it can repeat a push, but only when a
      // sender stayed wedged for the whole lease, and every push carries a
      // collapse id so Apple folds a repeat for the same Night Out together.
      // A lost invitation is worse than a collapsed duplicate.
      // Taking it also takes OWNERSHIP: stamping our claim here is what makes
      // the superseded drain's own delivery write match nothing below.
      const { data, error: retakeError } = await admin
        .from('notification_deliveries')
        .update({
          status: 'pending',
          apns_status: null,
          apns_reason: null,
          claim_token: claimToken,
        })
        .eq('outbox_id', outboxId)
        .eq('device_token_id', deviceTokenId)
        .in('status', ['pending', 'failed'])
        .select('id');
      if (retakeError) unavailable('delivery reservation', retakeError);
      if ((data ?? []).length > 0) return 'reserved';

      // Settled, and WHICH settlement matters. A device already recorded
      // `sent` is a delivery of this event that a later pass must not forget:
      // a row deferred for one flaky phone comes back with the other phone
      // already served, and treating that as nothing marked the whole row
      // failed. Read only on this rare conflict path, never on the hot one.
      const { data: settled, error: settledError } = await admin
        .from('notification_deliveries')
        .select('status')
        .eq('outbox_id', outboxId)
        .eq('device_token_id', deviceTokenId)
        .maybeSingle();
      if (settledError) unavailable('delivery reservation', settledError);
      return ((settled as { status?: string } | null)?.status === 'sent'
        ? 'already-sent'
        : 'settled') as ReserveOutcome;
    },

    async recordDelivery(input) {
      // FENCED on the reservation this drain made. The claim fence protected
      // the outbox row's status but not the delivery row, so a sender that
      // stalled past its lease could come back and overwrite a delivery a
      // later drain had already settled — turning a `sent` row into a stale
      // `failed` and buying a retry nobody owed. A superseded write now
      // matches no row, which is the write being discarded, not an error.
      const { error } = await admin
        .from('notification_deliveries')
        .update({
          status: input.status,
          apns_status: input.apnsStatus,
          apns_reason: input.apnsReason,
        })
        .eq('outbox_id', input.outboxId)
        .eq('device_token_id', input.deviceTokenId)
        .eq('claim_token', input.claimToken);
      if (error) unavailable('delivery record', error);
    },

    async revokeToken(deviceTokenId, token) {
      // Matched on the VALUE as well as the row. save_native_device_token
      // rotates a token in place for the same installation, so revoking by id
      // alone could retire a fresh, working token because a send for the
      // PREVIOUS one came back rejected. Matching no row means the token has
      // already moved on and there is nothing of ours left to retire.
      const { error } = await admin
        .from('native_device_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', deviceTokenId)
        .eq('token', token);
      if (error) unavailable('token revocation', error);
    },

    async markOutbox(outboxId, claimToken, status, lastError) {
      // FENCED on the claim token. Without it a drain whose lease had expired
      // could still write a terminal status over the row a second drain was
      // actively working. Matching no row is not an error - it is precisely
      // the superseded write being discarded.
      const { error } = await admin
        .from('notification_outbox')
        .update({
          status,
          last_error: lastError,
          processed_at: new Date().toISOString(),
        })
        .eq('id', outboxId)
        .eq('claim_token', claimToken);
      if (error) unavailable('outbox status write', error);
    },

    async deferOutbox(outboxId, claimToken, lastError) {
      // Releases the claim rather than counting it: the attempt was already
      // charged by claim_notification_outbox, and clearing the lease lets the
      // next drain retry immediately instead of waiting it out. The read /
      // increment / write this replaced could also lose a concurrent update.
      const { error } = await admin
        .from('notification_outbox')
        .update({ last_error: lastError, claimed_at: null, claim_token: null })
        .eq('id', outboxId)
        .eq('claim_token', claimToken);
      if (error) unavailable('outbox defer', error);
    },

  };
}
