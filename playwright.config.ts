import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
    // Playwright 1.60's device registry stops at iPhone 15 Pro Max, so the
    // current hardware is pinned by hand. iPhone 17 is 402x874 logical; the
    // web area is that minus Safari's ~193px of chrome. Wider AND taller than
    // iPhone 13, so it is not a "smaller viewport" guard — it exists because
    // it is what people actually hold, and because the safe-area insets differ.
    //
    // Scoped with testMatch on purpose: running all 155 specs on a third
    // device would add ~7 minutes to every night-loop tick for very little
    // extra signal. These three are the ones where a control that renders off
    // screen, under the bottom nav, or too small to tap would actually hide.
    {
      name: 'iPhone 17',
      use: {
        ...devices['iPhone 15 Pro'],
        viewport: { width: 402, height: 681 },
      },
      testMatch: /(mobile-controls|a11y-mobile|app-shell-smoke)\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
