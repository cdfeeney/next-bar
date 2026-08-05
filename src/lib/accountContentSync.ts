import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_CONTENT_KEYS,
  readLocalAccountContent,
  sameAccountContentData,
  writeAccountContentOwner,
  writeLocalAccountContent,
  type AccountContentKey,
  type LocalAccountContent,
  type LocalAccountContentRead,
} from '@/lib/accountContent.local';
import {
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
  type ServerAccountContent,
} from '@/lib/accountContent.server';

export type AccountContentSyncOutcome =
  | 'uploaded'
  | 'hydrated'
  | 'in-sync'
  | 'nothing-to-sync'
  | 'local-invalid'
  | 'upload-failed'
  | 'fetch-failed'
  | 'aborted';

export type AccountContentSyncReport = Record<
  AccountContentKey,
  AccountContentSyncOutcome
>;

export type AccountContentSyncDeps = {
  supabase: SupabaseClient;
  userId: string;
  stillCurrent: () => boolean;
  /** Wrapper lets React suppress the synchronous storage event during hydrate. */
  hydrateLocal?: (key: AccountContentKey, value: LocalAccountContent) => boolean;
};

function compareUpdatedAt(a: LocalAccountContent, b: LocalAccountContent): number {
  return Date.parse(a.clientUpdatedAt) - Date.parse(b.clientUpdatedAt);
}

function sameValue(a: LocalAccountContent, b: LocalAccountContent): boolean {
  return sameAccountContentData(a.data, b.data);
}

function emptyReport(outcome: AccountContentSyncOutcome): AccountContentSyncReport {
  return Object.fromEntries(
    ACCOUNT_CONTENT_KEYS.map((key) => [key, outcome]),
  ) as AccountContentSyncReport;
}

export async function syncAccountContent({
  supabase,
  userId,
  stillCurrent,
  hydrateLocal = writeLocalAccountContent,
}: AccountContentSyncDeps): Promise<AccountContentSyncReport> {
  const server = await fetchServerAccountContent(supabase);
  if (server === null) return emptyReport('fetch-failed');
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
      server: server.get(key) ?? 'absent',
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
  hydrateLocal = writeLocalAccountContent,
}: AccountContentSyncDeps & {
  key: AccountContentKey;
}): Promise<AccountContentSyncOutcome> {
  const server = await fetchServerAccountContentKey(supabase, key);
  if (server === null) return 'fetch-failed';
  if (!stillCurrent()) return 'aborted';
  writeAccountContentOwner(userId);
  return reconcileKey({
    supabase,
    userId,
    key,
    server,
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
  hydrateLocal: (key: AccountContentKey, value: LocalAccountContent) => boolean;
}): Promise<AccountContentSyncOutcome> {
  const local = readLocalAccountContent(key);
  if (local.status === 'invalid') {
    if (server === 'absent') return 'local-invalid';
    return hydrateLocal(key, server) ? 'hydrated' : 'local-invalid';
  }
  if (local.status === 'absent') {
    if (server === 'absent') return 'nothing-to-sync';
    return hydrateLocal(key, server) ? 'hydrated' : 'upload-failed';
  }
  if (server === 'absent') {
    return uploadAndConfirm({
      supabase,
      userId,
      key,
      local: local.value,
      stillCurrent,
      hydrateLocal,
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
      hydrateLocal,
    });
  }
  if (order === 0 && sameValue(local.value, server)) return 'in-sync';

  // Server newer, or a losing tie with different content.
  return hydrateLocal(key, server) ? 'hydrated' : 'upload-failed';
}

async function uploadAndConfirm({
  supabase,
  userId,
  key,
  local,
  stillCurrent,
  hydrateLocal,
}: {
  supabase: SupabaseClient;
  userId: string;
  key: AccountContentKey;
  local: LocalAccountContent;
  stillCurrent: () => boolean;
  hydrateLocal: (key: AccountContentKey, value: LocalAccountContent) => boolean;
}): Promise<AccountContentSyncOutcome> {
  if (!(await upsertServerAccountContent(supabase, userId, key, local))) {
    return 'upload-failed';
  }
  if (!stillCurrent()) return 'aborted';

  const confirmed = await fetchServerAccountContentKey(supabase, key);
  if (!stillCurrent()) return 'aborted';
  if (confirmed === null || confirmed === 'absent') return 'uploaded';

  // Re-read local after both awaits. A user action may have produced a newer
  // value while this write was in flight; never overwrite it with the captured
  // pre-await snapshot.
  const current: LocalAccountContentRead = readLocalAccountContent(key);
  if (current.status !== 'present') {
    return hydrateLocal(key, confirmed) ? 'hydrated' : 'uploaded';
  }
  const order = compareUpdatedAt(current.value, confirmed);
  if (order > 0) return 'uploaded';
  if (order === 0 && sameValue(current.value, confirmed)) return 'uploaded';
  return hydrateLocal(key, confirmed) ? 'hydrated' : 'uploaded';
}

export const __testables = { compareUpdatedAt, sameValue };
