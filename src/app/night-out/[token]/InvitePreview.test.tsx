import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The bearer invitation surface (V8-R-INV-001 … V8-R-INV-004, D-C-23).
 *
 * The e2e spec drives this against a browser; this file is what runs in the
 * LANE gate, so the interactions that carry the requirement — the three RSVP
 * choices, the answer surviving a dismissed upsell, and a refused write being
 * labelled as unsent — are executable here rather than only at integration.
 */

const submitAnonRsvp = vi.fn();
const fetchAnonRsvp = vi.fn();
const fetchBearerDetail = vi.fn();
const fetchBearerAttendees = vi.fn();
const fetchBearerShortlist = vi.fn();
const ensureRsvpKey = vi.fn();
const readRsvpKey = vi.fn();

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/catalog', () => ({
  getBarById: (id: string) => ({ id, name: `Bar ${id}` }),
}));
vi.mock('./bearer', async (importOriginal) => {
  // The labels and the order are the contract's own words, so they come from
  // the real module — a test that restated them could not catch them drifting.
  const actual = await importOriginal<typeof import('./bearer')>();
  return {
    ...actual,
    submitAnonRsvp: (...a: unknown[]) => submitAnonRsvp(...a),
    fetchAnonRsvp: (...a: unknown[]) => fetchAnonRsvp(...a),
    fetchBearerDetail: (...a: unknown[]) => fetchBearerDetail(...a),
    fetchBearerAttendees: (...a: unknown[]) => fetchBearerAttendees(...a),
    fetchBearerShortlist: (...a: unknown[]) => fetchBearerShortlist(...a),
    ensureRsvpKey: (...a: unknown[]) => ensureRsvpKey(...a),
    readRsvpKey: (...a: unknown[]) => readRsvpKey(...a),
  };
});

import InvitePreview from './InvitePreview';

const TOKEN = '11111111-1111-1111-1111-111111111111';
const KEY = '22222222-2222-2222-2222-222222222222';

const PREVIEW = {
  night: '2026-08-20',
  title: 'Birthday crawl',
  status: 'open',
  ownerHandle: 'conor',
  ownerDisplayName: 'Conor',
  acceptedCount: 1,
};

function renderPreview(signedIn = false) {
  return render(
    <InvitePreview
      token={TOKEN}
      preview={PREVIEW}
      signedIn={signedIn}
      onSignIn={() => undefined}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchBearerDetail.mockResolvedValue({
    startsAt: '2026-08-21T01:00:00.000Z',
    decidedBarId: null,
  });
  fetchBearerAttendees.mockResolvedValue([
    { displayName: 'Sam', handle: 'sam' },
  ]);
  fetchBearerShortlist.mockResolvedValue([{ barId: 'attaboy', votes: 1 }]);
  fetchAnonRsvp.mockResolvedValue({ kind: 'none' });
  readRsvpKey.mockReturnValue(null);
  ensureRsvpKey.mockReturnValue(KEY);
  submitAnonRsvp.mockResolvedValue(true);
});

describe('what a token-scoped recipient may see (V8-R-INV-002)', () => {
  test('shows the host, the scheduled start, who is going and the shortlist', async () => {
    renderPreview();
    expect(screen.getByText(/hosted by conor/i)).toBeTruthy();
    // The SERVER's scheduled start, rendered in the contract's zone. 01:00Z is
    // 9:00 PM EDT on the 20th.
    await waitFor(() =>
      expect(screen.getByTestId('invite-when').textContent).toMatch(/9:00\s*PM/),
    );
    expect(screen.getByTestId('invite-attendees').textContent).toContain('Sam');
    expect(screen.getByTestId('invite-shortlist').textContent).toContain(
      '1 vote',
    );
  });

  test('states the pre-signup limitation rather than leaving it to be discovered', () => {
    renderPreview();
    // Accessibility clause, both V8-R-INV-001 and V8-R-INV-002: in words, on
    // the screen, unconditionally — not an error met by tapping something.
    expect(screen.getByTestId('invite-limitation')).toBeTruthy();
  });

  test('offers no way to vote or suggest — the bearer exclusions', () => {
    renderPreview();
    expect(screen.queryByRole('button', { name: /^vote$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^suggest$/i })).toBeNull();
  });

  test('a failed read says so rather than claiming an empty plan', async () => {
    fetchBearerAttendees.mockResolvedValue(null);
    fetchBearerShortlist.mockResolvedValue(null);
    renderPreview();
    await waitFor(() =>
      expect(screen.getByText(/couldn't load who's coming/i)).toBeTruthy(),
    );
    expect(screen.getByText(/couldn't load the shortlist/i)).toBeTruthy();
    expect(screen.queryByText(/nobody has said yes yet/i)).toBeNull();
    expect(screen.queryByText(/no bars suggested yet/i)).toBeNull();
  });
});

describe('the anonymous RSVP (V8-R-INV-001 / V8-R-INV-003)', () => {
  test('offers exactly Going, Maybe and Can\'t make it, with no account', () => {
    renderPreview();
    expect(screen.getByTestId('invite-rsvp-going').textContent).toBe('Going');
    expect(screen.getByTestId('invite-rsvp-maybe').textContent).toBe('Maybe');
    expect(screen.getByTestId('invite-rsvp-declined').textContent).toBe(
      "Can't make it",
    );
    // The phrase "Not tonight" belongs to neither RSVP nor presence (D-C-21,
    // D-C-22) and must not appear on this surface.
    expect(screen.queryByText(/not tonight/i)).toBeNull();
  });

  test('sends the choice under the recipient\'s own key and confirms it', async () => {
    renderPreview();
    screen.getByTestId('invite-rsvp-maybe').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));
    expect(submitAnonRsvp.mock.calls[0]?.slice(1)).toEqual([
      TOKEN,
      KEY,
      'maybe',
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(
        /maybe/i,
      ),
    );
  });

  test('a returning recipient sees the answer they already sent', async () => {
    readRsvpKey.mockReturnValue(KEY);
    fetchAnonRsvp.mockResolvedValue({ kind: 'ok', choice: 'going' });
    renderPreview();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going').getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
  });

  test('a refused RSVP is labelled as not yet sent, and is not shown as chosen', async () => {
    submitAnonRsvp.mockResolvedValue(false);
    renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-error').textContent).toMatch(
        /hasn't been sent/i,
      ),
    );
    expect(screen.queryByTestId('invite-rsvp-sent')).toBeNull();
    expect(
      screen.getByTestId('invite-rsvp-going').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  /**
   * An answer stored under a key the browser will not keep is one the recipient
   * can never see or change again. Refusing to send it is the honest move; the
   * alternative silently rewrites a stranger's row on the next visit.
   */
  test('does not send an RSVP when the key cannot be persisted', async () => {
    ensureRsvpKey.mockReturnValue(null);
    renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-error').textContent).toMatch(
        /won't let us remember/i,
      ),
    );
    expect(submitAnonRsvp).not.toHaveBeenCalled();
  });
});

describe('the optional signup upsell (V8-R-INV-004)', () => {
  test('arrives only after an RSVP, and "Maybe later" keeps it', async () => {
    renderPreview();
    expect(screen.queryByTestId('invite-upsell')).toBeNull();

    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(screen.getByTestId('invite-upsell')).toBeTruthy());
    expect(screen.getByTestId('invite-upsell').textContent).toMatch(
      /rsvp'd either way/i,
    );

    screen.getByTestId('invite-upsell-dismiss').click();
    await waitFor(() => expect(screen.queryByTestId('invite-upsell')).toBeNull());
    // THE RSVP SURVIVES THE DISMISSAL. "Maybe later dismisses it without losing
    // the RSVP" is the requirement's own sentence.
    expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(/going/i);
  });

  test('is never shown to a signed-in visitor, who already has the account', async () => {
    renderPreview(true);
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-sent')).toBeTruthy());
    expect(screen.queryByTestId('invite-upsell')).toBeNull();
  });
});
