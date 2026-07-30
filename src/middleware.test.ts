import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { config } from './middleware';

/**
 * The middleware MATCHER is a security control, not routing trivia (C2 audit
 * F1b). Middleware runs before route handlers, so nothing a route does can
 * gate it: every path the matcher covers is a path where one forged
 * `sb-<ref>-auth-token` cookie buys an outbound Supabase call to
 * /auth/v1/user. The audit measured it — 0 outbound calls with no cookie, 1
 * with a fabricated one — so the matcher is the only place that cost is
 * controlled.
 *
 * These assertions are deliberately negative. The regression they exist to
 * catch is someone re-adding a broad wildcard for convenience.
 */
describe('middleware matcher', () => {
  it('covers the routes that read a COOKIE session', () => {
    // Membership, NOT equality (GLM review). An equality assertion encodes
    // what the array *is*, not the invariant that matters. A maintainer
    // legitimately adding `/admin/:path*` would see an equality test fail and
    // face two options — update it thoughtfully, or delete the assertion.
    // Under deadline pressure the second is likelier, and deleting it takes
    // the `/api` exclusion below with it. The security boundary is "no /api",
    // not "exactly these two", so assert the boundary.
    expect(config.matcher).toEqual(
      expect.arrayContaining(['/auth/:path*', '/settings/:path*']),
    );
  });

  it('does NOT cover /api — no API route consumes a cookie session', () => {
    // api/account/delete authenticates a Bearer token and builds its own
    // service-role client; waitlist, event and health are anonymous. A
    // wildcard here would refresh a session nobody reads while handing out a
    // free, un-gateable amplification lever.
    expect(config.matcher).not.toContain('/api/:path*');
    for (const pattern of config.matcher) {
      expect(pattern.startsWith('/api')).toBe(false);
    }
  });

  it('does not cover the anonymous content routes', () => {
    // These are the hot paths. Middleware on them costs latency on every
    // navigation and buys nothing, since they render signed-out.
    for (const route of ['/', '/quiz', '/map', '/rankings', '/friends', '/install']) {
      const covered = config.matcher.some((pattern) => {
        const prefix = pattern.replace('/:path*', '');
        return route === prefix || route.startsWith(`${prefix}/`);
      });
      expect(covered, `${route} must not be matched`).toBe(false);
    }
  });

  it('still covers the two routes that genuinely need a session refresh', () => {
    // /auth/callback writes the session cookie; /settings reads it. Dropping
    // either would break sign-in or silently serve a stale session.
    for (const route of ['/auth/callback', '/settings']) {
      const covered = config.matcher.some((pattern) => {
        const prefix = pattern.replace('/:path*', '');
        return route === prefix || route.startsWith(`${prefix}/`);
      });
      expect(covered, `${route} must be matched`).toBe(true);
    }
  });
});

describe('no /api route may consume a COOKIE session', () => {
  /**
   * The companion guard to the matcher test (raised independently by GLM and
   * Kimi). Removing `/api/:path*` from the matcher is only safe while no API
   * route reads a cookie session. The matcher test cannot see that: it asserts
   * the matcher, not the routes. Without this, a future
   * `import { createClient } from '@/lib/supabase/server'` inside an API route
   * would half-work — the handler would read whatever cookie happened to be
   * present, unrefreshed — and no test would notice.
   *
   * Deliberately a source check rather than a lint rule: it lives with the
   * assertion it protects, and it fails with an explanation instead of a
   * generic lint code.
   */
  const API_DIR = join(process.cwd(), 'src/app/api');

  function routeFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.isFile() && /^route\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('finds the API routes it is meant to be guarding', () => {
    // A guard that silently scans nothing passes forever. Pin that it sees them.
    expect(routeFiles(API_DIR).length).toBeGreaterThanOrEqual(4);
  });

  it.each(routeFiles(API_DIR).map((f) => [relative(process.cwd(), f), f]))(
    '%s does not import a cookie-backed Supabase client',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/@\/lib\/supabase\/server/);
      expect(src).not.toMatch(/@supabase\/ssr/);
      expect(src).not.toMatch(/createServerClient/);
      // next/headers cookies() is the other way to reach the same place.
      expect(src).not.toMatch(/from ['"]next\/headers['"]/);
    },
  );
});
