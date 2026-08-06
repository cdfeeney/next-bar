import { NextResponse, type NextRequest } from 'next/server';
import { mediaMetricRateLimited } from '@/lib/mediaMetric.server';

/**
 * Advisory Google-media request counter → structured Vercel log lines.
 *
 * One POST per widget creation (client: src/lib/mediaMetric.ts). The
 * payload is the surface enum and nothing else; this route exists so the
 * operator can grep Vercel function logs for request volume per surface.
 * Google Cloud's SKU metrics remain the AUTHORITATIVE usage/billing meter
 * (docs/GOOGLE-MEDIA-RUNBOOK.md) — this is a smoke detector, not the bill.
 *
 * Hard bounds (santa BLOCK, 2026-08-06 — no fake observability, no abuse
 * surface): same-origin only, tiny body, enum-validated, per-instance
 * rate-limited. Rejections are cheap and terminal; the client never
 * retries. No database, no migration, no product-analytics reuse.
 */

/** The only billing surface in this release. */
const SURFACES = new Set(['result-card']);

const MAX_BODY_BYTES = 64;

/** Same-origin check: the Origin header must match the host this function
 *  is serving. Beacons/fetches from our own pages always satisfy this;
 *  cross-site posts are rejected before any parsing. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }
  if (mediaMetricRateLimited(Date.now())) {
    return new NextResponse(null, { status: 429 });
  }

  let surface: string;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { surface?: unknown }).surface !== 'string'
    ) {
      return new NextResponse(null, { status: 400 });
    }
    surface = (parsed as { surface: string }).surface;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!SURFACES.has(surface)) {
    return new NextResponse(null, { status: 400 });
  }

  // The structured line Vercel captures. Surface enum + timestamp — nothing
  // else is accepted, so nothing else can leak into logs.
  console.log(
    JSON.stringify({
      type: 'google-media-request',
      surface,
      at: new Date().toISOString(),
    }),
  );
  return new NextResponse(null, { status: 204 });
}
