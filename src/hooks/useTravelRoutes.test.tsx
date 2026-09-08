import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bar } from '@/types';
import { useTravelRoutes } from './useTravelRoutes';
const bar = { id: 'one', lat: 40.751, lng: -74 } as Bar;
const origin = { lat: 40.75, lng: -74 };
const data = { routes: [{ id: bar.id, destination: { lat: bar.lat, lng: bar.lng },
  walking: { seconds: 900, meters: 1000 }, driving: { seconds: 100, meters: 1200 } }],
  checked: 1, limited: false, incomplete: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('automatically calculates and deduplicates rerenders and StrictMode', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}'))
    .mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal('fetch', fetcher);
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const { result, rerender } = renderHook(() => useTravelRoutes({ ...origin }, [{ ...bar }], 'walking', true), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  rerender(); rerender();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.data?.routes[0].walking?.seconds).toBe(900);
});
it('automatically routes a changed origin without accepting the old origin response', async () => {
  const complete: ((r: Response) => void)[] = [];
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}'))
    .mockImplementation(() => new Promise<Response>(resolve => { complete.push(resolve); }));
  vi.stubGlobal('fetch', fetcher);
  const { result, rerender } = renderHook(({ point }) => useTravelRoutes(point, [bar], 'walking', true), { initialProps: { point: origin } });
  await waitFor(() => expect(result.current.status).toBe('loading'));
  rerender({ point: { lat: 40.8, lng: -74 } });
  await act(async () => complete[0](new Response(JSON.stringify(data))));
  expect(result.current.status).toBe('loading');
  expect(result.current.data).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => complete[1](new Response(JSON.stringify(data))));
  expect(result.current.status).toBe('ready');
});
it('rejects catalog-coordinate mismatch instead of showing a route to the wrong destination', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"enabled":true}'))
    .mockResolvedValue(new Response(JSON.stringify({ ...data, routes: [{ ...data.routes[0], destination: origin }] }))));
  const { result } = renderHook(() => useTravelRoutes(origin, [bar], 'walking', true));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.data).toBeUndefined();
});

it.each([60_000, 120_000])('restoring candidates after %i ms preserves the original expiry until recalculation', async elapsed => {
  const fetcher = vi.fn().mockImplementation((_url, options) => Promise.resolve(
    new Response(JSON.stringify(options?.method === 'POST' ? data : { enabled: true })),
  ));
  vi.stubGlobal('fetch', fetcher);
  const { result, rerender } = renderHook(
    ({ candidates }) => useTravelRoutes(origin, candidates, 'walking', true),
    { initialProps: { candidates: [] as Bar[] } },
  );
  await waitFor(() => expect(result.current.status).toBe('empty'));
  vi.useFakeTimers();
  await act(async () => rerender({ candidates: [bar] }));
  expect(result.current.status).toBe('ready');
  rerender({ candidates: [] });
  await act(async () => vi.advanceTimersByTimeAsync(elapsed));
  await act(async () => rerender({ candidates: [bar] }));
  expect(result.current.status).toBe(elapsed < 120_000 ? 'ready' : 'stale');
  await act(async () => vi.advanceTimersByTimeAsync(120_000 - elapsed));
  expect(result.current.status).toBe('stale');
  expect(result.current.data).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => result.current.calculate());
  expect(result.current.status).toBe('ready');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
