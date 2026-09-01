import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SILENT_AUTO_RETRY_CAP } from '@/components/states/useOperationalLoad';

/**
 * Settings home — V8-R-ACC-005's five sections, and the honesty rule that
 * governs the rows inside them.
 *
 * The five-section shape is the requirement's whole substance ("Profile,
 * Connections, Privacy & sharing, Notifications, Security & account — each row
 * carrying one line of current state"), so it is asserted as a list rather
 * than as five separate greps: a section quietly dropped or renamed is the
 * failure mode, and only comparing the whole set catches it.
 *
 * The second half is what this surface must NOT do. V8-R-ACC-007, -008 and
 * -010 describe stored settings whose columns do not exist in this repo. A
 * switch wired to nothing would report a preference the server never receives,
 * which V8-R-OPS-001 forbids by name. These tests fail if one appears.
 */

let authStatus: 'signed-in' | 'signed-out' = 'signed-in';
let blocked: { ok: boolean; value?: string[] } = { ok: true, value: ['a', 'b'] };

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: authStatus,
    user: { id: 'me', email: 'me@example.com' },
    signOut: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRatings', () => ({ useRatings: () => ({ ratings: [] }) }));
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({ follows: [], mutuals: [{ id: '1' }, { id: '2' }, { id: '3' }] }),
}));
vi.mock('@/hooks/useFollowRequests', () => ({
  useFollowRequests: () => ({ requests: [{ id: 'r1' }] }),
}));
vi.mock('@/components/InstallPrompt', () => ({ default: () => null }));
vi.mock('@/lib/demo', () => ({
  isDemoSeeded: () => false,
  seedSampleNight: vi.fn(),
  clearSampleNight: vi.fn(),
}));
vi.mock('@/lib/storedProfile', () => ({ loadProfile: () => null }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
/** Mutable so the REJECTED write — the branch where the switch flips back on
 *  its own — is rendered by a test rather than only by users. */
let privacySaveOk = true;
vi.mock('@/lib/profile.server', () => ({
  setOwnPrivacy: vi.fn(async () => privacySaveOk),
}));
vi.mock('@/lib/accountCache', () => ({ getCacheEpoch: () => 1 }));
/** Counted, so the SILENT half of the retry policy is asserted rather than
 *  assumed — a Retry button proves only that the manual half exists. */
let blockedReads = 0;
vi.mock('@/lib/moderation/blocks', () => ({
  listBlockedProfiles: async () => {
    blockedReads += 1;
    return blocked;
  },
}));
vi.mock('../_useOwnProfile', () => ({
  useOwnProfile: () => ({
    handle: 'connor_f',
    displayName: 'Connor Feeney',
    isPrivate: false,
    known: true,
    failed: false,
    retry: vi.fn(),
    consentLive: true,
    setHandle: vi.fn(),
    setDisplayName: vi.fn(),
    setIsPrivate: vi.fn(),
  }),
}));

import SettingsHomePage from './page';

beforeEach(() => {
  authStatus = 'signed-in';
  blocked = { ok: true, value: ['a', 'b'] };
  blockedReads = 0;
  privacySaveOk = true;
});

const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name, level: 2 }).parentElement as HTMLElement;

describe('V8-R-ACC-005 — Settings is a grouped list with five sections', () => {
  it('opens on the five approved sections, with Help deliberately last', () => {
    render(<SettingsHomePage />);

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);

    // The WHOLE list, not a prefix and a suffix. Checking `slice(0, 5)` and
    // the last entry left the middle unguarded, and a sixth primary "App"
    // section sat there unnoticed — precisely the "section quietly added"
    // failure this assertion exists to catch, one position over from the
    // "quietly dropped" one it did catch.
    expect(headings).toEqual([
      'Profile',
      'Connections',
      'Privacy & sharing',
      'Notifications',
      'Security & account',
      'Help',
    ]);
  });

  it('returns to the Account root, not to another tab', () => {
    render(<SettingsHomePage />);

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('states each row current value on the list itself', () => {
    render(<SettingsHomePage />);

    const profile = section('Profile');
    expect(within(profile).getByText('Connor Feeney')).toBeInTheDocument();
    expect(within(profile).getByText('Not taken')).toBeInTheDocument();
    expect(
      within(section('Security & account')).getByText('Verified'),
    ).toBeInTheDocument();
  });
});

describe('V8-R-ACC-009 — Connections carries both rows, with their counts', () => {
  it('shows the friend count, the pending count and the blocked count', async () => {
    render(<SettingsHomePage />);

    const connections = section('Connections');
    expect(within(connections).getByText('3 · 1 pending')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(connections).getByText('2')).toBeInTheDocument(),
    );
  });

  it('leaves the blocked count UNKNOWN when the read fails, never 0', async () => {
    // "You have blocked nobody" is a claim; a broken lookup is not evidence
    // for it (V8-R-OPS-001 — never present a fallback as a success).
    blocked = { ok: false };
    render(<SettingsHomePage />);

    const connections = section('Connections');
    await waitFor(() =>
      expect(within(connections).getByText('—')).toBeInTheDocument(),
    );
    expect(within(connections).queryByText('0')).toBeNull();
  });

  it('NAMES the failed read and offers a retry, instead of an unexplained dash', async () => {
    // Not printing 0 was right and not enough: the dash said the count is
    // unknown and left it there forever, with nothing naming the failure and
    // nothing to tap — the dead end V8-R-OPS-007 forbids, reached through a
    // row rather than a screen.
    blocked = { ok: false };
    render(<SettingsHomePage />);

    const state = await screen.findByTestId('operational-state');
    expect(state.getAttribute('data-state')).toBe('failed');
    expect(screen.getByText(/couldn't load your blocked list/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    // The rows are RETAINED: the friend count is still true and the
    // destination is still reachable. Only the failed read is reported.
    expect(
      within(section('Connections')).getByText('Blocked & muted'),
    ).toBeInTheDocument();
  });

  it('says nothing about a failure when the blocked read works', async () => {
    render(<SettingsHomePage />);

    await waitFor(() =>
      expect(within(section('Connections')).getByText('2')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('operational-state')).toBeNull();
  });

  it('puts Blocked & muted under Connections, not under Privacy & sharing', () => {
    render(<SettingsHomePage />);

    expect(
      within(section('Connections')).getByText('Blocked & muted'),
    ).toBeInTheDocument();
    expect(
      within(section('Privacy & sharing')).queryByText('Blocked & muted'),
    ).toBeNull();
  });
});

describe('V8-R-ACC-007 / -008 — the two sharing defaults are separate, and neither is faked', () => {
  it('names both audiences as their own rows', () => {
    render(<SettingsHomePage />);

    const privacy = section('Privacy & sharing');
    expect(within(privacy).getByText('Default story audience')).toBeInTheDocument();
    expect(within(privacy).getByText('Default pin audience')).toBeInTheDocument();
  });

  it('offers no switch for a setting with nowhere to persist', () => {
    render(<SettingsHomePage />);

    const privacy = section('Privacy & sharing');
    // The private-account switch IS backed (profiles.is_private) and stays.
    const switches = within(privacy).getAllByRole('switch');
    expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Private account',
    ]);
  });
});

describe('V8-R-ACC-010 — the three notification categories', () => {
  it('lists Plans, Tags & stories and Group activity', () => {
    render(<SettingsHomePage />);

    const notifications = section('Notifications');
    expect(within(notifications).getByText('Plans')).toBeInTheDocument();
    expect(within(notifications).getByText('Tags & stories')).toBeInTheDocument();
    expect(within(notifications).getByText('Group activity')).toBeInTheDocument();
  });

  it('claims no delivery, and no first-launch permission prompt', () => {
    render(<SettingsHomePage />);

    const notifications = section('Notifications');
    expect(within(notifications).getAllByText('Not delivered yet')).toHaveLength(3);
    expect(within(notifications).queryByRole('switch')).toBeNull();
  });
});

/**
 * V8-R-OPS-001 — a setting that did not save must SAY so.
 *
 * The revert alone was the defect: the switch flipped back on its own and said
 * nothing, so the only signal that the server refused was a control moving by
 * itself, which reads as a glitch rather than a refusal and leaves the user
 * believing whichever position they last saw. A silent revert is a fallback
 * presented as a success.
 */
describe('a private-account change the server rejects', () => {
  const privacySwitch = (): HTMLElement =>
    screen.getByRole('switch', { name: 'Private account' });

  it('says the change was not saved, names the state that stands, and offers a retry', async () => {
    privacySaveOk = false;
    render(<SettingsHomePage />);

    await userEvent.click(privacySwitch());

    await waitFor(() =>
      expect(screen.getByText(/couldn't save that change/i)).toBeInTheDocument(),
    );
    // The account is still PUBLIC — the mocked profile starts isPrivate:false
    // and the optimistic flip was reverted. Naming it is the point: the user
    // must not be left guessing which side the switch settled on.
    expect(screen.getByText(/still public/i)).toBeInTheDocument();
    expect(privacySwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('says nothing when the change saves', async () => {
    render(<SettingsHomePage />);

    await userEvent.click(privacySwitch());

    await waitFor(() =>
      expect(screen.queryByText(/couldn't save that change/i)).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('does not outlive the account it is about', async () => {
    // The failure row rendered outside the canTogglePrivacy guard and was
    // never reset on identity change, so signing out on this same page left
    // "your account is still public" standing about an account the screen no
    // longer had — profile.isPrivate resets to null, which reads as public —
    // beside a Try again that silently no-opped because userId was null.
    privacySaveOk = false;
    const view = render(<SettingsHomePage />);
    await userEvent.click(privacySwitch());
    await waitFor(() =>
      expect(screen.getByText(/couldn't save that change/i)).toBeInTheDocument(),
    );

    authStatus = 'signed-out';
    view.rerender(<SettingsHomePage />);

    expect(screen.queryByText(/couldn't save that change/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});

/**
 * V8-R-OPS-001's retry policy is "capped at 3 silent auto-retries, then
 * manual" — the WHOLE rule, not just the manual half.
 *
 * The first fix for the unexplained em dash added a Retry after ONE failed
 * request, so a single transient blip asked the user to fix it. The count is
 * asserted here rather than argued: the shared hook owns the policy, and this
 * is what using it actually means.
 */
describe('the blocked-list read follows the shared retry policy', () => {
  it('tries silently before asking, and asks only once the budget is spent', async () => {
    blocked = { ok: false };
    render(<SettingsHomePage />);

    await waitFor(() =>
      expect(screen.getByTestId('operational-state')).toBeInTheDocument(),
    );
    // 1 initial attempt + SILENT_AUTO_RETRY_CAP retries, then it stops.
    expect(blockedReads).toBe(SILENT_AUTO_RETRY_CAP + 1);
  });

  it('a manual retry that works clears the failure and shows the count', async () => {
    blocked = { ok: false };
    render(<SettingsHomePage />);
    await waitFor(() =>
      expect(screen.getByTestId('operational-state')).toBeInTheDocument(),
    );

    blocked = { ok: true, value: ['a', 'b'] };
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(within(section('Connections')).getByText('2')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('operational-state')).toBeNull();
  });
});
