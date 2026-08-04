import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFriendPins, pinVenue, unpinVenue } from '@/lib/pins.server';

function fakeClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('pinVenue', () => {
  test('calls pin_venue with EXACTLY bar id + night — the outbound-payload proof', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    await expect(pinVenue(client, 'attaboy', '2026-08-03')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('pin_venue');
    // Deep equality — not a subset match — so an added lat/lng/accuracy
    // key can never sneak into the payload without failing here.
    expect(args).toEqual({ bar: 'attaboy', night: '2026-08-03' });
    expect(Object.keys(args as object).sort()).toEqual(['bar', 'night']);
  });

  test('rejects malformed bar ids and nights WITHOUT calling the server', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    await expect(pinVenue(client, 'Not A Slug!', '2026-08-03')).resolves.toBe(false);
    await expect(pinVenue(client, 'attaboy', '08/03/2026')).resolves.toBe(false);
    await expect(pinVenue(client, '', '2026-08-03')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('surfaces server refusal (data false) and transport errors as false', async () => {
    const refused = fakeClient({ data: false, error: null });
    await expect(pinVenue(refused.client, 'attaboy', '2026-08-03')).resolves.toBe(false);
    const errored = fakeClient({ data: null, error: { message: 'offline' } });
    await expect(pinVenue(errored.client, 'attaboy', '2026-08-03')).resolves.toBe(false);
  });
});

describe('unpinVenue', () => {
  test('calls unpin_venue with EXACTLY the night', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    await expect(unpinVenue(client, '2026-08-03')).resolves.toBe(true);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('unpin_venue');
    expect(args).toEqual({ night: '2026-08-03' });
    expect(Object.keys(args as object)).toEqual(['night']);
  });

  test('rejects malformed nights without a server call', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    await expect(unpinVenue(client, 'tonight')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fetchFriendPins', () => {
  const row = {
    user_id: 'u-1',
    handle: 'sam',
    display_name: 'Sam',
    bar_id: 'attaboy',
    pinned_at: '2026-08-04T02:00:00Z',
  };

  test('maps rows and distinguishes empty ([]) from failure (null)', async () => {
    const ok = fakeClient({ data: [row], error: null });
    await expect(fetchFriendPins(ok.client, '2026-08-03')).resolves.toEqual([
      {
        userId: 'u-1',
        handle: 'sam',
        displayName: 'Sam',
        barId: 'attaboy',
        pinnedAt: '2026-08-04T02:00:00Z',
      },
    ]);
    const empty = fakeClient({ data: [], error: null });
    await expect(fetchFriendPins(empty.client, '2026-08-03')).resolves.toEqual([]);
    const errored = fakeClient({ data: null, error: { message: 'boom' } });
    await expect(fetchFriendPins(errored.client, '2026-08-03')).resolves.toBeNull();
  });

  test('calls get_friend_pins with EXACTLY the night', async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    await fetchFriendPins(client, '2026-08-03');
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('get_friend_pins');
    expect(args).toEqual({ night: '2026-08-03' });
  });

  test('rejects malformed nights without a server call', async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    await expect(fetchFriendPins(client, 'not-a-night')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('module-level privacy contract (criterion 5)', () => {
  test('pins.server.ts never references geolocation or coordinates', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/pins.server.ts'),
      'utf8',
    );
    // Comments explain the contract, so strip them before scanning.
    const code = source
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join('\n');
    for (const word of [
      'latitude',
      'longitude',
      'lat:',
      'lng:',
      'accuracy',
      'geolocation',
      'getCurrentPosition',
      'coords',
    ]) {
      expect(code.toLowerCase()).not.toContain(word);
    }
  });
});
