/**
 * security-headers.spec.ts
 *
 * Asserts the application-owned security headers are actually SERVED on a
 * real HTTP response, not merely declared in `next.config.js`.
 *
 * Why this exists separately from `src/lib/securityHeaders.test.ts`: that
 * unit test loads the config object and checks its contents, which proves the
 * declaration is right but not that Next.js applies it. A typo in the
 * `source` pattern, a framework upgrade changing how `headers()` composes
 * with `redirects()`, or a platform layer stripping headers would all leave
 * the unit test green while the browser receives nothing. This spec closes
 * that gap by reading the response the browser actually gets.
 */

import { test, expect } from '@playwright/test';

/** Enforced immediately — none of these can break a working page. */
const REQUIRED_HEADERS: ReadonlyArray<[string, RegExp]> = [
  ['x-content-type-options', /^nosniff$/],
  ['x-frame-options', /^DENY$/],
  ['referrer-policy', /^strict-origin-when-cross-origin$/],
  ['strict-transport-security', /max-age=\d+/],
  ['permissions-policy', /geolocation=\(self\)/],
  ['content-security-policy-report-only', /default-src 'self'/],
];

test.describe('security headers', () => {
  test('are served on a real document response', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);

    const headers = res.headers();
    for (const [name, shape] of REQUIRED_HEADERS) {
      expect(headers[name], `missing header: ${name}`).toBeDefined();
      expect(headers[name], `unexpected value for ${name}`).toMatch(shape);
    }
  });

  test('the CSP is still REPORT-ONLY, not enforcing', async ({ request }) => {
    // Promotion to enforcing is a deliberate attended step (see the rationale
    // in next.config.js). If someone flips it, this should be a conscious
    // test update rather than a surprise outage.
    const headers = (await request.get('/')).headers();
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['content-security-policy-report-only']).toBeDefined();
  });

  test('the CSP admits every third-party origin the app really loads', async ({
    request,
  }) => {
    const csp = (await request.get('/')).headers()[
      'content-security-policy-report-only'
    ];

    // Each of these was either already required or was found MISSING by a
    // real failing run — the Leaflet tile host blanked /map, and the Places
    // UI Kit hosts are browser-side despite only appearing in Node scripts.
    expect(csp).toContain('https://*.basemaps.cartocdn.com');
    expect(csp).toContain('https://maps.googleapis.com');
    expect(csp).toContain('https://places.googleapis.com');
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('wss://*.supabase.co');
  });

  test('are served on API routes too, not just pages', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });
});
