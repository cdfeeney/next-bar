import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_CONTENT_KEYS,
  readLocalAccountContent,
  writeAccountContentOwner,
  type AccountContentKey,
  type LocalAccountContent,
  type LocalAccountContentRead,
} from '@/lib/accountContent.local';
import {
  hydrateConfirmedAccountContent,
  readConfirmedAccountContentMeta,
  writeConfirmedAccountContentMeta,
} from '@/lib/accountContent.confirmed';
import { contentIdentity } from '@/lib/accountContent.digest';
import {
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
  type ServerContentErrorKind,
} from '@/lib/accountContent.server';
import {
  noteAccountContentKeyTooLarge,
  noteAccountContentServerResult,
} from '@/lib/accountContent.capability';
import {
  quarantineRawInvalidContent,
  readQuarantinedAccountContent,
  releaseQuarantinedEnvelope,
  updateQuarantinedEnvelope,
  type QuarantineEnvelope,
} from '@/lib/accountContent.quarantine';
import { runWithAccountContentReadBypass } from '@/lib/accountContent.readGuard';

/**
 * accountContentSync v2.1 — reconciliation with server-read-back
 * confirmation.
 *
 * The rule that shapes everything here: CONFIRMATION COMES ONLY FROM A
 * MATCHING SERVER READ-BACK. An errorless upsert is a hope, not a fact — the
 * LWW trigger may have silently rejected it. Only when the row read back
 * matches what was sent (digest AND clock) does the key earn confirmed
 * metadata; until then it stays dirty and the preservation machinery treats
 * it as the only copy.
 */

export type AccountContentSyncOutcome =
  | 'uploaded'
  | 'uploaded-unconfirmed'
  | 'hydrated'
  | 'in-sync'
  | 'nothing-to-sync'
  | 'local-invalid'
  | 'upload-failed'
  | 'fetch-failed'
  | 'too-large'
  | 'unavailable'
  | 'auth-rejected'
  | 'invalid-clock'
  | 'aborted';

export type AccountContentSyncReport = Record<
  AccountContentKey,
  AccountContentSyncOutcome
>;

export type AccountContentSyncDeps = {
  supabase: SupabaseClient;
  userId: string;
  stillCurrent: () => boolean;
  /** Wrapper lets React suppress the synchronous storage event during
   *  hydrate. MUST delegate to hydrateConfirmedAccountContent (or preserve
   *  its confirmed-first ordering). */
  hydrateLocal?: (key: AccountContentKey, value: LocalAccountContent) => boolean;
};

function errorOutcome(kind: ServerContentErrorKind): AccountContentSyncOutcome {
  switch (kind) {
    case 'unavailable':
      return 'unavailable';
    case 'auth-rejected':
      return 'auth-rejected';
    case 'too-large':
      return 'too-large';
    case 'invalid-clock':
      return 'invalid-clock';
    case 'failed':
      return 'fetch-failed';
  }
}

function compareUpdatedAt(a: LocalAccountContent, b: LocalAccountContent): number {
  return Date.parse(a.clientUpdatedAt) - Date.parse(b.clientUpdatedAt);
}

function sameValue(a: LocalAccountContent, b: LocalAccountContent): boolean {
  // Digest AND byte length — the same predicate classifyAccountContent uses.
  // Two verdict systems disagreeing on "same" (however unlikely a 64-bit
  // collision) would oscillate a key between clean and dirty forever.
  const idA = contentIdentity(a.data);
  const idB = contentIdentity(b.data);
  return idA.digest === idB.digest && idA.byteLength === idB.byteLength;
}

function emptyReport(outcome: AccountContentSyncOutcome): AccountContentSyncReport {
  return Object.fromEntries(
    ACCOUNT_CONTENT_KEYS.map((key) => [key, outcome]),
  ) as AccountContentSyncReport;
}

function readLocal(key: AccountContentKey): LocalAccountContentRead {
  // The engine runs only when the barrier is ready, but its own reads must
  // see real values even while a verdict is being recomputed mid-run.
  return runWithAccountContentReadBypass(() => readLocalAccountContent(key));
}

/** Record a read-back as this user's confirmation for a key. */
function confirmFromReadBack(
  userId: string,
  key: AccountContentKey,
  readBack: LocalAccountContent,
): void {
  const id = contentIdentity(readBack.data);
  writeConfirmedAccountContentMeta(key, {
    version: 2,
    userId,
    clock: readBack.clientUpdatedAt,
    digest: id.digest,
    byteLength: id.byteLength,
    confirmedAt: new Date().toISOString(),
  });
}

export async function syncAccountContent({
  supabase,
  userId,
  stillCurrent,
  hydrateLocal,
}: AccountContentSyncDeps): Promise<AccountContentSyncReport> {
  const server = await fetchServerAccountContent(supabase, userId);
  noteAccountContentServerResult(server.kind);
  if (server.kind !== 'ok') return emptyReport(errorOutcome(server.kind));
  if (!stillCurrent()) return emptyReport('aborted');

  // A successful owner-scoped fetch proves every cache domain now belongs to
  // this account, even if a subsequent upload fails. The conflict rule—not the
  // marker—drives retries.
  writeAccountContentOwner(userId);

  const report = emptyReport('nothing-to-sync');
  for (const key of ACCOUNT_CONTENT_KEYS) {
    if (!stillCurrent()) {
      report[key] = 'aborted';
      continue;
    }
    report[key] = await reconcileKey({
      supabase,
      userId,
      key,
      server: server.content.get(key) ?? 'absent',
      stillCurrent,
      hydrateLocal,
    });
  }
  return report;
}

/** Reconcile one domain after its local storage event. */
export async function syncAccountContentKey({
  supabase,
  userId,
  key,
  stillCurrent,
  hydrateLocal,
}: AccountContentSyncDeps & {
  key: AccountContentKey;
}): Promise<AccountContentSyncOutcome> {
  const server = await fetchServerAccountContentKey(supabase, userId, key);
  noteAccountContentServerResult(server.kind);
  if (server.kind !== 'ok') return errorOutcome(server.kind);
  if (!stillCurrent()) return 'aborted';
  writeAccountContentOwner(userId);
  return reconcileKey({
    supabase,
    userId,
    key,
    server: server.value,
    stillCurrent,
    hydrateLocal,
  });
}

async function reconcileKey({
  supabase,
  userId,
  key,
  server,
  stillCurrent,
  hydrateLocal,
}: {
  supabase: SupabaseClient;
  userId: string;
  key: AccountContentKey;
  server: LocalAccountContent | 'absent';
  stillCurrent: () => boolean;
  hydrateLocal?: (key: AccountContentKey, value: LocalAccountContent) => boolean;
}): Promise<AccountContentSyncOutcome> {
  const hydrate =
    hydrateLocal ??
    ((k: AccountContentKey, v: LocalAccountContent) =>
      hydrateConfirmedAccountContent(k, v, userId));

  const local = readLocal(key);
  if (local.status === 'invalid') {
    // Preserve the unparseable text verbatim FIRST; only a validated capture
    // clears the live key. It is never uploaded and never restored live.
    const captured = runWithAccountContentReadBypass(() =>
      quarantineRawInvalidContent(userId, key),
    );
    if (server === 'absent') return 'local-invalid';
    if (!captured) return 'local-invalid';
    return hydrate(key, server) ? 'hydrated' : 'local-invalid';
  }
  if (local.status === 'absent') {
    if (server === 'absent') return 'nothing-to-sync';
    return hydrate(key, server) ? 'hydrated' : 'fetch-failed';
  }
  if (server === 'absent') {
    return uploadAndConfirm({
      supabase,
      userId,
      key,
      local: local.value,
      stillCurrent,
      hydrate,
    });
  }

  const order = compareUpdatedAt(local.value, server);
  if (order > 0) {
    return uploadAndConfirm({
      supabase,
      userId,
      key,
      local: local.value,
      stillCurrent,
      hydrate,
    });
  }
  if (order === 0 && sameValue(local.value, server)) {
    // The fetched row IS a server read-back matching local — confirm it.
    confirmFromReadBack(userId, key, server);
    return 'in-sync';
  }

  // Server newer, or a losing tie with different content.
  return hydrate(key, server) ? 'hydrated' : 'fetch-failed';
}

async function uploadAndConfirm({
  supabase,
  userId,
  key,
  local,
  stillCurrent,
  hydrate,
}: {
  supabase: SupabaseClient;
  userId: string;
  key: AccountContentKey;
  local: LocalAccountContent;
  stillCurrent: () => boolean;
  hydrate: (key: AccountContentKey, value: LocalAccountContent) => boolean;
}): Promise<AccountContentSyncOutcome> {
  const upsert = await upsertServerAccountContent(supabase, userId, key, local);
  noteAccountContentServerResult(upsert.kind);
  // The 200KB budget refusal must be VISIBLE (locked spec) — per-key flag
  // the gate surfaces; cleared the moment an upload for this key succeeds.
  noteAccountContentKeyTooLarge(key, upsert.kind === 'too-large');
  if (upsert.kind !== 'ok') {
    return upsert.kind === 'failed' ? 'upload-failed' : errorOutcome(upsert.kind);
  }
  if (!stillCurrent()) return 'aborted';

  const readBack = await fetchServerAccountContentKey(supabase, userId, key);
  noteAccountContentServerResult(readBack.kind);
  if (!stillCurrent()) return 'aborted';
  if (readBack.kind !== 'ok' || readBack.value === 'absent') {
    // The upsert may or may not have landed — WITHOUT a read-back it is not
    // confirmation, and the key stays dirty for the retry ladder.
    return 'uploaded-unconfirmed';
  }

  const matches =
    sameValue(readBack.value, local) &&
    Date.parse(readBack.value.clientUpdatedAt) ===
      Date.parse(local.clientUpdatedAt);
  if (matches) {
    confirmFromReadBack(userId, key, readBack.value);
  }

  // Re-read local after the awaits. A user action may have produced a newer
  // value while this write was in flight; never overwrite it with the
  // captured pre-await snapshot or the read-back.
  const current = readLocal(key);
  if (current.status !== 'present') {
    return hydrate(key, readBack.value) ? 'hydrated' : 'uploaded-unconfirmed';
  }
  const order = compareUpdatedAt(current.value, readBack.value);
  if (order > 0) return matches ? 'uploaded' : 'uploaded-unconfirmed';
  if (order === 0) {
    if (sameValue(current.value, readBack.value)) {
      return matches ? 'uploaded' : 'in-sync';
    }
    // Same clock, DIFFERENT data: a local change slipped in without a clock
    // bump (only non-stamping writers can do that). Never overwrite it with
    // the captured read-back — leave it dirty for the next fetch-first
    // reconcile to order properly.
    return 'uploaded-unconfirmed';
  }
  // Read-back is newer than local (LWW rejected our write, or another device
  // landed first): the server value is authoritative — hydrate it.
  return hydrate(key, readBack.value) ? 'hydrated' : 'uploaded-unconfirmed';
}

export type QuarantineRestoreOutcome =
  | 'released-equal'
  | 'released-confirmed-stale'
  | 'restored-uploaded'
  | 'conflict-retained'
  | 'kept-pending'
  | 'skipped-conflict';

/**
 * Restore reconciliation: when a user signs in, envelopes quarantined under
 * their id meet the server under LWW. Run AFTER syncAccountContent so live
 * state already reflects the server.
 */
export async function reconcileQuarantinedAccountContent({
  supabase,
  userId,
  stillCurrent,
  hydrateLocal,
}: AccountContentSyncDeps): Promise<
  Partial<Record<AccountContentKey, QuarantineRestoreOutcome>>
> {
  const hydrate =
    hydrateLocal ??
    ((k: AccountContentKey, v: LocalAccountContent) =>
      hydrateConfirmedAccountContent(k, v, userId));
  const envelopes = readQuarantinedAccountContent(userId);
  const outcomes: Partial<Record<AccountContentKey, QuarantineRestoreOutcome>> =
    {};

  for (const key of ACCOUNT_CONTENT_KEYS) {
    const envelope = envelopes[key];
    if (!envelope) continue;
    if (!stillCurrent()) {
      outcomes[key] = 'kept-pending';
      continue;
    }
    if (envelope.status === 'conflict') {
      outcomes[key] = 'skipped-conflict';
      continue;
    }

    const server = await fetchServerAccountContentKey(supabase, userId, key);
    noteAccountContentServerResult(server.kind);
    if (!stillCurrent()) {
      outcomes[key] = 'kept-pending';
      continue;
    }
    if (server.kind !== 'ok') {
      outcomes[key] = 'kept-pending';
      continue;
    }

    const deviceValue: LocalAccountContent = {
      data: envelope.data,
      clientUpdatedAt: envelope.clientUpdatedAt,
    };

    if (
      server.value !== 'absent' &&
      contentIdentity(server.value.data).digest === envelope.digest
    ) {
      // Server provably holds this content — the envelope is redundant.
      releaseQuarantinedEnvelope(userId, key);
      outcomes[key] = 'released-equal';
      continue;
    }

    const envelopeWins =
      server.value === 'absent' ||
      Date.parse(deviceValue.clientUpdatedAt) >
        Date.parse(server.value.clientUpdatedAt);

    if (envelopeWins) {
      const outcome = await uploadAndConfirm({
        supabase,
        userId,
        key,
        local: deviceValue,
        stillCurrent,
        hydrate,
      });
      // Success = the CONFIRMED metadata now carries this envelope's digest
      // AND clock for this user — i.e. the confirmation is FRESH, from THIS
      // upload's read-back. A digest-only check would accept a stale
      // confirmation from long before (same content confirmed at an earlier
      // clock) and release the envelope even though this upload failed.
      const confirmedNow = readConfirmedAccountContentMeta(key);
      const freshlyConfirmed =
        confirmedNow?.userId === userId &&
        confirmedNow.digest === envelope.digest &&
        Date.parse(confirmedNow.clock) ===
          Date.parse(deviceValue.clientUpdatedAt);
      if (freshlyConfirmed) {
        // Only release once a live copy provably exists (hydrate true, or
        // the read-back already hydrated it). Envelope release must never
        // orphan the only copy behind a failed quota write. But NEVER
        // hydrate over a newer (or same-clock divergent) live edit that
        // landed while the upload was in flight — uploadAndConfirm refused
        // exactly that overwrite, and the envelope's bytes are already
        // proven on the server by the fresh read-back (santa: Codex, r2).
        const current = readLocal(key);
        const liveHoldsThisOrNewer =
          current.status === 'present' &&
          compareUpdatedAt(current.value, deviceValue) >= 0;
        const liveLanded =
          outcome === 'hydrated' ||
          liveHoldsThisOrNewer ||
          hydrate(key, deviceValue);
        if (liveLanded) {
          releaseQuarantinedEnvelope(userId, key);
          outcomes[key] = 'restored-uploaded';
        } else {
          outcomes[key] = 'kept-pending';
        }
      } else if (outcome === 'hydrated') {
        // A different server value won mid-flight: same losing rules below.
        if (envelope.confirmedAtCapture) {
          releaseQuarantinedEnvelope(userId, key);
          outcomes[key] = 'released-confirmed-stale';
        } else {
          updateQuarantinedEnvelope(userId, key, {
            ...envelope,
            status: 'conflict',
          });
          outcomes[key] = 'conflict-retained';
        }
      } else {
        outcomes[key] = 'kept-pending';
      }
      continue;
    }

    // Envelope loses LWW with different content.
    if (envelope.confirmedAtCapture) {
      // Server presence was PROVEN at capture; the server has simply moved
      // on. Releasing deletes nothing that was ever the only copy.
      releaseQuarantinedEnvelope(userId, key);
      outcomes[key] = 'released-confirmed-stale';
      continue;
    }
    // Unconfirmed device content lost LWW: retain it as an explicit conflict
    // until the user chooses. The server value is (or will be) live.
    updateQuarantinedEnvelope(userId, key, { ...envelope, status: 'conflict' });
    outcomes[key] = 'conflict-retained';
  }
  return outcomes;
}

export type ConflictChoice = 'use-device' | 'keep-account' | 'later';

export type ConflictResolutionOutcome =
  | 'used-device'
  | 'kept-account'
  | 'deferred'
  | 'failed';

/** Resolve a retained restore conflict per the user's explicit choice. */
export async function resolveAccountContentConflict({
  supabase,
  userId,
  key,
  choice,
  stillCurrent,
  hydrateLocal,
  now = () => new Date(),
}: AccountContentSyncDeps & {
  key: AccountContentKey;
  choice: ConflictChoice;
  now?: () => Date;
}): Promise<ConflictResolutionOutcome> {
  if (choice === 'later') return 'deferred';
  const envelope = readQuarantinedAccountContent(userId)[key] as
    | QuarantineEnvelope
    | undefined;
  if (!envelope) return 'failed';

  if (choice === 'keep-account') {
    // Explicit, named discard of the device copy in favor of the account's.
    releaseQuarantinedEnvelope(userId, key);
    return 'kept-account';
  }

  const hydrate =
    hydrateLocal ??
    ((k: AccountContentKey, v: LocalAccountContent) =>
      hydrateConfirmedAccountContent(k, v, userId));
  // use-device: restamp NOW so the device version wins LWW deliberately.
  const deviceValue: LocalAccountContent = {
    data: envelope.data,
    clientUpdatedAt: now().toISOString(),
  };
  const outcome = await uploadAndConfirm({
    supabase,
    userId,
    key,
    local: deviceValue,
    stillCurrent,
    hydrate,
  });
  const confirmedNow = readConfirmedAccountContentMeta(key);
  const freshlyConfirmed =
    confirmedNow?.userId === userId &&
    confirmedNow.digest === contentIdentity(deviceValue.data).digest &&
    Date.parse(confirmedNow.clock) === Date.parse(deviceValue.clientUpdatedAt);
  if (freshlyConfirmed) {
    // Same rule as the restore release: a newer live edit that landed
    // mid-flight is never clobbered by the resolved device copy — the
    // device copy is already proven on the server (santa: Codex, r2).
    const current = readLocal(key);
    const liveHoldsThisOrNewer =
      current.status === 'present' &&
      compareUpdatedAt(current.value, deviceValue) >= 0;
    const liveLanded =
      outcome === 'hydrated' ||
      liveHoldsThisOrNewer ||
      hydrate(key, deviceValue);
    if (liveLanded) {
      releaseQuarantinedEnvelope(userId, key);
      return 'used-device';
    }
  }
  return 'failed';
}

export const __testables = { compareUpdatedAt, sameValue };
