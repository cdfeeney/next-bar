import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The emailed-token branch exists so the auth templates can link at THIS
 * domain: Gmail stripped the href and banner-warned on a recovery mail whose
 * link host (the Supabase project) did not match the sending domain. What is
 * worth a test is not the happy path but the allowlist — `type` is
 * attacker-visible query input reaching the SDK.
 */
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { GET } = await import('./route');

const call = (query: string) =>
  GET(new Request(`https://next-bar.com/auth/callback${query}`) as never);

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe('/auth/callback', () => {
  test('token_hash with an allowed type verifies and lands on the requested path', async () => {
    const res = await call('?token_hash=abc&type=recovery&redirect_to=/settings');
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
    expect(res.headers.get('location')).toBe('https://next-bar.com/settings');
  });

  test.each(['', 'password', 'RECOVERY', '../recovery'])(
    'token_hash with a rejected type %s never reaches the SDK',
    async (type) => {
      const res = await call(`?token_hash=abc&type=${encodeURIComponent(type)}`);
      expect(verifyOtp).not.toHaveBeenCalled();
      expect(res.headers.get('location')).toBe(
        'https://next-bar.com/auth?error=invalid_type',
      );
    },
  );

  test('token_hash with no type at all is refused', async () => {
    const res = await call('?token_hash=abc');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(
      'https://next-bar.com/auth?error=invalid_type',
    );
  });

  test('a cross-origin redirect_to is ignored, not followed', async () => {
    const res = await call('?token_hash=abc&type=recovery&redirect_to=//evil.com');
    expect(res.headers.get('location')).toBe('https://next-bar.com/');
  });

  test('a failed verification reports the error instead of signing anyone in', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });
    const res = await call('?token_hash=abc&type=recovery');
    expect(res.headers.get('location')).toBe(
      'https://next-bar.com/auth?error=Token%20has%20expired',
    );
  });

  test('the existing ?code= exchange still works', async () => {
    const res = await call('?code=xyz&redirect_to=/rankings');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz');
    expect(res.headers.get('location')).toBe('https://next-bar.com/rankings');
  });

  test('every response refuses to be cached or to leak the token in a Referer', async () => {
    for (const query of [
      '?token_hash=abc&type=recovery',
      '?token_hash=abc&type=nope',
      '?code=xyz',
      '',
    ]) {
      const res = await call(query);
      expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  test('neither parameter is still missing_code', async () => {
    const res = await call('');
    expect(res.headers.get('location')).toBe(
      'https://next-bar.com/auth?error=missing_code',
    );
  });
});
