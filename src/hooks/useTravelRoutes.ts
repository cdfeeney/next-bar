'use client';

import { useEffect, useRef, useState } from 'react';
import type { Bar, Coords } from '@/types';
import { isRouteEstimate, matchesTravelBand, ROUTE_RESULT_CAP, type TravelBand, type TravelMode, type TravelSearch } from '@/lib/travelTime';

/** Search-local memory only: no coordinate history, cross-user cache or retries. */
export function useTravelRoutes(origin: Coords, candidates: Bar[], mode: TravelMode, walkableOnly: boolean,
  band: TravelBand = walkableOnly ? 'walkable' : mode === 'driving' ? 'cab' : 'anywhere') {
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const originKey = `${origin.lat},${origin.lng}`;
  const key = JSON.stringify([originKey, candidates.map(b => [b.id, b.lat, b.lng]), mode, walkableOnly, band, revision]);
  const [state, setState] = useState<{ key: string; status: 'ready' | 'error' | 'stale'; data?: TravelSearch } | null>(null);
  const pending = useRef<{ key: string; work: Promise<{ data: TravelSearch; expiresAt: number }> } | null>(null);
  const capability = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    let current = true;
    capability.current ??= fetch('/api/travel', { cache: 'no-store' })
      .then(async r => r.ok && (await r.json()).enabled === true).catch(() => false);
    void capability.current.then(value => { if (current) setEnabled(value); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || candidates.length === 0) return;
    let current = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    // Reuse an in-flight request on StrictMode's effect replay and ordinary renders.
    if (pending.current?.key !== key) {
      const work = fetch('/api/travel', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({ origin, ids: candidates.map(b => b.id), mode, walkableOnly, band }),
      }).then(async response => {
        if (!response.ok) throw new Error('routing_unavailable');
        const data = await response.json() as TravelSearch;
        if (!Array.isArray(data.routes) || data.routes.length > ROUTE_RESULT_CAP ||
            new Set(data.routes.map(r => r.id)).size !== data.routes.length ||
            !Number.isInteger(data.checked) || data.checked < data.routes.length || data.checked > candidates.length ||
            typeof data.limited !== 'boolean' || typeof data.incomplete !== 'boolean' ||
            data.routes.some(r => {
              const bar = candidates.find(b => b.id === r.id);
              return !bar || r.destination?.lat !== bar.lat || r.destination?.lng !== bar.lng ||
                (r.walking !== null && !isRouteEstimate(r.walking)) ||
                (r.driving !== null && !isRouteEstimate(r.driving)) || !isRouteEstimate(r.walking) ||
                !matchesTravelBand(origin, bar, r.walking, band);
            })) throw new Error('invalid_routes');
        return { data, expiresAt: Date.now() + 120_000 };
      });
      pending.current = { key, work };
    }
    void pending.current.work.then(({ data, expiresAt }) => {
      if (!current) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) { setState({ key, status: 'stale' }); return; }
      setState({ key, status: 'ready', data });
      // Reusing a response must not restart its original display lifetime.
      expiry = setTimeout(() => { if (current) setState({ key, status: 'stale' }); }, remaining);
    }).catch(() => { if (current) setState({ key, status: 'error' }); });
    return () => { current = false; clearTimeout(expiry); };
    // The serialized key includes every routing input; object identity isn't a new trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const status = !enabled ? 'disabled' :
    state?.key === key ? state.status : candidates.length ? 'loading' : 'empty';
  return {
    status,
    data: status === 'ready' && state?.key === key ? state.data : undefined,
    calculate: () => setRevision(r => r + 1),
  };
}
