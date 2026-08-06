import { getCacheEpoch } from '@/lib/accountCache';
import {
  readAccountContentOwner,
  writeAccountContentOwner,
} from '@/lib/accountContent.local';
import {
  getPendingForeign,
  quarantineAccountContent,
  recoverQuarantineJournal,
  resolvePendingForeign,
  setPendingForeign,
} from '@/lib/accountContent.quarantine';
import {
  getAccountContentAuthContext,
  getAccountContentAuthEpoch,
  notifyAccountContentContextListeners,
} from '@/lib/accountContent.context';
import {
  installAccountContentReadGuard,
  runWithAccountContentReadBypass,
} from '@/lib/accountContent.readGuard';

/**
 * accountContent.ready — the synchronous readiness barrier (v2.1).
 *
 * ensureAccountContentReady() runs recovery and ownership checks before any
 * account-content read, memoized per (auth context, auth epoch, cache
 * epoch). Verdicts:
 *
 *   ready    — reads pass through.
 *   blocked  — readers return their EMPTY value for this frame. Reasons:
 *     auth-unknown        auth has not resolved; an owner marker exists, so
 *                         the live content could be anyone's. Never memoized.
 *     foreign-residue     another account's residue was found (now
 *                         quarantined under its owner); the CURRENT user must
 *                         resolve Keep-it-for-them / Delete-permanently.
 *     resolution-required a preservation move could not complete safely
 *                         (quota/corruption); humans decide, nothing deleted.
 *
 * Blocking is scoped to account content only — sign-in and unrelated app
 * features never wait on this barrier.
 */

export type AccountContentReadiness =
  | { status: 'ready' }
  | {
      status: 'blocked';
      reason: 'auth-unknown' | 'foreign-residue' | 'resolution-required';
    };

const READY: AccountContentReadiness = { status: 'ready' };

let memoKey: string | null = null;
let memoValue: AccountContentReadiness | null = null;

function computeSignedOut(): AccountContentReadiness {
  const owner = readAccountContentOwner();
  if (owner === null) return READY;
  // Involuntary sign-out residue (expiry/revocation — our voluntary flow
  // removes the marker itself): preserve it inert under its owner. The
  // anonymous session then starts empty; nothing foreign ever renders.
  // The pending-foreign flag makes a LATER different sign-in deterministic
  // (keep/delete decision); the owner's own return auto-clears it.
  const moved = quarantineAccountContent(owner);
  if (!moved.ok) return { status: 'blocked', reason: 'resolution-required' };
  setPendingForeign(owner);
  return READY;
}

function computeSignedIn(userId: string): AccountContentReadiness {
  const owner = readAccountContentOwner();
  if (owner !== null && owner !== userId) {
    // Live foreign residue. Preserve FIRST (under its real owner), then
    // block until this user resolves it. Sign-in itself proceeds.
    const moved = quarantineAccountContent(owner);
    if (!moved.ok) {
      return { status: 'blocked', reason: 'resolution-required' };
    }
    setPendingForeign(owner);
    return { status: 'blocked', reason: 'foreign-residue' };
  }
  const pending = getPendingForeign();
  if (pending) {
    if (pending.ownerUserId === userId) {
      // The residue's owner came back — it is THEIR data; the restore
      // reconciliation owns it from here. No block for the owner.
      resolvePendingForeign('keep');
    } else {
      return { status: 'blocked', reason: 'foreign-residue' };
    }
  }
  if (owner === null) {
    // Stamp ownership at the first signed-in frame, not after the first
    // successful fetch: an all-offline session must still leave attributable
    // residue, or its content would later merge into the NEXT account.
    // Adopting anonymous data into the signing-in account is the intended
    // first-sign-in merge behavior — the stamp just makes it explicit.
    writeAccountContentOwner(userId);
    if (readAccountContentOwner() !== userId) {
      // The stamp did not land (quota). Unattributable content written from
      // here would later be adopted by the NEXT account — fail closed for
      // account-content features until storage recovers.
      return { status: 'blocked', reason: 'resolution-required' };
    }
  }
  return READY;
}

export function ensureAccountContentReady(): AccountContentReadiness {
  if (typeof window === 'undefined') {
    // SSR renders the empty frame; hydration re-runs the barrier.
    return { status: 'blocked', reason: 'auth-unknown' };
  }

  return runWithAccountContentReadBypass(() => {
    const ctx = getAccountContentAuthContext();

    if (ctx.kind === 'unknown') {
      // Never memoized: the verdict must flip the instant auth resolves.
      recoverQuarantineJournal();
      return readAccountContentOwner() !== null
        ? { status: 'blocked', reason: 'auth-unknown' }
        : READY;
    }

    const key = `${ctx.kind}:${
      ctx.kind === 'signed-in' ? ctx.userId : ''
    }:${getAccountContentAuthEpoch()}:${getCacheEpoch()}`;
    if (memoKey === key && memoValue !== null) return memoValue;

    recoverQuarantineJournal();
    const value =
      ctx.kind === 'signed-out' ? computeSignedOut() : computeSignedIn(ctx.userId);
    memoKey = key;
    memoValue = value;
    return value;
  });
}

/**
 * A resolution action (keep/delete/conflict choice) changed the stored state
 * without moving any epoch — recompute the verdict and wake subscribers.
 */
export function invalidateAccountContentReadiness(): void {
  memoKey = null;
  memoValue = null;
  notifyAccountContentContextListeners();
  // Key-filtered consumers (nights, lists) re-read on the null-key
  // "storage changed wholesale" event — same pattern as the cache wipe.
  // AccountContentSync deliberately ignores key=null, so this can never be
  // mistaken for user deletions.
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  } catch {
    // Non-fatal: consumers refresh on their next mount.
  }
}

export function __resetAccountContentReadyForTests(): void {
  memoKey = null;
  memoValue = null;
}

// Install at module eval: the app shell (AccountContentGate in the root
// layout) imports this module before anything renders, so every reader in
// the app consults the real barrier from the first frame.
installAccountContentReadGuard(
  () => ensureAccountContentReady().status === 'ready',
);
