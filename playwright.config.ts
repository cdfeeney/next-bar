import { defineConfig, devices } from '@playwright/test';
import { config as loadEnvFile } from 'dotenv';

// Next inlines NEXT_PUBLIC_* from .env.local at build time, so a spec that
// asserts on a flag-controlled surface has to read the same file or it is
// asserting against a build it cannot see. (photo-card.spec.ts, legacy photos.)
loadEnvFile({ path: '.env.local' });

const releaseMode = process.env.PLAYWRIGHT_RELEASE === '1';

// Every run starts its own server (see reuseExistingServer below), so the port
// only decides WHICH port that server binds. Pin PLAYWRIGHT_PORT when another
// checkout already holds 3000; unset, 3000 is used and the run fails loudly if
// it is taken.
// Validate rather than interpolate: `?? '3000'` only catches an UNSET var, so
// PLAYWRIGHT_PORT="" (the natural way to clear it) produced "http://localhost:"
// and a valueless --port flag. A bad value now fails loudly at config load
// instead of silently pointing the suite at a URL that cannot serve.
const rawPort = process.env.PLAYWRIGHT_PORT?.trim() ?? '';
const isPinnedPort = rawPort !== '';
if (isPinnedPort && !(/^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535)) {
  throw new Error(
    `PLAYWRIGHT_PORT must be an integer 1-65535, got ${JSON.stringify(process.env.PLAYWRIGHT_PORT)}`,
  );
}
const port = isPinnedPort ? rawPort : '3000';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  // The V9-11 evidence capture is a tool, not a check: it runs only when a
  // capture directory is named, and is ignored otherwise so the release gate
  // never reports its cases as "skipped" (a skip in the gate is a smell —
  // docs/V9-COVERAGE-AUDIT-2026-09-09.md §3).
  testIgnore: process.env.VISUAL_CAPTURE_DIR ? [] : ['**/visual-capture.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Release mode is the zero-retry gate, so it wins over CI. Written the other
  // way round (`CI ? 2 : 0`), `CI=1 PLAYWRIGHT_RELEASE=1` silently granted two
  // retries and a flake could pass the very gate that exists to catch it.
  retries: releaseMode ? 0 : process.env.CI ? 2 : 0,
  // Release mode is the ZERO-RETRY gate, so it must be deterministic. Every
  // page load hydrates the full bars catalog from Supabase, so parallel
  // workers starve the single server: at six workers vibe-vote timed out at
  // 16s where it needs 2.9s. Three workers fixed that and finish 402 tests in
  // ~8.7m. One worker was tried and is NOT viable — it did not finish inside
  // a 60-minute bound; two was measurably WORSE than three. Dev keeps full
  // parallelism. The one test that still felt this (bias-smoke) carries its
  // own enlarged budget rather than serialising the whole suite for it.
  //
  // Dev used to be `undefined` — 6 workers on this host, against its documented
  // "serialize heavy gates" rule, while other worktrees build concurrently. That
  // is the same starvation, so dev takes the same measured 3. There is no reason
  // for the command in CLAUDE.md's standard gate to be less reliable than the
  // release gate that wraps it.
  workers: process.env.CI ? 1 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // NOT 'on-first-retry': retries are 0 in release mode (the gate) and 0
    // locally, so a failing test only ever has attempt zero and no trace was
    // ever written — precisely when CLAUDE.md promises one. Retain on failure
    // instead, which does not depend on a retry existing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Pre-acknowledge the 21+ age gate (H1) for every spec — the overlay
    // would otherwise intercept the first click of all existing flows.
    // app-store-pack.spec.ts overrides this with an empty storageState to
    // test the gate itself. Specs that call localStorage.clear() re-seed
    // the key at the clear site.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [{ name: 'next-bar:age-ack:v1', value: '1' }],
        },
      ],
    },
  },
  projects: [
    {
      name: 'iPhone 13',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: releaseMode
      ? `npm run build && npm run start -- --port ${port}`
      : `npm run dev -- --port ${port}`,
    url: baseURL,
    // The suite tests the SHIPPED media policy, so the server under test is
    // always built with the legacy re-hosted-Google-photo cache off. Without
    // this the assertion depended on whoever's .env.local was on disk: the
    // operator's machine sets the flag, so the no-photo-cache guard quietly
    // asserted the non-compliant state instead of the policy (V8 AC 8).
    // Exercising the legacy path is a deliberate act — set it in a spec that
    // says so, not by inheriting ambient environment.
    env: { ...process.env, NEXT_PUBLIC_LEGACY_PHOTOS: '0' } as Record<string, string>,
    // NEVER reuse. This was `!releaseMode && !isPinnedPort`, and on 2026-08-16/17
    // it silently attached a dev run to a `next start -p 3000` left over from
    // ANOTHER worktree, so the suite measured a branch it had never checked out:
    // "424 tests, 124 failed" and a 21-failure cluster report, both of which
    // evaporated (138/138 green) once the run had its own server. A comment
    // warning about this trap was already sitting in this file and did not stop
    // it, so the default is now structural: if something else holds the port,
    // Playwright fails loudly with "is already used" instead of testing it.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
