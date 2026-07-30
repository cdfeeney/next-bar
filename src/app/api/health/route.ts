import { NextResponse } from 'next/server';

/**
 * /api/health — deploy smoke-check endpoint (H1 App-Store pack + the T0
 * post-deploy gate in the ops workflow): confirms the app serves and that
 * Supabase is reachable, and identifies WHICH build is answering via the
 * commit sha (Vercel injects VERCEL_GIT_COMMIT_SHA at build time; local
 * dev reports 'dev').
 *
 * Read-only by design: the Supabase probe hits the public auth health
 * endpoint with the anon context — no table access, no service role, no
 * writes. Response never includes secrets or env internals beyond the sha.
 */

export const dynamic = 'force-dynamic';

const SUPABASE_PROBE_TIMEOUT_MS = 3_000;
// Module-scope probe cache (DeepSeek N2 review): without it every inbound
// hit spawned an outbound Supabase fetch — a free 1:1 cost-amplification
// lever against both the Vercel function bill and Supabase's health
// endpoint. 30s staleness is irrelevant for a smoke check.
const PROBE_CACHE_TTL_MS = 30_000;

type SupabaseHealth = 'ok' | 'unreachable' | 'unconfigured';

let cachedProbe: { value: SupabaseHealth; until: number } | null = null;
// Single-flight (C2 audit F7): the cache above is only written AFTER the
// await, so N requests arriving inside one probe's flight all missed the
// cache and each fired their own outbound fetch — exactly the 1:1
// amplification the cache was added to stop, and worst precisely when
// traffic spikes. Parking the in-flight PROMISE here collapses that burst
// into one call; everyone awaits the same result.
let inFlightProbe: Promise<SupabaseHealth> | null = null;

async function runProbe(url: string, anonKey: string): Promise<SupabaseHealth> {
  let value: SupabaseHealth;
  try {
    // apikey header is REQUIRED: the Supabase gateway 401s /auth/v1/health
    // without it (caught by the first prod smoke check — a healthy backend
    // read as 'unreachable'). The anon key is the public client key.
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: AbortSignal.timeout(SUPABASE_PROBE_TIMEOUT_MS),
      cache: 'no-store',
      headers: { apikey: anonKey },
    });
    value = res.ok ? 'ok' : 'unreachable';
  } catch {
    value = 'unreachable';
  }
  cachedProbe = { value, until: Date.now() + PROBE_CACHE_TTL_MS };
  return value;
}

async function probeSupabase(): Promise<SupabaseHealth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return 'unconfigured';
  if (cachedProbe && Date.now() < cachedProbe.until) return cachedProbe.value;
  if (inFlightProbe) return inFlightProbe;

  // finally, not .then: the slot must clear even if runProbe throws, or one
  // unexpected failure would pin a rejected promise as the answer forever.
  inFlightProbe = runProbe(url, anonKey).finally(() => {
    inFlightProbe = null;
  });
  return inFlightProbe;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await probeSupabase();
  // 'unconfigured' is a legal local/preview state, not an outage — only an
  // unreachable configured backend fails the health check.
  const ok = supabase !== 'unreachable';

  return NextResponse.json(
    {
      ok,
      supabase,
      // 12-char prefix (DeepSeek N2 review): plenty to match a deploy
      // against git for the smoke check, without handing out the exact
      // full revision for version-targeted reconnaissance.
      // `||`, not `??`: a build system that sets the var to an EMPTY string
      // has told us nothing, and reporting sha:"" would defeat the whole
      // point of this field — matching a deploy against git.
      sha: (
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.NEXT_PUBLIC_BUILD_SHA ||
        'dev'
      ).slice(0, 12),
      at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
