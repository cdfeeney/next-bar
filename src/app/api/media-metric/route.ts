import { NextResponse, type NextRequest } from 'next/server';
import {
  contentLengthExceeds,
  mediaMetricRateLimited,
  readBoundedBody,
} from '@/lib/mediaMetric.server';
import { guardOrigin } from '@/lib/requestBoundary';

/**
 * Advisory Google-media request counter → structured Vercel log lines.
 *
 * One POST per widget creation (client: src/lib/mediaMetric.ts). The
 * payload is the surface enum and nothing else; this route exists so the
 * operator can grep Vercel function logs for request volume per surface.
 * Google Cloud's SKU metrics remain the AUTHORITATIVE usage/billing meter
 * (docs/GOOGLE-MEDIA-RUNBOOK.md) — this is a smoke detector, not the bill.
 *
 * Hard bounds, each matching its implementation exactly:
 * - Same-origin only, via the SHARED `guardOrigin` policy gate: Origin's host
 *   must equal the request's PUBLIC host — x-forwarded-host (first entry of a
 *   forwarding chain) when present, else Host — compared case-insensitively,
 *   or be one of the documented native-shell origins. Absent, malformed, or
 *   mismatched origins → 403 before any body handling.
 * - Body capped at 64 actual UTF-8 BYTES: an honest oversized
 *   Content-Length is rejected before reading; a missing, chunked, or
 *   dishonest Content-Length is caught by an incremental bounded stream
 *   read that cancels the moment the cap is crossed. Decoding happens only
 *   after the bounded read. Raw request bodies are NEVER logged.
 * - Surface must be a known enum value; per-instance rate window (429).
 * Rejections are cheap and terminal; the client never retries. No
 * database, no migration, no product-analytics reuse.
 */

/** The only billing surface in this release. */
const SURFACES = new Set(['result-card']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  // This route's own inline `sameOrigin` helper was replaced by the shared
  // policy gate. Keeping a second origin implementation was not merely
  // duplication: it compared `new URL(origin).host` against the public host,
  // and for `capacitor://localhost` that host is `localhost`, which never
  // matches — so the native shell's media beacons were silently 403'd and the
  // operator's billing smoke detector undercounted native usage. Sharing the
  // gate fixes that and keeps all mutating routes on one posture (strict: no
  // `allowAbsent`, because only the app's own widget code posts here).
  const blocked = guardOrigin(req.headers, () =>
    new NextResponse(null, { status: 403 }),
  );
  if (blocked) return blocked;
  if (mediaMetricRateLimited(Date.now())) {
    return new NextResponse(null, { status: 429 });
  }

  // Honest oversize declared up front: refuse before reading a byte.
  if (contentLengthExceeds(req.headers.get('content-length'))) {
    return new NextResponse(null, { status: 413 });
  }
  // Everything else: enforce on actual bytes, incrementally.
  const read = await readBoundedBody(req.body);
  if (read.kind === 'too-large') {
    return new NextResponse(null, { status: 413 });
  }
  // A client that drops mid-body used to escape as a rejection and surface as
  // a 500. The shared boundary now reports it, so it answers as the cheap,
  // terminal 400 every other malformed request here already gets. This is the
  // one behavior change outside the header layer, and it replaces an
  // unhandled server error rather than altering a working path.
  if (read.kind === 'stream-error') {
    return new NextResponse(null, { status: 400 });
  }

  let surface: string;
  try {
    const raw = new TextDecoder().decode(read.bytes);
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
  // else is accepted, so nothing else can reach the logs; the raw body is
  // never logged on any path.
  console.log(
    JSON.stringify({
      type: 'google-media-request',
      surface,
      at: new Date().toISOString(),
    }),
  );
  return new NextResponse(null, { status: 204 });
}
