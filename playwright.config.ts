import { defineConfig, devices } from '@playwright/test';
import { config as loadEnvFile } from 'dotenv';

// Next inlines NEXT_PUBLIC_* from .env.local at build time, so a spec that
// asserts on a flag-controlled surface has to read the same file or it is
// asserting against a build it cannot see. (photo-card.spec.ts, legacy photos.)
loadEnvFile({ path: '.env.local' });

const releaseMode = process.env.PLAYWRIGHT_RELEASE === '1';

// Port 3000 with reuseExistingServer is right for a single checkout, but when
// two worktrees of this repo run suites at once the second one silently
// ATTACHES TO THE FIRST ONE'S dev server and tests the other branch's code —
// observed as a spec passing, then failing unchanged minutes later. Pin
// PLAYWRIGHT_PORT to get a private server; unset, behavior is unchanged.
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
  workers: process.env.CI ? 1 : releaseMode ? 3 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
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
    // A pinned port means "give me my own server" — reusing whatever already
    // listens there would defeat the isolation it was pinned for.
    reuseExistingServer: !releaseMode && !isPinnedPort,
    timeout: 120_000,
  },
});
