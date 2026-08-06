import {
  ACCOUNT_CONTENT_KEYS,
  ACCOUNT_CONTENT_META_KEY,
  ACCOUNT_CONTENT_OWNER_KEY,
  parseAccountContentData,
  readLocalAccountContent,
  storageKeyForAccountContent,
  type AccountContentData,
  type AccountContentKey,
} from '@/lib/accountContent.local';
import {
  clearConfirmedAccountContentMeta,
  readConfirmedAccountContentMeta,
} from '@/lib/accountContent.confirmed';
import { contentIdentity } from '@/lib/accountContent.digest';

/**
 * accountContent.quarantine — multi-account preservation store + crash-safe
 * journal (v2.1).
 *
 * The quarantine holds account content that must not stay LIVE (its owner is
 * not the current session) but must not be DELETED either (server presence
 * unproven). One envelope per (owner, key); parse-valid content and verbatim
 * raw invalid text are kept in separate stores. NO eviction and NO TTL —
 * pressure escalates to explicit human resolution, never to silent deletion.
 *
 * Moves run through a single journal covering every key at once:
 *   P1 pending write   — envelopes captured into the journal (nothing removed)
 *   P2 revalidate      — live keys re-read; digests must match the capture
 *   P3 commit          — envelopes merged into the quarantine store, re-read
 *                        and digest-validated (the preserved copy is PROVEN)
 *   P4 remove live     — content keys removed
 *   P5 remove meta     — v1 clock + confirmed entries removed
 *   P6 remove owner    — the owner marker goes LAST, then the journal clears
 *
 * The single journal (not per-key) is deliberate: the owner marker is shared
 * state, and per-key completion would remove it while sibling keys are still
 * mid-flight — a crash there strands live content with no owner, which a
 * later sign-in would adopt as its own (exactly the leak this file exists to
 * prevent). Recovery resumes only after revalidation; a committed valid
 * envelope is authoritative and completes P4–P6; corruption preserves both
 * copies and records resolution-required.
 */

export const ACCOUNT_CONTENT_QUARANTINE_KEY =
  'next-bar:account-content:quarantine:v2';
export const ACCOUNT_CONTENT_JOURNAL_KEY =
  'next-bar:account-content:journal:v1';

export type QuarantineEnvelope = {
  data: AccountContentData | null;
  clientUpdatedAt: string;
  digest: string;
  byteLength: number;
  quarantinedAt: string;
  status: 'quarantined' | 'conflict';
  /** Present when, AT CAPTURE, this exact content carried a server-read-back
   *  confirmation for its owner — server presence was proven then. Restore
   *  may release such an envelope when it merely lost LWW to a newer server
   *  write; an UNconfirmed envelope that loses becomes a retained conflict. */
  confirmedAtCapture?: { clock: string } | null;
};

export type RawInvalidEnvelope = {
  /** Verbatim unparseable localStorage text. Never rendered, never uploaded,
   *  never restored to a live key. */
  raw: string;
  capturedAt: string;
};

export type ResolutionRequiredEntry = {
  reason: string;
  at: string;
  ownerUserId: string | null;
  key?: AccountContentKey;
};

export type QuarantineStore = {
  version: 2;
  accounts: Record<
    string,
    Partial<Record<AccountContentKey, QuarantineEnvelope>>
  >;
  rawInvalid: Record<
    string,
    Partial<Record<AccountContentKey, RawInvalidEnvelope>>
  >;
  /** Foreign residue captured while another user is (or is about to be)
   *  current: account-content features stay blocked until resolved. */
  pendingForeign: { ownerUserId: string; capturedAt: string } | null;
  resolutionRequired: ResolutionRequiredEntry[];
};

type QuarantineJournal = {
  version: 1;
  ownerUserId: string;
  phase: 'P1' | 'P3' | 'P4' | 'P5';
  startedAt: string;
  pending: Partial<Record<AccountContentKey, QuarantineEnvelope>>;
  pendingRaw: Partial<Record<AccountContentKey, RawInvalidEnvelope>>;
};

const EMPTY_STORE: QuarantineStore = {
  version: 2,
  accounts: {},
  rawInvalid: {},
  pendingForeign: null,
  resolutionRequired: [],
};

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function readQuarantineStore(): QuarantineStore {
  if (typeof window === 'undefined') return { ...EMPTY_STORE };
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_QUARANTINE_KEY);
    if (!raw) return structuredClone(EMPTY_STORE);
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredClone(EMPTY_STORE);
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 2) return structuredClone(EMPTY_STORE);
    return {
      version: 2,
      accounts:
        obj.accounts !== null &&
        typeof obj.accounts === 'object' &&
        !Array.isArray(obj.accounts)
          ? (obj.accounts as QuarantineStore['accounts'])
          : {},
      rawInvalid:
        obj.rawInvalid !== null &&
        typeof obj.rawInvalid === 'object' &&
        !Array.isArray(obj.rawInvalid)
          ? (obj.rawInvalid as QuarantineStore['rawInvalid'])
          : {},
      pendingForeign:
        obj.pendingForeign !== null &&
        typeof obj.pendingForeign === 'object' &&
        typeof (obj.pendingForeign as Record<string, unknown>).ownerUserId ===
          'string'
          ? (obj.pendingForeign as QuarantineStore['pendingForeign'])
          : null,
      resolutionRequired: Array.isArray(obj.resolutionRequired)
        ? (obj.resolutionRequired as ResolutionRequiredEntry[])
        : [],
    };
  } catch {
    // An unreadable quarantine store is itself a preservation emergency —
    // never overwrite it blindly. Callers observe the empty view; writers
    // below only merge on top of what THEY read, and writeStore refuses to
    // clobber a store it could not parse.
    return structuredClone(EMPTY_STORE);
  }
}

function storeIsReadable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_QUARANTINE_KEY);
    if (!raw) return true;
    const parsed: unknown = JSON.parse(raw);
    // Must be the SAME schema the reader accepts. A parseable object of an
    // unrecognized version reads as empty, and writing "on top" of an empty
    // view would replace bytes holding envelopes this build cannot see —
    // exactly the silent deletion the store exists to prevent.
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).version === 2
    );
  } catch {
    return false;
  }
}

function writeStore(store: QuarantineStore): boolean {
  if (typeof window === 'undefined') return false;
  if (!storeIsReadable()) return false; // never clobber an unreadable store
  try {
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify(store),
    );
    return true;
  } catch {
    return false; // quota — caller must leave live content untouched
  }
}

function readJournal(): QuarantineJournal | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (
      obj.version !== 1 ||
      typeof obj.ownerUserId !== 'string' ||
      !['P1', 'P3', 'P4', 'P5'].includes(obj.phase as string)
    ) {
      return null;
    }
    return obj as unknown as QuarantineJournal;
  } catch {
    return null;
  }
}

function writeJournal(journal: QuarantineJournal): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      JSON.stringify(journal),
    );
    return true;
  } catch {
    return false;
  }
}

function clearJournal(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_CONTENT_JOURNAL_KEY);
  } catch {
    // A stuck journal re-enters recovery next load; recovery is idempotent.
  }
}

function confirmedAtCaptureFor(
  key: AccountContentKey,
  ownerUserId: string,
  digest: string,
): { clock: string } | null {
  const confirmed = readConfirmedAccountContentMeta(key);
  if (confirmed && confirmed.userId === ownerUserId && confirmed.digest === digest) {
    return { clock: confirmed.clock };
  }
  return null;
}

function captureLive(
  ownerUserId: string,
  now?: Date,
): {
  pending: QuarantineJournal['pending'];
  pendingRaw: QuarantineJournal['pendingRaw'];
} {
  const pending: QuarantineJournal['pending'] = {};
  const pendingRaw: QuarantineJournal['pendingRaw'] = {};
  for (const key of ACCOUNT_CONTENT_KEYS) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKeyForAccountContent(key));
    } catch {
      continue;
    }
    if (raw === null) {
      const read = readLocalAccountContent(key);
      if (read.status === 'present') {
        // Tombstone (meta clock without data): preserve the deliberate null.
        const id = contentIdentity(read.value.data);
        pending[key] = {
          data: read.value.data,
          clientUpdatedAt: read.value.clientUpdatedAt,
          digest: id.digest,
          byteLength: id.byteLength,
          quarantinedAt: nowIso(now),
          status: 'quarantined',
          confirmedAtCapture: confirmedAtCaptureFor(key, ownerUserId, id.digest),
        };
      }
      continue;
    }
    let data: AccountContentData | null = null;
    let invalid = false;
    try {
      data = parseAccountContentData(key, JSON.parse(raw) as unknown);
      invalid = data === null;
    } catch {
      invalid = true;
    }
    if (invalid) {
      pendingRaw[key] = { raw, capturedAt: nowIso(now) };
      continue;
    }
    const read = readLocalAccountContent(key);
    const clientUpdatedAt =
      read.status === 'present' ? read.value.clientUpdatedAt : nowIso(now);
    const id = contentIdentity(data);
    pending[key] = {
      data,
      clientUpdatedAt,
      digest: id.digest,
      byteLength: id.byteLength,
      quarantinedAt: nowIso(now),
      status: 'quarantined',
      confirmedAtCapture: confirmedAtCaptureFor(key, ownerUserId, id.digest),
    };
  }
  return { pending, pendingRaw };
}

/**
 * Quarantine ONE key's unparseable live text verbatim under `userId`, then
 * remove the live key — only after the committed copy is re-read and
 * byte-compared. Returns false (leaving the live key untouched) on any
 * failure. The raw text is never rendered, uploaded, or restored live.
 */
export function quarantineRawInvalidContent(
  userId: string,
  key: AccountContentKey,
  now?: Date,
): boolean {
  if (typeof window === 'undefined') return false;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKeyForAccountContent(key));
  } catch {
    return false;
  }
  if (raw === null) return false;
  const store = readQuarantineStore();
  const next: QuarantineStore = {
    ...store,
    rawInvalid: {
      ...store.rawInvalid,
      [userId]: {
        ...(store.rawInvalid[userId] ?? {}),
        [key]: { raw, capturedAt: nowIso(now) },
      },
    },
  };
  if (!writeStore(next)) return false;
  // Validate the preserved copy byte-for-byte before removing the original.
  if (readQuarantineStore().rawInvalid[userId]?.[key]?.raw !== raw) return false;
  try {
    // Re-read immediately before removal: a concurrent tab may have replaced
    // the invalid text with a valid correction, which must not be deleted.
    // (localStorage offers no atomic compare-and-delete; this shrinks the
    // race to the minimum the platform allows.)
    if (window.localStorage.getItem(storageKeyForAccountContent(key)) !== raw) {
      return false;
    }
    window.localStorage.removeItem(storageKeyForAccountContent(key));
  } catch {
    // Both copies remain — safe, just untidy; the next pass retries.
  }
  return true;
}

function liveMatchesPending(journal: QuarantineJournal): boolean {
  for (const key of ACCOUNT_CONTENT_KEYS) {
    const envelope = journal.pending[key];
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKeyForAccountContent(key));
    } catch {
      return false;
    }
    if (journal.pendingRaw[key] !== undefined) {
      if (raw !== journal.pendingRaw[key]?.raw) return false;
      continue;
    }
    if (!envelope) {
      if (raw !== null) return false;
      continue;
    }
    if (raw === null) {
      // Tombstone envelope: live key legitimately absent.
      if (envelope.data !== null) return false;
      continue;
    }
    try {
      const data = parseAccountContentData(key, JSON.parse(raw) as unknown);
      if (data === null) return false;
      if (contentIdentity(data).digest !== envelope.digest) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** True when the committed store provably holds every pending envelope. */
function commitIsValid(journal: QuarantineJournal): boolean {
  const store = readQuarantineStore();
  const account = store.accounts[journal.ownerUserId] ?? {};
  for (const key of ACCOUNT_CONTENT_KEYS) {
    const envelope = journal.pending[key];
    if (envelope) {
      const committed = account[key];
      if (!committed) return false;
      if (contentIdentity(committed.data).digest !== envelope.digest) {
        return false;
      }
    }
    const rawEnvelope = journal.pendingRaw[key];
    if (rawEnvelope) {
      const committedRaw = store.rawInvalid[journal.ownerUserId]?.[key];
      if (!committedRaw || committedRaw.raw !== rawEnvelope.raw) return false;
    }
  }
  return true;
}

function commit(journal: QuarantineJournal): boolean {
  const store = readQuarantineStore();
  const account = { ...(store.accounts[journal.ownerUserId] ?? {}) };
  for (const [key, envelope] of Object.entries(journal.pending)) {
    account[key as AccountContentKey] = envelope;
  }
  const rawAccount = { ...(store.rawInvalid[journal.ownerUserId] ?? {}) };
  for (const [key, envelope] of Object.entries(journal.pendingRaw)) {
    rawAccount[key as AccountContentKey] = envelope;
  }
  const next: QuarantineStore = {
    ...store,
    accounts: { ...store.accounts, [journal.ownerUserId]: account },
    rawInvalid: { ...store.rawInvalid, [journal.ownerUserId]: rawAccount },
  };
  if (!writeStore(next)) return false;
  return commitIsValid(journal);
}

/**
 * P4. Remove a journaled key's live copy ONLY when the live bytes still
 * digest to what the journal preserved — a mutation that landed after the
 * commit (crashed tab's stale journal, concurrent tab) may be the user's
 * only current copy and must survive; it is flagged for resolution instead.
 * Returns true when every journaled key is verifiably out of live storage.
 */
function removeLiveKeys(journal: QuarantineJournal): boolean {
  let allClear = true;
  for (const key of ACCOUNT_CONTENT_KEYS) {
    const envelope = journal.pending[key];
    const rawEnvelope = journal.pendingRaw[key];
    if (envelope === undefined && rawEnvelope === undefined) continue;
    const storageKey = storageKeyForAccountContent(key);
    try {
      const live = window.localStorage.getItem(storageKey);
      if (live === null) continue; // already gone
      let matches = false;
      if (rawEnvelope) {
        matches = live === rawEnvelope.raw;
      } else if (envelope) {
        try {
          const data = parseAccountContentData(key, JSON.parse(live) as unknown);
          matches =
            data !== null && contentIdentity(data).digest === envelope.digest;
        } catch {
          matches = false;
        }
      }
      if (!matches) {
        // Newer live content than the preserved copy: keep BOTH, flag it.
        recordResolutionRequired({
          reason: `live ${key} diverged from journaled envelope; both copies preserved`,
          at: nowIso(),
          ownerUserId: journal.ownerUserId,
          key,
        });
        allClear = false;
        continue;
      }
      window.localStorage.removeItem(storageKey);
    } catch {
      // Removal failure leaves residue; the owner marker must then stay so
      // it can never be adopted as anonymous data.
      allClear = false;
    }
  }
  return allClear;
}

function removeMeta(journal: QuarantineJournal): void {
  const keys = [
    ...Object.keys(journal.pending),
    ...Object.keys(journal.pendingRaw),
  ] as AccountContentKey[];
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const meta = { ...(parsed as Record<string, unknown>) };
        for (const key of keys) delete meta[key];
        if (Object.keys(meta).length === 0) {
          window.localStorage.removeItem(ACCOUNT_CONTENT_META_KEY);
        } else {
          window.localStorage.setItem(
            ACCOUNT_CONTENT_META_KEY,
            JSON.stringify(meta),
          );
        }
      } else {
        window.localStorage.removeItem(ACCOUNT_CONTENT_META_KEY);
      }
    }
  } catch {
    // Best-effort; a stale clock alone can never resurrect removed data.
  }
  clearConfirmedAccountContentMeta(keys);
}

function recordResolutionRequired(entry: ResolutionRequiredEntry): void {
  const store = readQuarantineStore();
  // Dedup on (reason, owner, key): recovery retries re-report the same
  // condition every pass, and an append-only list would grow unbounded.
  const exists = store.resolutionRequired.some(
    (e) =>
      e.reason === entry.reason &&
      e.ownerUserId === entry.ownerUserId &&
      e.key === entry.key,
  );
  if (exists) return;
  writeStore({
    ...store,
    resolutionRequired: [...store.resolutionRequired, entry],
  });
}

/** P4→P6 tail, shared by the live run and recovery. Owner marker goes last —
 *  and ONLY once every journaled live key is verifiably out of live storage.
 *  Surviving live content without an owner marker would read as anonymous
 *  data and be adopted by the next account (the one unrecoverable leak). */
function completeFromCommitted(journal: QuarantineJournal): boolean {
  if (
    journal.phase === 'P3' ||
    journal.phase === 'P4' // resume re-runs the digest-guarded removals
  ) {
    const allClear = removeLiveKeys(journal);
    void writeJournal({ ...journal, phase: 'P4' });
    if (!allClear) {
      // Keep meta, owner marker, and the journal: the residue stays OWNED
      // and unrendered (barrier), and the next recovery pass retries.
      return false;
    }
    removeMeta(journal);
    void writeJournal({ ...journal, phase: 'P5' });
  }
  try {
    window.localStorage.removeItem(ACCOUNT_CONTENT_OWNER_KEY);
  } catch {
    return false;
  }
  clearJournal();
  return true;
}

export type QuarantineMoveResult =
  | { ok: true; movedKeys: AccountContentKey[] }
  | { ok: false; reason: 'nothing-to-move' | 'quota' | 'unstable' | 'commit-failed' };

/**
 * Move ALL live account content into quarantine under `ownerUserId`.
 * Fails into preservation: any failure before a validated commit leaves
 * every live key untouched.
 */
export function quarantineAccountContent(
  ownerUserId: string,
  now?: Date,
): QuarantineMoveResult {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'nothing-to-move' };
  }
  const { pending, pendingRaw } = captureLive(ownerUserId, now);
  const movedKeys = [
    ...Object.keys(pending),
    ...Object.keys(pendingRaw),
  ] as AccountContentKey[];
  if (movedKeys.length === 0) {
    // Nothing live: still finish the tail so the owner marker cannot dangle.
    try {
      window.localStorage.removeItem(ACCOUNT_CONTENT_OWNER_KEY);
    } catch {
      /* residual guard retries next load */
    }
    return { ok: true, movedKeys: [] };
  }

  // P1 — pending write. Quota failure removes nothing.
  const journal: QuarantineJournal = {
    version: 1,
    ownerUserId,
    phase: 'P1',
    startedAt: nowIso(now),
    pending,
    pendingRaw,
  };
  if (!writeJournal(journal)) return { ok: false, reason: 'quota' };

  // P2 — revalidate. A mutation between capture and validate restarts once.
  if (!liveMatchesPending(journal)) {
    const fresh = captureLive(ownerUserId, now);
    journal.pending = fresh.pending;
    journal.pendingRaw = fresh.pendingRaw;
    if (!writeJournal(journal)) {
      clearJournal();
      return { ok: false, reason: 'quota' };
    }
    if (!liveMatchesPending(journal)) {
      clearJournal();
      return { ok: false, reason: 'unstable' };
    }
  }

  // P3 — commit, then re-read and validate the preserved copy.
  if (!commit(journal)) {
    clearJournal();
    return { ok: false, reason: 'commit-failed' };
  }
  const committed: QuarantineJournal = { ...journal, phase: 'P3' };
  void writeJournal(committed);

  // P4–P6 — only now may live copies disappear; owner marker last.
  completeFromCommitted(committed);
  return { ok: true, movedKeys };
}

/**
 * Crash recovery. Runs before any account-content read (via the readiness
 * barrier). Resumes only after revalidation; corruption preserves both
 * copies and records resolution-required.
 */
export function recoverQuarantineJournal(): void {
  if (typeof window === 'undefined') return;
  const journal = readJournal();
  if (!journal) {
    // An unparseable journal value must not wedge recovery forever, but the
    // bytes are preserved as a resolution artifact rather than deleted.
    try {
      const raw = window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY);
      if (raw !== null) {
        recordResolutionRequired({
          reason: `unreadable journal preserved verbatim: ${raw.slice(0, 512)}`,
          at: nowIso(),
          ownerUserId: null,
        });
        clearJournal();
      }
    } catch {
      /* nothing readable — nothing to do */
    }
    return;
  }

  if (journal.phase === 'P1') {
    // Not committed. Live state is authoritative — revalidate; on mismatch
    // rebuild from live (the user kept using the app; that is not corruption).
    if (!liveMatchesPending(journal)) {
      const fresh = captureLive(journal.ownerUserId);
      journal.pending = fresh.pending;
      journal.pendingRaw = fresh.pendingRaw;
      if (
        Object.keys(journal.pending).length === 0 &&
        Object.keys(journal.pendingRaw).length === 0
      ) {
        clearJournal();
        return;
      }
      if (!writeJournal(journal)) return; // retry next load; nothing removed
    }
    if (!commit(journal)) return; // preserved live; retry next load
    const committed: QuarantineJournal = { ...journal, phase: 'P3' };
    void writeJournal(committed);
    completeFromCommitted(committed);
    return;
  }

  // P3/P4/P5 — committed. A valid committed envelope is authoritative.
  if (commitIsValid(journal)) {
    completeFromCommitted(journal);
    return;
  }
  // Committed record failed validation: corruption. Preserve BOTH copies —
  // nothing else is removed — and require explicit resolution.
  recordResolutionRequired({
    reason: 'quarantine commit failed revalidation after crash',
    at: nowIso(),
    ownerUserId: journal.ownerUserId,
  });
  clearJournal();
}

/** Envelopes quarantined for a user (restore reconciliation input). */
export function readQuarantinedAccountContent(
  userId: string,
): Partial<Record<AccountContentKey, QuarantineEnvelope>> {
  return readQuarantineStore().accounts[userId] ?? {};
}

export function updateQuarantinedEnvelope(
  userId: string,
  key: AccountContentKey,
  envelope: QuarantineEnvelope,
): boolean {
  const store = readQuarantineStore();
  return writeStore({
    ...store,
    accounts: {
      ...store.accounts,
      [userId]: { ...(store.accounts[userId] ?? {}), [key]: envelope },
    },
  });
}

/** Drop one envelope after explicit resolution or proven server presence. */
export function releaseQuarantinedEnvelope(
  userId: string,
  key: AccountContentKey,
): boolean {
  const store = readQuarantineStore();
  const account = { ...(store.accounts[userId] ?? {}) };
  delete account[key];
  return writeStore({
    ...store,
    accounts: { ...store.accounts, [userId]: account },
  });
}

export function getPendingForeign(): QuarantineStore['pendingForeign'] {
  return readQuarantineStore().pendingForeign;
}

export function setPendingForeign(ownerUserId: string, now?: Date): boolean {
  const store = readQuarantineStore();
  return writeStore({
    ...store,
    pendingForeign: { ownerUserId, capturedAt: nowIso(now) },
  });
}

/**
 * Resolve foreign residue. 'keep' preserves the owner's envelopes for their
 * return; 'delete' is the explicit permanent discard.
 */
export function resolvePendingForeign(choice: 'keep' | 'delete'): boolean {
  const store = readQuarantineStore();
  const pending = store.pendingForeign;
  if (!pending) return true;
  if (choice === 'keep') {
    return writeStore({ ...store, pendingForeign: null });
  }
  const accounts = { ...store.accounts };
  delete accounts[pending.ownerUserId];
  const rawInvalid = { ...store.rawInvalid };
  delete rawInvalid[pending.ownerUserId];
  return writeStore({
    ...store,
    accounts,
    rawInvalid,
    pendingForeign: null,
  });
}

export function listResolutionRequired(): ResolutionRequiredEntry[] {
  return readQuarantineStore().resolutionRequired;
}

/** Account deletion only: wipes every preservation structure unconditionally. */
export function wipeAllQuarantineState(): void {
  if (typeof window === 'undefined') return;
  for (const key of [
    ACCOUNT_CONTENT_QUARANTINE_KEY,
    ACCOUNT_CONTENT_JOURNAL_KEY,
  ]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* deletion path; best-effort */
    }
  }
}
