import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The two clients the media routes need, and the difference between them.
 *
 * CALLER-SCOPED ({@link callerClient}) is the default. It carries the caller's
 * own access token, so every policy in 0065 and 0066 evaluates against
 * `auth.uid()` and the database stays the authority on who may read, remove or
 * delete. Every RPC in this lane is SECURITY DEFINER with an author check
 * inside it; handing those a service-role client would skip the check they
 * exist to perform.
 *
 * SERVICE-ROLE ({@link adminClient}) is used for exactly two things a
 * caller-scoped client cannot do and must not do: writing the `media_objects`
 * registry row for bytes the server itself just verified (the table has no
 * INSERT policy on purpose — a client that can write its own row can declare
 * its own content_type and defeat V8-R-STO-014), and removing bytes the
 * database has already ruled reclaimable.
 *
 * SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next.js cannot
 * bundle it into client code. It is read here and nowhere near a component.
 */

export type MediaEnv = {
  url: string;
  anonKey: string;
  serviceKey: string;
};

/** Null when this deployment is not configured for media — an honest 503. */
export function readMediaEnv(): MediaEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return null;
  return { url, anonKey, serviceKey };
}

/** The bearer token on this request, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function adminClient(env: MediaEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client that acts AS the caller. Requests carry their access token, so RLS
 * and every definer function's `auth.uid()` see the real user.
 */
export function callerClient(env: MediaEnv, token: string): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Verify the token really is a live session for THIS project and return its
 * user id.
 *
 * The identity comes from the VERIFIED token and never from the request body:
 * an id in a payload is a claim, and this is the boundary that stops it being
 * treated as one.
 */
export async function verifiedUserId(
  admin: SupabaseClient,
  token: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error) return null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
