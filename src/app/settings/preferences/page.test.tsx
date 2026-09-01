import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/profile.server', () => ({ setOwnPrivacy: vi.fn(async () => true) }));
vi.mock('@/lib/accountCache', () => ({ getCacheEpoch: () => 1 }));
vi.mock('@/lib/moderation/blocks', () => ({
  listBlockedProfiles: async () => blocked,
}));
vi.mock('../_useOwnProfile', () => ({
  useOwnProfile: () => ({
    handle: 'connor_f',
    displayName: 'Connor Feeney',
    isPrivate: false,
    known: true,
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
