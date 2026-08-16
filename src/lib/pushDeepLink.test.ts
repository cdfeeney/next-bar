import { describe, expect, it, vi } from 'vitest';
import { handlePushNavigation, routeForPushPayload } from '@/lib/pushDeepLink';

/**
 * Pure routing logic for the APNs custom payload (V8-4). No Capacitor here —
 * these run against plain data, exactly what a cold-launch listener and a
 * warm foreground tap both hand this module.
 */

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

describe('routeForPushPayload', () => {
  it('returns the night-out path for a valid payload', () => {
    expect(routeForPushPayload({ nightOutToken: TOKEN, eventType: 'invited' })).toBe(
      `/night-out/${TOKEN}`,
    );
  });

  it('accepts all four PRD event types', () => {
    for (const eventType of ['invited', 'accepted', 'bar_suggested', 'plan_changed']) {
      expect(routeForPushPayload({ nightOutToken: TOKEN, eventType })).toBe(
        `/night-out/${TOKEN}`,
      );
    }
  });

  it('null on a missing token', () => {
    expect(routeForPushPayload({ eventType: 'invited' })).toBeNull();
  });

  it('null on a non-UUID token, including a path-traversal-shaped string', () => {
    expect(
      routeForPushPayload({ nightOutToken: '../../etc/passwd', eventType: 'invited' }),
    ).toBeNull();
    expect(
      routeForPushPayload({ nightOutToken: 'not-a-uuid', eventType: 'invited' }),
    ).toBeNull();
  });

  it('null on an unknown event type', () => {
    expect(
      routeForPushPayload({ nightOutToken: TOKEN, eventType: 'account_deleted' }),
    ).toBeNull();
  });

  it('null on non-object payloads', () => {
    expect(routeForPushPayload(null)).toBeNull();
    expect(routeForPushPayload(undefined)).toBeNull();
    expect(routeForPushPayload('a string')).toBeNull();
    expect(routeForPushPayload(42)).toBeNull();
  });
});

describe('handlePushNavigation', () => {
  it('signed-in: navigates directly, never touches pending-invite storage', () => {
    const navigate = vi.fn();
    const storePendingInvite = vi.fn();
    const handled = handlePushNavigation(
      { nightOutToken: TOKEN, eventType: 'accepted' },
      { isSignedIn: true, navigate, storePendingInvite },
    );
    expect(handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/night-out/${TOKEN}`);
    expect(storePendingInvite).not.toHaveBeenCalled();
  });

  it('signed-out: stores the pending invite AND navigates to the same share route (the handoff)', () => {
    const navigate = vi.fn();
    const storePendingInvite = vi.fn();
    const handled = handlePushNavigation(
      { nightOutToken: TOKEN, eventType: 'bar_suggested' },
      { isSignedIn: false, navigate, storePendingInvite },
    );
    expect(handled).toBe(true);
    expect(storePendingInvite).toHaveBeenCalledWith(TOKEN);
    expect(navigate).toHaveBeenCalledWith(`/night-out/${TOKEN}`);
  });

  it('a malformed payload navigates nowhere and stores nothing, on cold launch or warm tap alike', () => {
    const navigate = vi.fn();
    const storePendingInvite = vi.fn();
    const handled = handlePushNavigation(
      { nightOutToken: 'garbage', eventType: 'invited' },
      { isSignedIn: false, navigate, storePendingInvite },
    );
    expect(handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(storePendingInvite).not.toHaveBeenCalled();
  });

  it('the same function handles a cold-launch payload and a warm foreground tap identically', () => {
    const coldNavigate = vi.fn();
    const warmNavigate = vi.fn();
    const payload = { nightOutToken: TOKEN, eventType: 'plan_changed' };

    // Cold launch: app-start listener hands this the launch payload.
    handlePushNavigation(payload, {
      isSignedIn: true,
      navigate: coldNavigate,
      storePendingInvite: vi.fn(),
    });
    // Warm tap: foreground listener hands this the same shape.
    handlePushNavigation(payload, {
      isSignedIn: true,
      navigate: warmNavigate,
      storePendingInvite: vi.fn(),
    });

    expect(coldNavigate).toHaveBeenCalledWith(`/night-out/${TOKEN}`);
    expect(warmNavigate).toHaveBeenCalledWith(`/night-out/${TOKEN}`);
  });
});
