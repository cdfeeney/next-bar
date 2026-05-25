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
  // For v0.5.0 we only need session refresh on routes that read the session.
  // Auth callback writes the session cookie; /settings reads it; /api routes
  // may act on behalf of the user. Anonymous-friendly content routes (/,
  // /quiz, /map, /rankings, /friends) skip middleware entirely to keep
  // navigations fast and avoid Next.js dev cold-compile races.
  matcher: ['/auth/:path*', '/settings/:path*', '/api/:path*'],
};
