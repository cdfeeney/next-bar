import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRoutingCoords, parseMatrix, searchRoutes } from './routeSearch';

const origin = { lat: 40.75, lng: -74 };
const bars = Array.from({ length: 15 }, (_, i) => ({ id: `bar-${i}`, lat: 40.751 + i / 10000, lng: -74 }));
const signal = () => AbortSignal.timeout(1000);
const matrix = (seconds: (number | null)[]) => new Response(JSON.stringify({
  durations: [seconds], distances: [seconds.map(s => s === null ? null : s * 1.2)],
}));
afterEach(() => vi.unstubAllGlobals());

describe('bounded route search', () => {
  it('preserves preference within 900 seconds, replaces longer walks and drives only the final five', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(matrix([1320, 901, 900, 800, 700]))
      .mockResolvedValueOnce(matrix([600, 500, 1500, null, 1800]))
      .mockResolvedValueOnce(matrix([60, 70, 80, 90, 100]));
    vi.stubGlobal('fetch', fetcher);
    const result = await searchRoutes(origin, bars, 'walking', true, 'test-key', signal());
    expect(result.routes.map(r => r.id)).toEqual(['bar-2', 'bar-3', 'bar-4', 'bar-5', 'bar-6']);
    expect(result.checked).toBe(10);
    expect(result.routes.every(r => r.walking!.seconds <= 900)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const payloads = fetcher.mock.calls.map(c => JSON.parse(c[1].body));
    expect(payloads.every(p => p.sources.length === 1 && p.destinations.length === 5)).toBe(true);
    expect(payloads[0].locations[0]).toEqual([-74, 40.75]);
    expect(fetcher.mock.calls[2][0]).toContain('driving-car');
    expect(payloads[2].locations[1]).toEqual([bars[2].lng, bars[2].lat]);
  });
  it('returns only confirmed walkable matches and preserves them if driving fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(matrix([900, 1320, 1400, 1500, 1600]))
      .mockResolvedValueOnce(matrix([1700, 1800, 1900, 2000, 2100]))
      .mockResolvedValueOnce(matrix([2200, 2300, 2400, 2500, 2600]))
      .mockRejectedValueOnce(new Error('quota'));
    vi.stubGlobal('fetch', fetcher);
    const result = await searchRoutes(origin, bars, 'walking', true, 'test-key', signal());
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].walking?.seconds).toBe(900);
    expect(result.routes.every(r => r.driving === null)).toBe(true);
    expect(result.incomplete).toBe(true);
    expect(result.limited).toBe(true);
    expect(fetcher.mock.calls.reduce((n, c) => n + JSON.parse(c[1].body).destinations.length, 0)).toBe(16);
  });
  it('treats unreachable as unavailable, not zero, and rejects malformed matrices', () => {
    expect(parseMatrix({ durations: [[null]], distances: [[null]] }, 1)).toEqual([null]);
    for (const data of [null, {}, { durations: [[1]], distances: [[]] },
      { durations: [[-1]], distances: [[2]] }, { durations: [['900']], distances: [[2]] },
      { durations: [[null]], distances: [[0]] }]) expect(() => parseMatrix(data, 1)).toThrow('invalid_matrix');
    expect(isRoutingCoords({ lat: 1, lng: 1 })).toBe(false);
  });
  it('does not retry primary failures or route an oversized candidate pool', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(searchRoutes(origin, bars, 'walking', true, 'key', signal())).rejects.toThrow('routing_unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(searchRoutes(origin, [...bars, { ...bars[0], id: 'extra' }], 'walking', true, 'key', signal())).rejects.toThrow('invalid_search');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks walking before selecting cab matches, excludes unknown and walkable routes, preserves taste order', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(matrix([900, 901, null, 1300, 800]))
      .mockResolvedValueOnce(matrix([1400, 1500, 700, 1600, 500]))
      .mockResolvedValueOnce(matrix([50, 60, 70, 80, 90]));
    vi.stubGlobal('fetch', fetcher);
    const result = await searchRoutes(origin, bars, 'driving', false, 'key', signal());
    expect(fetcher.mock.calls[0][0]).toContain('foot-walking');
    expect(result.routes.map(r => r.id)).toEqual(['bar-1', 'bar-3', 'bar-5', 'bar-6', 'bar-8']);
    expect(fetcher.mock.calls[2][0]).toContain('driving-car');
    expect(result.checked).toBe(10);
    expect(result.routes.every(r => r.walking!.seconds > 900)).toBe(true);
  });
  it('never pads an empty cab band with walkable or unknown routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(matrix([900, null, 600, 800, 400])));
    const result = await searchRoutes(origin, bars, 'driving', false, 'key', signal());
    expect(result.routes).toEqual([]);
    expect(result.checked).toBe(15);
    expect(result.limited).toBe(true);
  });
  it('preserves the successful first batch when a replacement lookup fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(matrix([600, 1300, 1400, 1500, 1600]))
      .mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', fetcher);
    const result = await searchRoutes(origin, bars, 'walking', true, 'key', signal());
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].walking?.seconds).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
