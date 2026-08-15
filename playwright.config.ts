import { defineConfig, devices } from '@playwright/test';

const releaseMode = process.env.PLAYWRIGHT_RELEASE === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // Release mode is the ZERO-RETRY gate, so it must be deterministic. Every
  // page load hydrates the full bars catalog from Supabase, so parallel
  // workers starve the single server: at six workers vibe-vote timed out at
  // 16s where it needs 2.9s. Three workers fixed that and finish 402 tests in
  // ~8.7m. One worker was tried and is NOT viable — it did not finish inside
  // a 60-minute bound. Dev keeps full parallelism.
  workers: process.env.CI ? 1 : releaseMode ? 3 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
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
          origin: 'http://localhost:3000',
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
    command: releaseMode ? 'npm run build && npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !releaseMode,
    timeout: 120_000,
  },
});
