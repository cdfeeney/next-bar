/**
 * Single source of truth for the two e2e dev-server ports.
 *
 * `playwright.config.ts` resolves its `webServer` entries from these, and
 * `fence-global-setup.ts` canaries exactly the ports a run could REUSE. Those
 * two lists MUST agree, and until this module existed they were hand-copied
 * with only a comment holding them together.
 *
 * That duplication was fail-OPEN, which is why it is worth a module of its
 * own. `webServer.reuseExistingServer` is true, so a dev server already on one
 * of these ports is adopted as-is and never receives the fence proxy env. The
 * canary exists to catch exactly that. If a future edit renamed the variable
 * or changed a default in the config alone, the canary would go on probing
 * ports the run never uses — where nothing is listening, so `ECONNREFUSED`
 * returns silently as "no server, fine" — while the server actually adopted
 * went uninterrogated. The guard would still pass, and the gap it exists to
 * close would be silently reopened. (santa round 2: Claude/FABLE.)
 *
 * Read through functions rather than exported constants: `process.env` is
 * mutated by tooling between module load and use, and a captured constant
 * would freeze whichever value happened to be present at import time.
 */

/** Main dev server: Google media pinned OFF. */
export const e2ePort = (): string => process.env.E2E_PORT ?? '3000';

/** Second dev server: the only one with the Google card enabled. */
export const e2eGooglePort = (): string => process.env.E2E_GOOGLE_PORT ?? '3100';

/**
 * Every port a run could adopt through `reuseExistingServer`, and therefore
 * every port the fence canary must interrogate.
 */
export const reusablePorts = (): string[] => [e2ePort(), e2eGooglePort()];
