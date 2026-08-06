/**
 * accountContent.readGuard — leaf module (NO imports) the account-content
 * readers consult before returning data.
 *
 * Dependency inversion, deliberately: the readers (lists, nightLog,
 * nightArchive, sharedNightsLocal, accountContent.local) sit at the bottom
 * of the import graph, and the readiness barrier needs the quarantine
 * machinery which needs those same readers' key constants at module-eval
 * time — a direct import would be a TDZ cycle. The barrier module installs
 * the real guard at its own eval (accountContent.ready is loaded by the
 * app-shell gate before anything renders), so in-app every read is gated.
 *
 * Until installation the guard is permissive: bare unit tests of a single
 * reader exercise parsing, not readiness. The barrier's own tests pin the
 * installed behavior.
 */

let guard: () => boolean = () => true;
let bypassDepth = 0;

export function installAccountContentReadGuard(next: () => boolean): void {
  guard = next;
}

/**
 * The preservation machinery itself (journal capture, recovery, quarantine
 * moves) must read live keys while the barrier is deciding — without
 * re-entering the barrier. Scoped, never a global toggle.
 */
export function runWithAccountContentReadBypass<T>(fn: () => T): T {
  bypassDepth += 1;
  try {
    return fn();
  } finally {
    bypassDepth -= 1;
  }
}

/** Readers return their empty value when this is false. */
export function accountContentReadAllowed(): boolean {
  if (bypassDepth > 0) return true;
  try {
    return guard();
  } catch {
    // A throwing barrier must fail CLOSED for account content: rendering
    // possibly-foreign data is the one unrecoverable outcome.
    return false;
  }
}

export function __resetAccountContentReadGuardForTests(): void {
  guard = () => true;
  bypassDepth = 0;
}
