/**
 * Fail-closed CLI argument hardening shared by the census run-directory
 * scripts (reconcile-preflight.mts, expansion-packet-cli.mts).
 *
 * Extracted verbatim from reconcile-preflight.mts (goal g-25eaf18d, hardened
 * over two Santa rounds) so a second CLI reuses the reviewed parser instead of
 * re-inventing a weaker one. Behavior is unchanged; only the REFUSED prefix is
 * parameterized.
 */

/** A safe run directory name: no path separators, no "..", no leading dot. */
export const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Windows reserved device names resolve to a device, not a regular file, even
 * as a path component — refuse them explicitly rather than rely on fs calls to
 * fail safely on every platform this might ever run on.
 */
export const RESERVED_WINDOWS_NAMES: ReadonlySet<string> = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export type Fail = (message: string) => never;

/** Build the `REFUSED:`-prefixed exit-1 failure used by these CLIs. */
export function makeFail(label: string): Fail {
  return (message: string): never => {
    console.error(`${label} REFUSED: ${message}`);
    process.exit(1);
  };
}

/**
 * Read a `--flag value` pair. Refuses a repeated flag (an ambiguous
 * duplicate would otherwise be silently resolved to the first occurrence)
 * and a flag given without a value or immediately followed by another flag.
 */
export function flagValue(args: readonly string[], name: string, fail: Fail): string | null {
  const occurrences = args.filter((a) => a === name).length;
  if (occurrences > 1) {
    fail(`${name} was given more than once`);
  }
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) {
    fail(`${name} was given without a value`);
  }
  return value;
}

/**
 * Validate a run id so `join(OUT_DIR, runId)` can never resolve outside
 * OUT_DIR. Returns the id unchanged when safe; exits 1 otherwise.
 */
export function requireSafeRunId(runId: string, fail: Fail): string {
  if (!SAFE_RUN_ID.test(runId)) {
    fail(`--run "${runId}" is not a safe run directory name (letters, digits, dot, underscore, hyphen only)`);
  }
  if (RESERVED_WINDOWS_NAMES.has(runId.toLowerCase())) {
    fail(`--run "${runId}" is a reserved Windows device name`);
  }
  return runId;
}
