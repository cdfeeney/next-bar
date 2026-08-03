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
    // Compiles every route on the cold dev server BEFORE any real spec
    // runs — see e2e/warmup.setup.ts for the Fast Refresh full-reload
    // artifact this eliminates. Every device project depends on it.
    {
      name: 'warmup',
      testMatch: /warmup\.setup\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'iPhone 13',
      use: { ...devices['iPhone 13'] },
      dependencies: ['warmup'],
      testIgnore: /warmup\.setup\.ts/,
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
      dependencies: ['warmup'],
      testIgnore: /warmup\.setup\.ts/,
    },
    // Marketing/legal routes are read on DESKTOPS too (links get opened on
    // laptops far more than app surfaces do), and until 2026-08-03 nothing
    // exercised them above a phone viewport (g-43d6da5f crit 2 audit
    // finding). Scoped tight: only the marketing-route spec.
    {
      name: 'Desktop marketing',
      use: { ...devices['Desktop Chrome'] },
      // app-shell-smoke included deliberately (santa: Codex): it holds the
      // actual /install marketing-route test — app-store-pack alone visits
      // /, /map and the legal pages, which left the audit's "desktop
      // marketing coverage" claim technically hollow.
      testMatch: /(app-store-pack|app-shell-smoke)\.spec\.ts/,
      dependencies: ['warmup'],
    },
    // Playwright's device registry stops at iPhone 15 Pro Max (checked again on
    // the 1.62 upgrade), so the current hardware is pinned by hand. The manual
    // viewport below is what makes this project correct regardless of what the
    // registry gains later. iPhone 17 is 402x874 logical; the
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
      // vibe-tweak-reachable added 2026-07-31 (goal g-44007df6): its whole
      // subject is a control row sitting under the fixed bottom nav on a SHORT
      // viewport, and 402x681 is the shortest configured — running it only on
      // the taller two would test everywhere except where the bug lives. One
      // extra spec, consistent with the scoping rationale above.
      // map-lightbox added 2026-07-31 (goal g-5ead112c): the lightbox is a
      // full-screen overlay whose action row sits at the bottom, so the
      // shortest configured viewport is exactly where it would fail first —
      // the same class of defect vibe-tweak-reachable was added for.
      // map-interaction added 2026-07-31 (goal g-12d33864): /map's filter
      // control became MapFilterSheet, a sheet whose Apply/Cancel row is its
      // LAST child — the identical shape as vibe-tweak-reachable above, and
      // therefore the identical way to fail on the shortest viewport. Its
      // acceptance criteria are stated at 402x681, so running it only on the
      // taller two would have tested everywhere except where it can break.
      // exact-filter-empty added 2026-08-02 (goal g-6cc99120): the recovery
      // card carries two 44px action buttons above the map — the same
      // bottom-crowded control shape as the specs above, so it must run on
      // the shortest configured viewport too.
      // cancel-bottomnav added 2026-08-02 (goal g-2c788c17): its entire
      // subject is Apply/Cancel-vs-fixed-nav geometry, stated at 402x681.
      // search-bars added 2026-08-03 (goal g-7b6021a8): the acceptance is
      // stated at 402x681 (compact-mobile search + save reachability).
      // install-sheet added 2026-08-03 (goal g-43d6da5f): a BOTTOM sheet
      // whose primary control sits exactly where the fixed nav lives —
      // the same bottom-crowded shape as every spec above.
      testMatch:
        /(mobile-controls|a11y-mobile|app-shell-smoke|vibe-tweak-reachable|map-lightbox|map-interaction|exact-filter-empty|cancel-bottomnav|search-bars|install-sheet)\.spec\.ts/,
      dependencies: ['warmup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
