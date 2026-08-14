import { defineConfig, devices } from '@playwright/test';

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
    // A pinned port means "give me my own server" — reusing whatever already
    // listens there would defeat the isolation it was pinned for.
    reuseExistingServer: !releaseMode && !isPinnedPort,
    timeout: 120_000,
  },
});
