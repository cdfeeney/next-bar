import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V8-4 drain endpoint — MOCKED-client tests only. Nothing here touches a live
 * database or APNs. The Supabase client is mocked at the module boundary so
 * the route's GUARDS run for real: the unattended gate, the shared-secret
 * check, the missing-credential path, and the production-environment refusal.
 *
 * The delivery rules themselves are tested in notificationOutbox.test.ts —
 * this file is about who is allowed to reach them.
 */

const createClientMock = vi.fn(() => ({ from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

const drainMock = vi.fn();
vi.mock('@/lib/notificationOutbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationOutbox')>(
    '@/lib/notificationOutbox',
  );
  return { ...actual, drainNotificationOutbox: (...args: unknown[]) => drainMock(...args) };
});

import { POST } from './route';

const SECRET = 'drain-secret-value';

function makeRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set('x-notifications-secret', secret);
  return new Request('http://localhost/api/notifications/drain', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/notifications/drain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LOOP_UNATTENDED', '');
    vi.stubEnv('NOTIFICATIONS_DRAIN_SECRET', SECRET);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    vi.stubEnv('NEXT_BAR_DATABASE_ENVIRONMENT', 'staging');
    vi.stubEnv('APNS_ENVIRONMENT', '');
    vi.stubEnv('APNS_KEY_ID', '');
    vi.stubEnv('APNS_TEAM_ID', '');
    vi.stubEnv('APNS_BUNDLE_ID', '');
    vi.stubEnv('APNS_PRIVATE_KEY', '');
    drainMock.mockResolvedValue({
      processed: 0, sent: 0, suppressed: 0, failed: 0, invalidTokensRevoked: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hard-refuses with 503 under LOOP_UNATTENDED=1', async () => {
    // An overnight loop must never push a real notification to a real phone.
    vi.stubEnv('LOOP_UNATTENDED', '1');
    const response = await POST(makeRequest(SECRET));
    expect(response.status).toBe(503);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no secret header', async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const response = await POST(makeRequest('not-the-secret'));
    expect(response.status).toBe(401);
  });

  it('rejects a secret that is a PREFIX of the real one', async () => {
    // The comparison must be length-checked, not a startsWith.
    const response = await POST(makeRequest(SECRET.slice(0, 5)));
    expect(response.status).toBe(401);
  });

  it('stays CLOSED when no secret is configured at all', async () => {
    // An unset secret is a missing answer, never permission. Presenting an
    // empty header must not match an empty configured value.
    vi.stubEnv('NOTIFICATIONS_DRAIN_SECRET', '');
    const response = await POST(makeRequest(''));
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it('reports 503 when Supabase is not configured on this deployment', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const response = await POST(makeRequest(SECRET));
    expect(response.status).toBe(503);
  });

  it('is a no-op success while the attended APNs credential does not exist', async () => {
    // The designed state of this repository today. The outbox accumulates and
    // nothing is sent — that must not read as an error to a scheduler.
    const response = await POST(makeRequest(SECRET));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: 'apns_not_configured',
    });
    expect(drainMock).not.toHaveBeenCalled();
  });

  it('REFUSES to run against the production APNs environment (criterion 12)', async () => {
    vi.stubEnv('NEXT_BAR_DATABASE_ENVIRONMENT', 'staging');
    vi.stubEnv('APNS_ENVIRONMENT', 'production');
    vi.stubEnv('APNS_KEY_ID', 'ABCD123456');
    vi.stubEnv('APNS_TEAM_ID', 'TEAM123456');
    vi.stubEnv('APNS_BUNDLE_ID', 'com.nextbar.app');
    vi.stubEnv('APNS_PRIVATE_KEY', 'anything');

    const response = await POST(makeRequest(SECRET));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'misconfigured' });
    expect(drainMock).not.toHaveBeenCalled();
  });
});
