import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { SILENT_AUTO_RETRY_CAP } from '@/components/states/useOperationalLoad';

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
/**
 * Mutable, and it COUNTS. The retry policy is a rule about how many times the
 * app may quietly try again, so a test that cannot see the attempts cannot
 * pin it — and a fixed always-succeeds mock never renders the branch a real
 * network failure lands on.
 */
type FetchedProfile = {
  handle: string | null;
  displayName: string | null;
  isPrivate: boolean | null;
} | null;
let profileReads = 0;
let profileResult: FetchedProfile = {
  handle: 'alice',
  displayName: 'Alice',
  isPrivate: false,
};
vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => {
    profileReads += 1;
    return profileResult;
  },
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
      <li>failed:{String(profile.failed)}</li>
      <li>consentLive:{String(profile.consentLive)}</li>
      <button type="button" onClick={profile.retry}>
        Retry
      </button>
    </ul>
  );
}

beforeEach(() => {
  authStatus = 'signed-in';
  profileReads = 0;
  profileResult = { handle: 'alice', displayName: 'Alice', isPrivate: false };
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

/**
 * V8-R-OPS-001 / V8-R-OPS-007 — "capped at 3 silent auto-retries, then manual".
 *
 * The defect: `known` went true only on success, so ONE failed read left the
 * Account root on an ellipsis and Edit profile on "Loading…" for the life of
 * the mount, with no message and no way to ask again. A surface that has given
 * up is not allowed to keep claiming it is working.
 *
 * The cap is imported from `useOperationalLoad`, not restated here, so this
 * suite pins the SHARED policy rather than a second copy of it.
 */
describe('useOwnProfile — a read that does not work', () => {
  test('retries silently exactly three times, then asks', async () => {
    profileResult = null;

    render(<Probe />);

    // 1 initial attempt + 3 silent retries, and then it stops on its own.
    await waitFor(() => expect(screen.getByText('failed:true')).toBeTruthy());
    expect(profileReads).toBe(SILENT_AUTO_RETRY_CAP + 1);
    // The honest pair: not loaded, and no longer pretending to load.
    expect(screen.getByText('known:false')).toBeTruthy();
  });

  test('a manual retry that works clears the failure and keeps the data', async () => {
    profileResult = null;
    render(<Probe />);
    await waitFor(() => expect(screen.getByText('failed:true')).toBeTruthy());
    const spent = profileReads;

    profileResult = { handle: 'alice', displayName: 'Alice', isPrivate: false };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('handle:alice')).toBeTruthy());
    expect(screen.getByText('failed:false')).toBeTruthy();
    expect(screen.getByText('known:true')).toBeTruthy();
    // Exactly one more read — the budget resets, it does not replay.
    expect(profileReads).toBe(spent + 1);
  });

  test('a healthy read is never reported as failed', async () => {
    // The negative half. `failed` must not be a synonym for "not loaded yet",
    // or every first paint would offer a Retry for something still in flight.
    render(<Probe />);

    await waitFor(() => expect(screen.getByText('known:true')).toBeTruthy());
    expect(screen.getByText('failed:false')).toBeTruthy();
    expect(profileReads).toBe(1);
  });

  test('signing out is not a failure and spends no attempts', async () => {
    // Why the shared hook is not used directly: it has no "not applicable"
    // state, and modelling signed-out as a null load would burn the budget on
    // every signed-out render.
    profileResult = null;
    render(<Probe />);
    await waitFor(() => expect(screen.getByText('failed:true')).toBeTruthy());

    authStatus = 'signed-out';
    const spent = profileReads;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('failed:false')).toBeTruthy());
    expect(profileReads).toBe(spent);
  });
});
