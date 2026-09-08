// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: mocks.lookup }) }) } }));
vi.mock('@/lib/routeSearch', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/routeSearch')>(), searchRoutes: mocks.search,
}));
import { GET, POST } from './route';
let ip = 0;
function request(body: unknown, origin = 'https://next-bar.test') {
  return new Request('https://next-bar.test/api/travel', { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${++ip}` }, body: JSON.stringify(body) });
}
const valid = { origin: { lat: 40.75, lng: -74 }, ids: ['one'], mode: 'walking', walkableOnly: true };
beforeEach(() => {
  vi.stubEnv('NEXT_BAR_ROUTING_ENABLED', 'true'); vi.stubEnv('ORS_API_KEY', 'test'); vi.stubEnv('VERCEL_ENV', 'preview');
  mocks.lookup.mockReset(); mocks.search.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it('defaults off and refuses production even with a key', async () => {
  vi.stubEnv('NEXT_BAR_ROUTING_ENABLED', '');
  expect(await (await GET()).json()).toEqual({ enabled: false });
  expect((await POST(request(valid))).status).toBe(503);
  vi.stubEnv('NEXT_BAR_ROUTING_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production');
  expect((await POST(request(valid))).status).toBe(503);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it('rejects bad origins, duplicate/oversized IDs and bodies before catalog/provider work', async () => {
  expect((await POST(request(valid, 'https://attacker.test'))).status).toBe(403);
  for (const body of [null, { ...valid, ids: ['one', 'one'] },
    { ...valid, origin: { lat: 0, lng: 0 } }, { ...valid, ids: Array.from({ length: 16 }, (_, i) => `b${i}`) }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect((await POST(request({ ...valid, padding: 'x'.repeat(9000) }))).status).toBe(413);
  expect(mocks.lookup).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
});
it('resolves destinations from the catalog rather than trusting client coordinates', async () => {
  mocks.lookup.mockResolvedValue({ data: [{ id: 'one', lat: 40.76, lng: -73.99 }], error: null });
  mocks.search.mockResolvedValue({ routes: [], checked: 1, limited: false, incomplete: false });
  const result = await POST(request({ ...valid, destination: { lat: 1, lng: 1 } }));
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.search.mock.calls[0][1]).toEqual([{ id: 'one', lat: 40.76, lng: -73.99 }]);
});
it('does not route unknown IDs or leak provider errors', async () => {
  mocks.lookup.mockResolvedValueOnce({ data: [], error: null });
  expect((await POST(request(valid))).status).toBe(409);
  expect(mocks.search).not.toHaveBeenCalled();
  mocks.lookup.mockResolvedValue({ data: [{ id: 'one', lat: 40.76, lng: -73.99 }], error: null });
  mocks.search.mockRejectedValue(new Error('secret upstream payload'));
  const result = await POST(request(valid));
  expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: 'routing_unavailable' });
});
