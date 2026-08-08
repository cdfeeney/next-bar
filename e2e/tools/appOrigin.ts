/**
 * appOrigin — the single source of truth for WHICH dev server the browser
 * tests talk to.
 *
 * WHY THIS EXISTS. `reuseExistingServer: true` plus a hardcoded `:3000` means
 * a Playwright run in worktree A silently tests the code served by worktree
 * B's dev server. That is not theoretical: this repo routinely has several
 * leased worktrees running at once, and the reused-server canary in
 * fence-global-setup.ts only proves the squatter is FENCED — never that it is
 * serving YOUR checkout.
 *
 * `NB_E2E_PORT` lets a worktree claim its own port. The default is unchanged,
 * so a normal single-worktree run behaves exactly as before.
 *
 * Deliberately NOT related to `FENCE_PORT`: the network fence is a stateless,
 * loopback-only, refuse-all proxy, so one instance is correctly SHARED by
 * every concurrent run. Only the application server must be per-worktree.
 */

const DEFAULT_APP_PORT = 3000;

function readPort(): number {
  const raw = process.env.NB_E2E_PORT;
  if (!raw) return DEFAULT_APP_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `NB_E2E_PORT must be an integer port, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

export const APP_PORT = readPort();

/** Origin form (no trailing slash) — also the storageState origin key. */
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
