import { describe, expect, it } from 'vitest';
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
  it('covers exactly the routes that read a COOKIE session', () => {
    expect(config.matcher).toEqual(['/auth/:path*', '/settings/:path*']);
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
