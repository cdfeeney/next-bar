import { NextResponse } from 'next/server';

/**
 * Runtime feature flags — the D1 kill-switch transport (see
 * docs/UI-KIT-BUILD-PLAN.md and mediaPolicy.ts's build-time-inlining note).
 *
 * NEXT_PUBLIC_* flags are inlined at build time, so flipping one requires a
 * redeploy — too slow for a cost circuit-breaker on a public, spoofable
 * browser key. This route reads a SERVER-ONLY variable at request time, so
 * the operator can cut google-live media off in about one cache-TTL without
 * touching the build.
 *
 * FAIL-CLOSED by construction: the variable must be exactly '1' to enable;
 * absent, empty, or anything else reads as disabled. The client treats any
 * fetch failure the same way (placesUiKit.isRuntimeGoogleMediaEnabled).
 *
 * The short shared cache keeps a scroll burst from hammering the function
 * while bounding how long a kill takes to propagate.
 */
/**
 * LOAD-BEARING: without this, Next statically prerenders the route (it uses
 * no dynamic API), baking the env value into the BUILD — which silently
 * recreates the exact inlining problem this route exists to escape. The
 * build output must show `ƒ /api/flags`, never `○`. (Same failure class as
 * the archived /discover redirect, g-12d33864: static output that only
 * LOOKS runtime.)
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const googleMedia = process.env.GOOGLE_MEDIA_RUNTIME_ENABLED === '1';
  return NextResponse.json(
    { googleMedia },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    },
  );
}
