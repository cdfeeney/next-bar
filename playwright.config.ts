import { defineConfig, devices } from '@playwright/test';

const releaseMode = process.env.PLAYWRIGHT_RELEASE === '1';

// Port is overridable so two worktrees of this repo can run e2e at the same
// time. Defaults to 3000, so nothing changes unless it is set.
//
// Both spellings are accepted (V8-2 round-1, Claude + GLM): a run recorded as
// `PLAYWRIGHT_PORT=3612` silently fell back to 3000, and in dev mode
// `reuseExistingServer` then tests whatever server another worktree already
// has on 3000 — a false green with no error to notice.
const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
    reuseExistingServer: !releaseMode,
    timeout: 120_000,
  },
});
