/**
 * Dev-server warm-up (g-65a31bdf test-infra).
 *
 * Every project depends on this one, so it runs FIRST and alone. It visits
 * every app route once, forcing the Next dev server to compile the full
 * module graph before any real spec interacts with a page.
 *
 * Why: on a cold dev server, the FIRST hit of a route compiles it
 * on demand — and when that happens while another worker's page is
 * mid-interaction, Fast Refresh can answer a shared-module rebuild with a
 * FULL RELOAD of connected pages ("performing full reload", verified via
 * Playwright trace). That reload resets controlled forms and interrupts
 * navigations, which manifested as WebKit-heavy flakes in onboarding,
 * settings, and the catalog-swap polls. Production builds have no
 * on-demand compilation, so this is purely a dev/test artifact — warmed
 * once here, the whole class disappears.
 */

import { test, expect } from '@playwright/test';

// Every static route from src/app (find src/app -name page.tsx). A missed
// route is a live flake vector — its first-hit compile mid-suite can still
// full-reload other workers' pages (santa: Codex round 2).
const ROUTES = [
  '/',
  '/auth',
  '/friends',
  '/friends/consensus',
  '/friends/followers',
  '/friends/following',
  '/install',
  '/join',
  '/lists',
  '/map',
  '/onboarding',
  '/privacy',
  '/quiz',
  '/rankings',
  '/search',
  '/settings',
  '/terms',
  '/tried',
  '/where-next',
];

// Dynamic routes: a concrete param compiles the route module; the probe
// may legitimately 404 for an unknown entity, so only 5xx (compile
// failure) is fatal here.
const DYNAMIC_ROUTES = ['/share/attaboy', '/u/e2e-warmup', '/u/e2e-warmup/night/warm'];

test('warm every route once', async ({ request }) => {
  test.setTimeout(240_000);
  // Plain HTTP GETs, not page.goto: the dev compile happens on the request
  // regardless of a browser, and several pages fire their own client-side
  // navigations shortly after load, which turn sequential gotos into
  // interrupted-navigation errors — the very flake class being fixed.
  for (const route of ROUTES) {
    const res = await request.get(route);
    // 2xx/3xx only — a route that 500s on compile should fail loudly here,
    // not as a mystery mid-suite.
    expect(res.status(), `${route} status`).toBeLessThan(400);
  }
  for (const route of DYNAMIC_ROUTES) {
    const res = await request.get(route);
    expect(res.status(), `${route} status`).toBeLessThan(500);
  }
});
