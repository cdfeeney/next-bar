#!/usr/bin/env node
/**
 * `npm run test:e2e:release` — Playwright against a RELEASE build.
 *
 * This wrapper exists because npm scripts have no portable way to set an
 * environment variable: `PLAYWRIGHT_RELEASE=1 playwright test` is sh syntax and
 * Connor is on Windows, where npm runs scripts through cmd. No new dependency
 * for that (cross-env would be one) — node can set its own child's env.
 *
 * Two things it guarantees that the bare `test:e2e` script does not:
 *   1. PLAYWRIGHT_RELEASE=1, so playwright.config.ts takes the `npm run build
 *      && npm run start` path instead of the dev server. The dev-server path is
 *      known red (the /quiz cold-compile flake in CLAUDE.md); a failure there is
 *      an artifact of the script, not of the change under test.
 *   2. A FREE port when the caller did not pin one. Defaulting to 3000 lets two
 *      worktrees test each other's server — a false green with nothing to
 *      notice. A caller-supplied PLAYWRIGHT_PORT always wins.
 *
 * Every argument is forwarded, so targeted runs work:
 *   npm run test:e2e:release -- e2e/friends-flow.spec.ts --reporter=list
 */
import { spawnSync } from 'node:child_process';
import net from 'node:net';

// ponytail: ask the OS for an ephemeral port and hand it straight over. There
// is a race between closing this listener and Next binding the port; a retry
// loop only matters if it ever actually collides.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

const port = process.env.PLAYWRIGHT_PORT ?? (await freePort());
const args = process.argv.slice(2);

console.log(`[e2e:release] PLAYWRIGHT_RELEASE=1 PLAYWRIGHT_PORT=${port} playwright test ${args.join(' ')}`);

const result = spawnSync('npx', ['playwright', 'test', ...args], {
  stdio: 'inherit',
  shell: true, // npx is a .cmd shim on Windows
  env: { ...process.env, PLAYWRIGHT_RELEASE: '1', PLAYWRIGHT_PORT: port },
});

process.exit(result.status ?? 1);
