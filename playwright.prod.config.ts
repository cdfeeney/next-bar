import { defineConfig, devices } from '@playwright/test';

/**
 * N3 (night-5): READ-ONLY production smoke suite.
 *
 * Run on demand after any deploy:
 *
 *   npx playwright test --config playwright.prod.config.ts
 *
 * Points at the LIVE site (override with PROD_URL), no webServer, and a
 * dedicated testDir so the normal local sweep (testDir ./e2e) can never
 * hit production by accident. Assertions are render/status checks only —
 * NO writes, NO auth, NO storage mutations beyond the age-ack gate flag.
 */
export default defineConfig({
  testDir: './e2e-prod',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PROD_URL ?? 'https://next-bar-two.vercel.app',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'iPhone 13',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
