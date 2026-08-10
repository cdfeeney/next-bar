import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
// Shared with e2e/tools/fence-global-setup.ts so the canary can never probe a
// different port than the one a run would reuse. See that module's header.
import { e2eGooglePort, e2ePort } from './e2e/tools/e2e-ports';

// Single source for the fence address — a split-coverage edit (browser fenced,
// server not) is exactly the gap the fence exists to close. The proxy's own
// default port in e2e/tools/fence-proxy.mjs must match.
const FENCE_PROXY = 'http://127.0.0.1:39555';

/**
 * Ports are overridable because sibling worktrees run e2e CONCURRENTLY.
 *
 * `webServer.reuseExistingServer` is true, so a run launched while another
 * worktree already holds the port silently binds to THAT worktree's dev
 * server — the suite then passes or fails on code the run never changed.
 * Observed 2026-08-08: :3000 was held by
 * C:\Users\cdfee\projects\nb-overnight-20260807 while this worktree ran.
 * Defaults are unchanged, so a single-worktree run behaves exactly as before.
 */
const E2E_PORT = e2ePort();
const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Second dev server, google-live ENABLED — the only way to exercise the
 * supported Google card in a browser.
 *
 * `NEXT_PUBLIC_GOOGLE_MEDIA` is inlined at compile time, so `resolveMedia`
 * cannot be switched to `google-live` per-test; it is a property of the
 * server. Turning it on for the MAIN server would flip every result card in
 * every unrelated spec, so the google-card scenarios get their own server
 * and their own projects instead.
 *
 * Nothing here reaches Google. The key is a syntactically-valid stub, the
 * fence proxy refuses every non-loopback request, and the specs install a
 * fake SDK before page scripts run. No live widget and no paid API is ever
 * invoked.
 */
const E2E_GOOGLE_PORT = e2eGooglePort();
const GOOGLE_BASE_URL = `http://localhost:${E2E_GOOGLE_PORT}`;
const GOOGLE_LIVE_ENV: Record<string, string> = {
  NEXT_PUBLIC_GOOGLE_MEDIA: '1',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-stub-maps-key-not-a-credential',
  GOOGLE_MEDIA_RUNTIME_ENABLED: '1',
};

/** Age-gate seeding is per-ORIGIN, so each server needs its own copy. */
const ageAckState = (origin: string) => ({
  cookies: [],
  origins: [
    {
      origin,
      localStorage: [{ name: 'next-bar:age-ack:v1', value: '1' }],
    },
  ],
});

/**
 * Stub Supabase credentials for worktrees with no `.env.local`.
 *
 * The signed-OUT auth specs (auth-page, auth-cross-context, and the
 * app-shell-smoke /settings case) stub `**​/auth/v1/**` at the route layer,
 * which only works if a browser client was constructed at all —
 * `getBrowserSupabase()` returns null when the two NEXT_PUBLIC vars are
 * missing, and every form then renders "Supabase env vars are missing"
 * instead of the state under test. Without this, those specs cannot pass in
 * a fresh git worktree, which is where most of this repo's work happens.
 *
 * Signed-IN specs are unaffected: `e2e/helpers/fakeAuth.ts` and its inline
 * twins read `.env.local` FROM DISK, not from process.env, and already
 * `test.skip()` when it is absent.
 *
 * FALLBACK ONLY — deliberately not applied when `.env.local` exists, so a
 * developer whose fakeAuth specs derive a project ref from that file keeps
 * the dev server and the cookie stubs agreed on one host.
 *
 * The host is unresolvable by construction and every auth call is
 * intercepted, so no spec can reach a real project. The key is a
 * syntactically valid but meaningless JWT — it is never verified by anything,
 * because nothing on the other end exists.
 */
const HAS_ENV_LOCAL = existsSync(path.join(__dirname, '.env.local'));

const STUB_SUPABASE_ENV: Record<string, string> = HAS_ENV_LOCAL
  ? {}
  : {
      NEXT_PUBLIC_SUPABASE_URL: 'https://e2e-stub-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: [
        Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
        Buffer.from('{"role":"anon","ref":"e2e-stub-project"}').toString('base64url'),
        'e2e-stub-signature-not-a-credential',
      ].join('.'),
    };

export default defineConfig({
  testDir: './e2e',
  // e2e/tools holds the fence's VITEST units (fence-proxy.test.ts) and infra —
  // Playwright's default testMatch would otherwise collect that .test.ts and
  // crash on the vitest import (santa: Codex). NOTE: projects that set their
  // own testIgnore OVERRIDE this root value and must repeat the exclusion.
  testIgnore: /e2e[\\/]tools[\\/]/,
  // Ensures the network fence is up and AUTHENTIC (banner-probed) before any
  // spec runs; spawns it if absent, aborts if an impostor holds the port, and
  // canary-checks that a REUSED dev server is fenced server-side.
  globalSetup: './e2e/tools/fence-global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // Network fence (overnight scope 2026-08-05): every non-loopback request
    // from a test browser is sent to the local refuse-all logging proxy
    // (e2e/tools/fence-proxy.mjs); loopback bypasses it. Tests must pass with
    // the fence up — no spec may depend on live Supabase/Vercel/Google.
    // Fail-closed: with the proxy down, non-loopback requests fail at
    // connect time instead of escaping.
    proxy: { server: FENCE_PROXY, bypass: 'localhost,127.0.0.1' },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Pre-acknowledge the 21+ age gate (H1) for every spec — the overlay
    // would otherwise intercept the first click of all existing flows.
    // app-store-pack.spec.ts overrides this with an empty storageState to
    // test the gate itself. Specs that call localStorage.clear() re-seed
    // the key at the clear site.
    storageState: ageAckState(BASE_URL),
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
      // Repeats the tools/ exclusion: a project-level testIgnore REPLACES the
      // root one rather than merging with it.
      // google-card.spec.ts is excluded here ON PURPOSE: it needs the
      // google-live dev server, and these projects run the MAIN one, where
      // NEXT_PUBLIC_GOOGLE_MEDIA is unset — so resolveMedia can never return
      // 'google-live' and every widget-state assertion would time out.
      // A project without testMatch collects **/*.spec.ts, and a
      // project-level testIgnore REPLACES the root one, so this exclusion has
      // to be repeated here rather than assumed. (santa: Claude/FABLE H1.)
      testIgnore: /(warmup\.setup\.ts|google-card\.spec\.ts|e2e[\\/]tools[\\/])/,
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
      dependencies: ['warmup'],
      // google-card.spec.ts is excluded here ON PURPOSE: it needs the
      // google-live dev server, and these projects run the MAIN one, where
      // NEXT_PUBLIC_GOOGLE_MEDIA is unset — so resolveMedia can never return
      // 'google-live' and every widget-state assertion would time out.
      // A project without testMatch collects **/*.spec.ts, and a
      // project-level testIgnore REPLACES the root one, so this exclusion has
      // to be repeated here rather than assumed. (santa: Claude/FABLE H1.)
      testIgnore: /(warmup\.setup\.ts|google-card\.spec\.ts|e2e[\\/]tools[\\/])/,
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
      // search-autohide added 2026-08-03 (goal g-90f908bc): pins the / search
      // bar's hide-on-scroll behavior — the covered-card defect it guards was
      // caught BY mobile-controls on this exact viewport, so its regression
      // pin runs here too.
      // account-content-conflict added 2026-08-06: a bottom-anchored dialog
      // (pb-24, above the fixed nav) stacking THREE controls, the lowest of
      // which — "Decide later" — is the 44px text button. That is the same
      // bottom-crowded shape as every spec above, and the choice sitting
      // closest to the nav is the non-destructive one, so a covered control
      // would push users toward the two irreversible buttons instead.
      // add-bar-overflow added 2026-08-07 (goal g-b9dc294e): the add-a-bar
      // modal is a full-screen dialog whose inner list is the only scrollable
      // region, and its acceptance criterion 6 is stated as "vertical
      // scrolling remains available on short viewports". 402x681 is the
      // shortest configured, so running it only on the taller two would test
      // everywhere except where scroll-lock and a wrapped multi-line heading
      // can actually squeeze the list out.
      testMatch:
        /(mobile-controls|a11y-mobile|app-shell-smoke|vibe-tweak-reachable|map-lightbox|map-interaction|exact-filter-empty|cancel-bottomnav|search-bars|install-sheet|search-autohide|quiz-path|onboarding-identity|account-content-conflict|add-bar-overflow)\.spec\.ts/,
      dependencies: ['warmup'],
    },
    // ---- google-live projects -------------------------------------------
    // These run against the SECOND dev server (google-live enabled) and are
    // the only projects that do. Scoped by testMatch so no other spec is
    // pulled onto a server whose media policy it was not written for.
    {
      name: 'google-warmup',
      testMatch: /warmup\.setup\.ts/,
      use: { ...devices['iPhone 13'], baseURL: GOOGLE_BASE_URL },
    },
    {
      name: 'google-live iPhone 13',
      use: {
        ...devices['iPhone 13'],
        baseURL: GOOGLE_BASE_URL,
        storageState: ageAckState(GOOGLE_BASE_URL),
      },
      testMatch: /google-card\.spec\.ts/,
      dependencies: ['google-warmup'],
    },
    {
      name: 'google-live Pixel 7',
      use: {
        ...devices['Pixel 7'],
        baseURL: GOOGLE_BASE_URL,
        storageState: ageAckState(GOOGLE_BASE_URL),
      },
      testMatch: /google-card\.spec\.ts/,
      dependencies: ['google-warmup'],
    },
  ],
  webServer: [{
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    // Server-side half of the network fence: the dev server's own outbound
    // fetch (undici) honors these ONLY because NODE_USE_ENV_PROXY=1 (Node
    // ≥24); raw-TCP clients (pg) are NOT covered — no app route uses one.
    // CAVEAT: reuseExistingServer means a dev server you started yourself,
    // without these vars, is NOT fenced server-side. Kill it first if the
    // egress guarantee matters for the run.
    env: {
      // Both cases: Node's built-in env-proxy gives lowercase precedence, so
      // an inherited lowercase http_proxy/no_proxy would silently win over
      // uppercase-only injection (santa round-2, Codex).
      HTTP_PROXY: FENCE_PROXY,
      http_proxy: FENCE_PROXY,
      HTTPS_PROXY: FENCE_PROXY,
      https_proxy: FENCE_PROXY,
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
      NODE_USE_ENV_PROXY: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      // Empty object when .env.local exists — see STUB_SUPABASE_ENV above.
      ...STUB_SUPABASE_ENV,
      // PINNED OFF, not merely unset. webServer.env merges with the parent
      // process env, so an exported NEXT_E2E_DIST=1 in the invoking shell
      // (easy to leave behind while debugging the google server) would put
      // BOTH servers back in .next-e2e-google with different
      // NEXT_PUBLIC_GOOGLE_MEDIA values — reviving the shared-chunk bug this
      // split exists to fix. (santa: Claude/FABLE M-3.)
      NEXT_E2E_DIST: '0',
      // Same reasoning, applied to the three gates that actually decide
      // whether a Google widget is created. Leaving them merely UNSET was
      // an inconsistency: `next dev` also reads `.env.local` / `.env`, so on
      // any machine whose .env.local carries real Google credentials this
      // server would compile a Google-ON bundle and every main-server spec
      // would silently exercise the google-live card instead of the ordinary
      // one — passing either way, because those specs never assert Google
      // media is off. Browser egress is separately fenced (`use.proxy` above),
      // so this was never a billing exposure. (santa: GLM.)
      //
      // TWO LIMITS, so this is not misread as a guarantee (santa: Codex):
      //  - `reuseExistingServer: true` skips `command` AND this `env`
      //    entirely. A dev server you started yourself from a Google-enabled
      //    .env.local is adopted as-is and these pins never apply — same
      //    caveat as the fence note above. Kill a foreign server first if the
      //    guarantee matters.
      //  - On a checkout whose .env.local DOES enable Google media, pinning it
      //    off here newly fails google-photo-layout.spec.ts: that spec is still
      //    collected by the main projects but waits on a node only the
      //    google-live branch renders. It already fails at HEAD for the same
      //    reason, and its fix — moving it onto the google-live projects and
      //    repairing its one-shot isVisible() race — is tracked separately.
      //
      // Verified 2026-08-08: none of these three variables appear in the
      // operator's .env.local, so neither limit bites today.
      NEXT_PUBLIC_GOOGLE_MEDIA: '',
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '',
      GOOGLE_MEDIA_RUNTIME_ENABLED: '',
    },
  },
  {
    // google-live server. Same fence, same stubs, plus the three variables
    // that make the supported Google card reachable at all.
    //
    // NOTE: Playwright has no project-to-webServer linkage — EVERY entry in
    // this array is started and health-checked on EVERY run, including a run
    // that selects only a main-server project. So this costs a second dev
    // server each time, and E2E_GOOGLE_PORT must be varied per worktree for
    // exactly the same reason E2E_PORT must: otherwise two concurrent
    // worktrees silently share this server through `reuseExistingServer`.
    // (santa: Claude/FABLE M1 — the previous comment claimed Playwright
    // skipped unselected servers, which it does not.)
    command: `npm run dev -- --port ${E2E_GOOGLE_PORT}`,
    url: GOOGLE_BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      HTTP_PROXY: FENCE_PROXY,
      http_proxy: FENCE_PROXY,
      HTTPS_PROXY: FENCE_PROXY,
      https_proxy: FENCE_PROXY,
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
      NODE_USE_ENV_PROXY: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      ...STUB_SUPABASE_ENV,
      ...GOOGLE_LIVE_ENV,
      // Its OWN build directory. Both dev servers run in this one project
      // directory and `NEXT_PUBLIC_*` is inlined at COMPILE time, so sharing
      // `.next` meant this server served chunks the MAIN server had already
      // compiled with NEXT_PUBLIC_GOOGLE_MEDIA unset — the google-live card
      // silently degraded to the ordinary card and the widget host never
      // rendered. Whichever server compiled a route first won, which is why
      // it looked like flake. See next.config.js `distDir`.
      //
      // A boolean flag, not a path: next.config.js selects between two
      // known-good directories, so no environment can inject an arbitrary
      // build path into a real deploy.
      NEXT_E2E_DIST: '1',
    },
  }],
});
