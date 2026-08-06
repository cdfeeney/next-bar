import {
  ACCOUNT_CONTENT_META_KEY,
  parseAccountContentData,
  storageKeyForAccountContent,
  writeLocalAccountContent,
  type AccountContentKey,
  type LocalAccountContent,
} from '@/lib/accountContent.local';
import { contentIdentity } from '@/lib/accountContent.digest';

/**
 * accountContent.confirmed — server-read-back confirmation metadata (v2.1).
 *
 * Confirmation comes ONLY from a matching server read-back: after an upload
 * or hydration, the value the server actually returned is digested and
 * recorded here. A sent request, an errorless upsert, or a hopeful local
 * write never confirms anything. Malformed or absent confirmation classifies
 * the key DIRTY — the preservation machinery then refuses to delete it.
 *
 * Local mutations never touch this store; only read-backs do. That is what
 * makes the digest-idempotent stamp in accountContent.local safe: an echoed
 * hydration (cross-tab storage event) digests equal to the confirmation and
 * is recognized as "not a new mutation".
 */

export const ACCOUNT_CONTENT_CONFIRMED_KEY =
  'next-bar:account-content:confirmed:v2';

export type ConfirmedAccountContentMeta = {
  version: 2;
  /** The authenticated user this confirmation belongs to. */
  userId: string;
  /** The server-read-back client_updated_at. */
  clock: string;
  /** Content identity of the read-back payload data. */
  digest: string;
  byteLength: number;
  confirmedAt: string;
};

export type AccountContentClass = 'absent' | 'clean' | 'dirty' | 'invalid';

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseEntry(value: unknown): ConfirmedAccountContentMeta | null {
  if (value === null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (
    obj.version !== 2 ||
    typeof obj.userId !== 'string' ||
    obj.userId.length === 0 ||
    !validIso(obj.clock) ||
    typeof obj.digest !== 'string' ||
    !/^[0-9a-f]{16}$/.test(obj.digest) ||
    typeof obj.byteLength !== 'number' ||
    !Number.isFinite(obj.byteLength) ||
    obj.byteLength < 0 ||
    !validIso(obj.confirmedAt)
  ) {
    return null;
  }
  return {
    version: 2,
    userId: obj.userId,
    clock: obj.clock,
    digest: obj.digest,
    byteLength: obj.byteLength,
    confirmedAt: obj.confirmedAt,
  };
}

function readStore(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_CONFIRMED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The confirmation for a key, or null when absent/malformed (= dirty). */
export function readConfirmedAccountContentMeta(
  key: AccountContentKey,
): ConfirmedAccountContentMeta | null {
  return parseEntry(readStore()[key]);
}

export function writeConfirmedAccountContentMeta(
  key: AccountContentKey,
  meta: ConfirmedAccountContentMeta,
): boolean {
  if (typeof window === 'undefined' || parseEntry(meta) === null) return false;
  try {
    window.localStorage.setItem(
      ACCOUNT_CONTENT_CONFIRMED_KEY,
      JSON.stringify({ ...readStore(), [key]: meta }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearConfirmedAccountContentMeta(
  keys?: readonly AccountContentKey[],
): void {
  if (typeof window === 'undefined') return;
  try {
    if (!keys) {
      window.localStorage.removeItem(ACCOUNT_CONTENT_CONFIRMED_KEY);
      return;
    }
    const store = readStore();
    for (const key of keys) delete store[key];
    window.localStorage.setItem(
      ACCOUNT_CONTENT_CONFIRMED_KEY,
      JSON.stringify(store),
    );
  } catch {
    // Best-effort: a stale confirmation for a wiped key is harmless — the
    // digest can no longer match anything, so it can only classify dirty.
  }
}

/**
 * Classify a key's persisted local state for a user. Runtime states
 * (syncing/failed) belong to the sync engine; storage alone knows these four.
 */
export function classifyAccountContent(
  key: AccountContentKey,
  userId: string,
): AccountContentClass {
  if (typeof window === 'undefined') return 'absent';

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKeyForAccountContent(key));
  } catch {
    return 'invalid';
  }

  let metaClock: string | undefined;
  try {
    const metaRaw = window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY);
    if (metaRaw) {
      const parsed: unknown = JSON.parse(metaRaw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = (parsed as Record<string, unknown>)[key];
        if (validIso(candidate)) metaClock = candidate;
      }
    }
  } catch {
    metaClock = undefined;
  }

  const confirmed = readConfirmedAccountContentMeta(key);

  let data: unknown;
  if (raw === null) {
    if (!metaClock && !confirmed) return 'absent';
    // Tombstone (deliberate local null) or bare confirmation residue.
    data = null;
  } else {
    try {
      const parsed = parseAccountContentData(key, JSON.parse(raw) as unknown);
      if (parsed === null) return 'invalid';
      data = parsed;
    } catch {
      return 'invalid';
    }
  }

  if (!confirmed || confirmed.userId !== userId) return 'dirty';
  const id = contentIdentity(data);
  return id.digest === confirmed.digest && id.byteLength === confirmed.byteLength
    ? 'clean'
    : 'dirty';
}

/**
 * Hydrate an authoritative server value. ORDER IS THE CONTRACT: confirmed
 * metadata first, then data, then the v1 clock. A crash between any two
 * writes leaves the key classifying DIRTY (digest mismatch), which re-enters
 * reconciliation — it can never leave a falsely-clean state, and it never
 * loses the only copy of anything (the server value is by definition on the
 * server).
 */
export function hydrateConfirmedAccountContent(
  key: AccountContentKey,
  value: LocalAccountContent,
  userId: string,
  now: Date = new Date(),
): boolean {
  if (typeof window === 'undefined' || !validIso(value.clientUpdatedAt)) {
    return false;
  }
  const id = contentIdentity(value.data);
  const wrote = writeConfirmedAccountContentMeta(key, {
    version: 2,
    userId,
    clock: value.clientUpdatedAt,
    digest: id.digest,
    byteLength: id.byteLength,
    confirmedAt: now.toISOString(),
  });
  if (!wrote) return false;
  return writeLocalAccountContent(key, value);
}
