import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAccountDeletion } from '@/lib/accountDeletion';

describe('requestAccountDeletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the bearer token to our own route and maps {ok:true}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestAccountDeletion('token-123')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('is false on non-2xx, ok:false bodies, and transport throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'unavailable' }), {
          status: 503,
        }),
      ),
    );
    expect(await requestAccountDeletion('t')).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false }), { status: 200 }),
      ),
    );
    expect(await requestAccountDeletion('t')).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await requestAccountDeletion('t')).toBe(false);
  });
});
