import { NextResponse } from 'next/server';

/**
 * Runtime feature flags — a PER-DEPLOYMENT permission gate for google-live
 * media (see docs/GOOGLE-MEDIA-RUNBOOK.md and mediaPolicy.ts's
 * build-time-inlining note).
 *
 * What this IS: a server-decided, fail-closed gate the client cannot spoof
 * or inline — the value never ships in a client bundle, and per-request
 * evaluation keeps it out of the static build output.
 *
 * What this IS NOT (verified operational fact, operator 2026-08-06): a
 * no-redeploy kill switch on Vercel. Environment-variable changes apply
 * only to NEW deployments — an existing deployment keeps the value it was
 * created with, so flipping GOOGLE_MEDIA_RUNTIME_ENABLED requires a new
 * deployment to take effect. This flag cannot stop use of a copied key.
 * Provider-side restrictions and verified project quotas control that risk;
 * do not assume a per-key daily quota or an immediate dollar cap exists.
 * A true runtime store (e.g. Edge Config) is a
 * possible future transport and must be separately authorized.
 *
 * FAIL-CLOSED by construction: the variable must be exactly '1' to enable;
 * absent, empty, or anything else reads as disabled. The client treats any
 * fetch failure the same way (placesUiKit.isRuntimeGoogleMediaEnabled).
 *
 * The short shared cache keeps a scroll burst from hammering the function.
 */
/**
 * LOAD-BEARING: without this, Next statically prerenders the route (it uses
 * no dynamic API), freezing the response INTO THE BUILD OUTPUT — one step
 * worse than the per-deployment env freeze documented above, because the
 * client-visible flag would then survive even paths that re-run the
 * function. The build output must show `ƒ /api/flags`, never `○`. (Same
 * failure class as the archived /discover redirect, g-12d33864: static
 * output that only LOOKS runtime.)
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
