import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware that refreshes Supabase auth sessions on every request.
 * Without this, `getUser()` from server components would see stale sessions
 * after the access token expires.
 *
 * No-ops when Supabase env vars are missing — keeps the app fully functional
 * in unauthenticated / local-dev mode without a Supabase project.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // Touching the session is what triggers the refresh. We don't need the
  // user object here — the side effect on cookies is the point.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Only routes that actually read a COOKIE session. The auth callback writes
  // the session cookie; /settings reads it. Anonymous-friendly content routes
  // (/, /quiz, /map, /rankings, /friends) skip middleware entirely to keep
  // navigations fast and avoid Next.js dev cold-compile races.
  //
  // `/api/:path*` was REMOVED (C2 audit F1b). The comment used to justify it
  // with "api routes may act on behalf of the user", but none of them do it
  // through a cookie:
  //   - api/account/delete authenticates a BEARER token and builds its own
  //     service-role client; it never reads request cookies.
  //   - api/waitlist, api/event and api/health are anonymous.
  // So the middleware refreshed a session no API route consumed, while giving
  // an attacker a free amplification lever: middleware runs BEFORE route
  // handlers, so no per-route limiter can gate it, and one forged
  // `sb-<ref>-auth-token` cookie turned every /api/* request into an outbound
  // Supabase call to /auth/v1/user. Measured during the audit: 0 outbound
  // calls with no cookie, 1 with a fabricated one.
  //
  // If a future API route ever needs a cookie session, add that exact path —
  // not the `/api/:path*` wildcard. `src/middleware.test.ts` additionally
  // asserts that no file under src/app/api imports a cookie-backed client, so
  // that invariant cannot rot silently.
  //
  // SCOPE OF THIS FIX, stated honestly (GLM review corrected an overclaim):
  // this REDUCES the amplification surface, it does not remove the lever. A
  // forged cookie aimed at `/settings/*` or `/auth/*` still costs one outbound
  // `getUser()` call, because the body below calls it unconditionally. What
  // changed is that the highest-volume, most-automatable paths (`/api/*`,
  // including the beacon endpoint) no longer carry that cost.
  //
  // The root fix is to stop making an unconditional network call: verify the
  // JWT's signature and expiry LOCALLY first and return early on a forged or
  // long-expired cookie, so a fabricated token costs zero outbound calls on
  // every path. That is an architecture change beyond this remediation and is
  // recorded as follow-up work, not silently skipped.
  //
  // Note also what the matcher is NOT: it is the cookie-REFRESH scope, not an
  // authorization boundary. Nothing here grants or denies access.
  matcher: ['/auth/:path*', '/settings/:path*'],
};
