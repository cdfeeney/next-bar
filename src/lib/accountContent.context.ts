/**
 * accountContent.context — module-level auth context for the synchronous
 * readiness barrier (v2.1).
 *
 * The barrier must answer "whose content may render?" during a synchronous
 * read, but auth resolves asynchronously. This tri-state context starts
 * 'unknown' (readers render EMPTY, never foreign data) and is flipped by the
 * AccountContentGate provider as auth resolves. The auth epoch increments on
 * every identity transition so barrier memoization can never leak a verdict
 * across sign-in/sign-out boundaries.
 */

export type AccountContentAuthContext =
  | { kind: 'unknown' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; userId: string };

let context: AccountContentAuthContext = { kind: 'unknown' };
let authEpoch = 0;
const listeners = new Set<() => void>();

function sameContext(
  a: AccountContentAuthContext,
  b: AccountContentAuthContext,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'signed-in' && b.kind === 'signed-in') {
    return a.userId === b.userId;
  }
  return true;
}

export function getAccountContentAuthContext(): AccountContentAuthContext {
  return context;
}

export function getAccountContentAuthEpoch(): number {
  return authEpoch;
}

export function setAccountContentAuthContext(
  next: AccountContentAuthContext,
): void {
  if (sameContext(context, next)) return;
  context = next;
  authEpoch += 1;
  for (const notify of listeners) notify();
}

/** Readiness consumers (useSyncExternalStore) subscribe here. */
export function subscribeAccountContentContext(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyAccountContentContextListeners(): void {
  for (const notify of listeners) notify();
}

export function __resetAccountContentContextForTests(): void {
  context = { kind: 'unknown' };
  authEpoch = 0;
  listeners.clear();
}
