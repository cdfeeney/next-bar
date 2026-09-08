import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { clientIpFromHeaders, createIpRateLimiter } from '@/lib/waitlistGuard';
import { isRoutingCoords, searchRoutes } from '@/lib/routeSearch';
import { ROUTE_CANDIDATE_CAP } from '@/lib/travelTime';

export const dynamic = 'force-dynamic';
const perIp = createIpRateLimiter({ limit: 6, windowMs: 60_000 });
const perInstance = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
function enabled(): boolean {
  // Pilot only. Production needs measured quality, terms and an account-level
  // hard quota. ponytail: warm-instance limits are NOT a distributed spend cap.
  return process.env.NEXT_BAR_ROUTING_ENABLED === 'true' &&
    process.env.VERCEL_ENV !== 'production' && !!process.env.ORS_API_KEY;
}
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET() { return reply({ enabled: enabled() }); }
export async function POST(request: Request) {
  if (!enabled()) return reply({ error: 'routing_disabled' }, 503);
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'invalid_request' }, 403);
  if (!perIp.allow(clientIpFromHeaders(request.headers)) || !perInstance.allow('all')) return reply({ error: 'rate_limited' }, 429);
  let body;
  try {
    // Enforce actual bytes, not a client-supplied Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'invalid_request' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return reply({ error: 'request_too_large' }, 413); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply({ error: 'invalid_request' }, 400); }
  if (!body || !isRoutingCoords(body.origin) ||
      !['walking', 'driving'].includes(body.mode) || typeof body.walkableOnly !== 'boolean' ||
      (body.walkableOnly && body.mode !== 'walking') || !Array.isArray(body.ids) ||
      (body.band !== undefined && (!['walkable', 'cab', 'anywhere', 'nearby'].includes(body.band) ||
        body.walkableOnly !== (body.band === 'walkable') ||
        body.mode !== (body.band === 'cab' ? 'driving' : 'walking'))) ||
      body.ids.length < 1 || body.ids.length > ROUTE_CANDIDATE_CAP ||
      body.ids.some((id: unknown) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) ||
      new Set(body.ids).size !== body.ids.length) return reply({ error: 'invalid_request' }, 400);
  if (!supabase) return reply({ error: 'catalog_unavailable' }, 503);
  const { data, error } = await supabase.from('bars').select('id,lat,lng').in('id', body.ids);
  if (error || !data) return reply({ error: 'catalog_unavailable' }, 503);
  const byId = new Map(data.map(b => [b.id, b]));
  const candidates = (body.ids as string[]).map(id => byId.get(id));
  if (candidates.some(b => !b || !isRoutingCoords(b))) return reply({ error: 'catalog_changed' }, 409);
  try {
    const result = await searchRoutes(body.origin, candidates as {id: string; lat: number; lng: number}[],
      body.mode, body.walkableOnly, process.env.ORS_API_KEY!, AbortSignal.timeout(20_000), body.band);
    return reply(result);
  } catch {
    // Don't log provider payloads, request bodies, URLs or exact coordinates.
    return reply({ error: 'routing_unavailable' }, 503);
  }
}
