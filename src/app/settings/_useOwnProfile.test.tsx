import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Identity belongs to the SESSION.
 *
 * The defect this pins: the hook returned early for any non-signed-in status
 * without clearing what it had already loaded, so after a sign-out the Settings
 * list kept rendering the previous account owner's display name and @username
 * on a signed-out page. The epoch guards inside the effect stop a stale FETCH
 * from landing; nothing was undoing a fetch that had already landed.
 */

let authStatus: 'loading' | 'signed-in' | 'signed-out' | 'unavailable' =
  'signed-in';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: authStatus, user: { id: 'alice' }, signOut: vi.fn() }),
}));
vi.mock('@/lib/accountCache', () => ({ getCacheEpoch: () => 1 }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => ({
    handle: 'alice',
    displayName: 'Alice',
    isPrivate: false,
  }),
}));
vi.mock('@/lib/follows.server', () => ({
  fetchOutgoingRequests: async () => [],
}));

import { useOwnProfile } from './_useOwnProfile';

function Probe(): JSX.Element {
  const profile = useOwnProfile();
  return (
    <ul>
      <li>handle:{profile.handle ?? '—'}</li>
      <li>name:{profile.displayName ?? '—'}</li>
      <li>known:{String(profile.known)}</li>
      <li>consentLive:{String(profile.consentLive)}</li>
    </ul>
  );
}

beforeEach(() => {
  authStatus = 'signed-in';
});

describe('useOwnProfile', () => {
  test('drops the previous owner’s identity when the session ends', async () => {
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByText('handle:alice')).toBeTruthy());
    expect(screen.getByText('name:Alice')).toBeTruthy();

    authStatus = 'signed-out';
    view.rerender(<Probe />);

    await waitFor(() => expect(screen.getByText('handle:—')).toBeTruthy());
    expect(screen.getByText('name:—')).toBeTruthy();
    // `known` must fall back too: it is what the Edit profile screen reads to
    // decide it has a real answer rather than a pre-fetch blank.
    expect(screen.getByText('known:false')).toBeTruthy();
    expect(screen.getByText('consentLive:false')).toBeTruthy();
  });

  test('clears on unavailable as well, which also has no identity to show', async () => {
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByText('handle:alice')).toBeTruthy());

    authStatus = 'unavailable';
    view.rerender(<Probe />);

    await waitFor(() => expect(screen.getByText('handle:—')).toBeTruthy());
  });

  test('holds identity for as long as the session lasts', async () => {
    // The reset must not fire on an unrelated re-render, or the Settings list
    // would blank its own rows mid-session.
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByText('handle:alice')).toBeTruthy());

    view.rerender(<Probe />);

    expect(screen.getByText('handle:alice')).toBeTruthy();
    expect(screen.getByText('known:true')).toBeTruthy();
  });
});
