import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_PREFERENCES,
  MAX_ATTEMPTS,
  type DrainDeps,
  type NotificationPreferences,
  type OutboxRow,
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

    async countRecentSends(userId, sinceIso) {
      const { count, error } = await admin
        .from('notification_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', userId)
        // Measured on when it was PROCESSED, not when it was enqueued.
        // created_at is enqueue time, so a backlog that drains all at once
        // counted as "old" and sailed straight past the limit (cold panel,
        // both lanes). processed_at is set by markOutbox at send time.
        .eq('status', 'sent')
        .gte('processed_at', sinceIso);
      if (error) unavailable('recent-send count', error);
      // A null count with no error means the head request returned nothing to
      // count, which is genuinely zero.
      return count ?? 0;
    },

    send,

    async reserveDelivery(outboxId, deviceTokenId) {
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
      });
      if (!error) return true;
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
      const { data, error: retakeError } = await admin
        .from('notification_deliveries')
        .update({ status: 'pending', apns_status: null, apns_reason: null })
        .eq('outbox_id', outboxId)
        .eq('device_token_id', deviceTokenId)
        .in('status', ['pending', 'failed'])
        .select('id');
      if (retakeError) unavailable('delivery reservation', retakeError);
      return (data ?? []).length > 0;
    },

    async recordDelivery(input) {
      const { error } = await admin
        .from('notification_deliveries')
        .update({
          status: input.status,
          apns_status: input.apnsStatus,
          apns_reason: input.apnsReason,
        })
        .eq('outbox_id', input.outboxId)
        .eq('device_token_id', input.deviceTokenId);
      if (error) unavailable('delivery record', error);
    },

    async revokeToken(deviceTokenId) {
      const { error } = await admin
        .from('native_device_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', deviceTokenId);
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

    now: () => Date.now(),
  };
}
