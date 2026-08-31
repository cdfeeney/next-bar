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
const queueRsvp = vi.fn();
const readQueuedRsvp = vi.fn();
const clearQueuedRsvp = vi.fn();

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
    queueRsvp: (...a: unknown[]) => queueRsvp(...a),
    readQueuedRsvp: (...a: unknown[]) => readQueuedRsvp(...a),
    clearQueuedRsvp: (...a: unknown[]) => clearQueuedRsvp(...a),
  };
});

import InvitePreview, { resetRsvpWritesInFlight } from './InvitePreview';

const TOKEN = '11111111-1111-1111-1111-111111111111';
const KEY = '22222222-2222-2222-2222-222222222222';
/** A second invitation, reached by client-side navigation without a remount. */
const OTHER_TOKEN = '33333333-3333-3333-3333-333333333333';

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
  // The RSVP lock outlives component instances on purpose, so a case that
  // leaves a write hanging would otherwise disable every case after it.
  resetRsvpWritesInFlight();
  fetchBearerDetail.mockResolvedValue({
    startsAt: '2026-08-21T01:00:00.000Z',
    area: null,
    decidedBarId: null,
    votingClosesAt: null,
  });
  fetchBearerAttendees.mockResolvedValue([
    { displayName: 'Sam', handle: 'sam' },
  ]);
  fetchBearerShortlist.mockResolvedValue([{ barId: 'attaboy', votes: 1 }]);
  fetchAnonRsvp.mockResolvedValue({ kind: 'none' });
  readRsvpKey.mockReturnValue(null);
  ensureRsvpKey.mockReturnValue(KEY);
  submitAnonRsvp.mockResolvedValue('sent');
  readQueuedRsvp.mockReturnValue(null);
  queueRsvp.mockReturnValue(true);
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

  /**
   * AREA IS NOT THE DECIDED BAR (round-4 panel, Codex). V8-R-NO-003's Area is
   * the plan's own optional field; the decided bar arrives later and is null
   * for exactly as long as the plan is still choosing — the window in which a
   * recipient most needs to know roughly where. Round 4 rendered only the bar.
   */
  test('shows the area while the plan is still choosing a bar', async () => {
    fetchBearerDetail.mockResolvedValue({
      startsAt: '2026-08-21T01:00:00.000Z',
      area: 'Lower East Side',
      decidedBarId: null,
      votingClosesAt: null,
    });
    renderPreview();
    await waitFor(() =>
      expect(screen.getByTestId('invite-area').textContent).toContain(
        'Lower East Side',
      ),
    );
    expect(screen.queryByTestId('invite-where')).toBeNull();
  });

  test('shows the area AND the decided bar once one is locked', async () => {
    fetchBearerDetail.mockResolvedValue({
      startsAt: '2026-08-21T01:00:00.000Z',
      area: 'Lower East Side',
      decidedBarId: 'attaboy',
      votingClosesAt: null,
    });
    renderPreview();
    await waitFor(() => expect(screen.getByTestId('invite-where')).toBeTruthy());
    expect(screen.getByTestId('invite-area')).toBeTruthy();
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

  /**
   * A FAILED READ IS NOT AN UN-ANSWERED ONE (round-4 panel, Claude gate). It
   * used to collapse into the same unpressed state, so a recipient returning
   * on a transport blip was asked to reply again to a plan they had already
   * replied to, with nothing saying the read had failed.
   */
  test('says it could not check when the stored answer is unreadable', async () => {
    readRsvpKey.mockReturnValue(KEY);
    fetchAnonRsvp.mockResolvedValue({ kind: 'failed' });
    renderPreview();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-unreadable')).toBeTruthy(),
    );
    // The controls stay live: answering again is an upsert on their own key.
    expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled();
  });

  test('says nothing of the sort when the recipient simply has not answered', async () => {
    readRsvpKey.mockReturnValue(KEY);
    fetchAnonRsvp.mockResolvedValue({ kind: 'none' });
    renderPreview();
    await waitFor(() => expect(fetchAnonRsvp).toHaveBeenCalled());
    expect(screen.queryByTestId('invite-rsvp-unreadable')).toBeNull();
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

  /**
   * ROUND-6 PANEL (Codex, MEDIUM). This used to assert the OFFLINE sentence —
   * "not sent yet, try again in a moment" — for an answer the server had
   * already declined. Every reason it declines is durable (expired link,
   * cancelled plan, the plan's link replies at their cap), so "in a moment" is
   * a retry that can never succeed. The message must not promise one, and it
   * must offer the path that does work.
   */
  test('a refused RSVP says so without promising a retry, and is not shown as chosen', async () => {
    submitAnonRsvp.mockResolvedValue('refused');
    renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-error').textContent).toMatch(
        /let the host know/i,
      ),
    );
    expect(screen.getByTestId('invite-rsvp-error').textContent).not.toMatch(
      /try again in a moment/i,
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

/**
 * V8-R-INV-003's failure recovery: "an offline response is queued and
 * explicitly labelled as not yet sent; duplicate delivery is idempotent."
 *
 * Round 3 rejected an offline answer with a retry message and held nothing, so
 * coming back online sent nothing. A REFUSED answer is a different case and
 * must NOT be queued — retrying it forever cannot make it land.
 */
describe('the offline queue (V8-R-INV-003)', () => {
  test('an unreachable RSVP is held, labelled unsent, and not shown as chosen', async () => {
    submitAnonRsvp.mockResolvedValue('unreachable');
    renderPreview();

    screen.getByTestId('invite-rsvp-maybe').click();
    await waitFor(() => expect(queueRsvp).toHaveBeenCalledWith(TOKEN, 'maybe'));
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-queued').textContent).toMatch(
        /not sent yet/i,
      ),
    );
    // NOT the recipient's answer: the host cannot see it yet.
    expect(screen.queryByTestId('invite-rsvp-sent')).toBeNull();
    expect(
      screen.getByTestId('invite-rsvp-maybe').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  test('a REFUSED answer is not queued — retrying cannot make it land', async () => {
    submitAnonRsvp.mockResolvedValue('refused');
    renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-error')).toBeTruthy());
    expect(queueRsvp).not.toHaveBeenCalled();
  });

  /**
   * ROUND-7 PANEL (Codex, MEDIUM). Only the DELIVERY path cleared the queue on
   * a refusal. A refused TAP left an older held answer in place, so the surface
   * said this invitation could record nothing AND that a different answer was
   * still about to be sent — and the held one cannot land either, because every
   * reason the server refuses is a property of the plan, not of the answer.
   */
  test('a refused TAP also drops an answer held from before', async () => {
    readQueuedRsvp.mockReturnValue('going');
    readRsvpKey.mockReturnValue(KEY);
    // The held answer's own delivery is unreachable, so it stays held...
    submitAnonRsvp.mockResolvedValue('unreachable');
    renderPreview();
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-queued')).toBeTruthy());

    // ...until an explicit tap is REFUSED.
    submitAnonRsvp.mockResolvedValue('refused');
    screen.getByTestId('invite-rsvp-maybe').click();

    await waitFor(() => expect(clearQueuedRsvp).toHaveBeenCalledWith(TOKEN));
    await waitFor(() => expect(screen.queryByTestId('invite-rsvp-queued')).toBeNull());
    expect(screen.getByTestId('invite-rsvp-error').textContent).toMatch(
      /let the host know/i,
    );
  });

  test('a held answer is delivered on arrival, and then stops being held', async () => {
    readQueuedRsvp.mockReturnValue('going');
    readRsvpKey.mockReturnValue(KEY);
    renderPreview();

    await waitFor(() =>
      expect(submitAnonRsvp).toHaveBeenCalledWith(
        expect.anything(),
        TOKEN,
        KEY,
        'going',
      ),
    );
    await waitFor(() => expect(clearQueuedRsvp).toHaveBeenCalledWith(TOKEN));
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(
        /going/i,
      ),
    );
    expect(screen.queryByTestId('invite-rsvp-queued')).toBeNull();
  });

  test('a held answer the server refuses stops being held, rather than promising forever', async () => {
    readQueuedRsvp.mockReturnValue('going');
    readRsvpKey.mockReturnValue(KEY);
    submitAnonRsvp.mockResolvedValue('refused');
    renderPreview();

    await waitFor(() => expect(clearQueuedRsvp).toHaveBeenCalledWith(TOKEN));
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-error')).toBeTruthy());
    // ...and the delivery path says the same durable thing the tap path does.
    expect(screen.getByTestId('invite-rsvp-error').textContent).not.toMatch(
      /try again in a moment/i,
    );
    expect(screen.queryByTestId('invite-rsvp-queued')).toBeNull();
  });

  test('a held answer that is STILL unreachable stays held for the next attempt', async () => {
    readQueuedRsvp.mockReturnValue('maybe');
    readRsvpKey.mockReturnValue(KEY);
    submitAnonRsvp.mockResolvedValue('unreachable');
    renderPreview();

    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalled());
    expect(clearQueuedRsvp).not.toHaveBeenCalled();
    expect(screen.getByTestId('invite-rsvp-queued')).toBeTruthy();
  });

  /**
   * A queue we could not WRITE is not a queue. Saying "we'll send it when
   * you're back" over storage that refused the write would be a promise the
   * page cannot keep.
   */
  /**
   * THE LISTENER HAS TO EXIST BEFORE THERE IS ANYTHING TO SEND (round-4 panel,
   * Codex). The delivery effect returned early when the queue was empty on
   * arrival — the ordinary case — and so never installed the `online` handler
   * the "we'll send this the moment you're back" promise depends on. An answer
   * queued later in the same visit then sat there until a reload.
   */
  test('an answer queued during this visit is delivered on reconnect', async () => {
    // Empty at mount, which is what used to skip the listener entirely.
    readQueuedRsvp.mockReturnValue(null);
    submitAnonRsvp.mockResolvedValue('unreachable');
    readRsvpKey.mockReturnValue(KEY);
    renderPreview();

    screen.getByTestId('invite-rsvp-maybe').click();
    await waitFor(() => expect(queueRsvp).toHaveBeenCalledWith(TOKEN, 'maybe'));
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-queued')).toBeTruthy());

    // Now the answer IS queued, and the network is back.
    readQueuedRsvp.mockReturnValue('maybe');
    submitAnonRsvp.mockResolvedValue('sent');
    submitAnonRsvp.mockClear();
    window.dispatchEvent(new Event('online'));

    await waitFor(() =>
      expect(submitAnonRsvp).toHaveBeenCalledWith(
        expect.anything(),
        TOKEN,
        KEY,
        'maybe',
      ),
    );
    await waitFor(() => expect(clearQueuedRsvp).toHaveBeenCalledWith(TOKEN));
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(
        /maybe/i,
      ),
    );
  });

  /**
   * THE TWO WRITERS TAKE ONE LOCK (round-5 panel, both lanes). The automatic
   * delivery and an explicit tap upsert the same row; before this, a tap during
   * an in-flight delivery raced it, and whichever committed last decided both
   * the stored answer and what the surface claimed was on record.
   */
  test('a tap during an automatic delivery cannot race it', async () => {
    readQueuedRsvp.mockReturnValue('maybe');
    readRsvpKey.mockReturnValue(KEY);
    // Hold the automatic delivery open.
    let release: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValue(
      new Promise<'sent'>((resolve) => {
        release = resolve;
      }),
    );

    renderPreview();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // The controls are visibly in flight rather than silently swallowing taps.
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-going').click();
    expect(
      submitAnonRsvp,
      'an explicit tap issued a second write while a delivery held the lock',
    ).toHaveBeenCalledTimes(1);

    release('sent');
    await waitFor(() => expect(clearQueuedRsvp).toHaveBeenCalledWith(TOKEN));
  });

  /**
   * BOTH HALVES OF THE FLAG ARE RESET TOGETHER (round-9 panel).
   *
   * Round 3 cleared `rsvpBusy` — the STATE, which is only what paints
   * `disabled` — when the token changed, and left `rsvpBusyRef`, which is the
   * lock both writers actually take. So the next invite rendered enabled RSVP
   * buttons whose every tap returned at the guard: visibly answerable, silently
   * inert. A request for the previous invite that never settles held it that
   * way for good.
   */
  test('a hung write for the previous invite cannot lock the next one', async () => {
    readRsvpKey.mockReturnValue(KEY);
    // The write for invite A never settles.
    submitAnonRsvp.mockReturnValueOnce(new Promise<'sent'>(() => undefined));

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // Client-side navigation to a second invitation — Next reuses this
    // component rather than remounting it.
    submitAnonRsvp.mockResolvedValue('sent');
    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() =>
      expect(
        submitAnonRsvp,
        'the new invite rendered enabled controls whose taps the old lock swallowed',
      ).toHaveBeenCalledTimes(2),
    );
    expect(submitAnonRsvp).toHaveBeenLastCalledWith(
      expect.anything(),
      OTHER_TOKEN,
      KEY,
      'going',
    );
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-sent')).toBeTruthy());
  });

  test('the previous invite settling does not release the new one’s lock', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let releaseA: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        releaseA = resolve;
      }),
    );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // Invite B, with a write of its own held open.
    submitAnonRsvp.mockReturnValueOnce(new Promise<'sent'>(() => undefined));
    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(2));

    // A's answer arrives now. It belongs to an invitation nobody is looking at,
    // and the lock it would release is B's.
    releaseA('sent');
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-maybe')).toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-maybe').click();
    expect(
      submitAnonRsvp,
      'a stale write released the lock and let a second write start under it',
    ).toHaveBeenCalledTimes(2);
  });

  /**
   * Round-10 round 4, Codex. The two tests above pushed the lock toward being
   * CLEARED on a token change; this one is what that clearing broke. Going back
   * to an invite whose write is still out could start a second write for the
   * same row, and the upsert is last-write-wins, so the earlier choice could
   * land last while the screen showed the later one. The lock names its invite
   * now, which is what lets all three hold at once.
   */
  test('returning to an invite whose write is still out cannot start a second one', async () => {
    readRsvpKey.mockReturnValue(KEY);
    // A's write never settles.
    submitAnonRsvp.mockReturnValueOnce(new Promise<'sent'>(() => undefined));

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    const toB = (
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />
    );
    const toA = (
      <InvitePreview
        token={TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />
    );

    // A → B, which must NOT be blocked by A's outstanding write...
    rerender(toB);
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );

    // ...then B → A, where A's first write is still in flight. The controls
    // must LOOK busy, not merely behave as if they were: this assertion was
    // written the other way round in round 4 and the round-5 panel filed
    // exactly that — enabled buttons whose every tap the guard swallowed in
    // silence, which the component elsewhere says must never be offered.
    rerender(toA);
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-maybe')).toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-maybe').click();

    expect(
      submitAnonRsvp,
      'a second write for the same invite started while the first was still out',
    ).toHaveBeenCalledTimes(1);
  });

  /**
   * Round-10 round 6, BOTH lanes. The round-5 fix derived `rsvpBusy` from the
   * lock at the moment of a token change, which fixed "enabled but inert" — and
   * created its mirror image. A write settling AFTER the recipient came back to
   * its own invite takes the stale branch, releases the hold, and used to
   * return without touching `rsvpBusy`. The token had not changed, so nothing
   * re-derived it: three buttons disabled for good.
   */
  test('a write settling after you return re-enables the invite it was blocking', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let releaseA: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        releaseA = resolve;
      }),
    );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // A → B → A, with A's write still out the whole way.
    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    rerender(
      <InvitePreview
        token={TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-maybe')).toBeDisabled(),
    );

    // Now it answers. The hold goes, and so must the disabled state.
    releaseA('sent');
    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-maybe'),
        'the invite stayed disabled after the write it was waiting for settled',
      ).not.toBeDisabled(),
    );

    // And it is genuinely answerable again, not merely repainted.
    submitAnonRsvp.mockResolvedValue('sent');
    screen.getByTestId('invite-rsvp-maybe').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(2));
  });

  /**
   * Round-10 round 7, Claude. Every revision of this lock reasoned from "Next
   * reuses this component across A → B without remounting" and stopped there.
   * Leaving the night-out route entirely UNMOUNTS it, and an instance-scoped
   * set meant the returning recipient got an empty lock — so a second write
   * could start while the first was still out, and two last-write-wins upserts
   * could leave the server on the older choice.
   */
  test('an UNMOUNT does not forget a write that is still out', async () => {
    readRsvpKey.mockReturnValue(KEY);
    submitAnonRsvp.mockReturnValueOnce(new Promise<'sent'>(() => undefined));

    const first = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // Away from the route entirely, then back — a remount, not a token swap.
    first.unmount();
    renderPreview();

    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-maybe'),
        'the remounted invite offered controls while its own write was still out',
      ).toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-maybe').click();
    expect(
      submitAnonRsvp,
      'a remount let a second write start for an invite that already had one in flight',
    ).toHaveBeenCalledTimes(1);
  });

  /**
   * Round-10 round 7, Codex. The stale branch released the lock and spent the
   * queue but never painted, so a recipient who came back to their own invite
   * saw every choice unpressed while the server held the answer they had sent.
   */
  test('a write that succeeds after you return shows the answer it recorded', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let releaseA: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        releaseA = resolve;
      }),
    );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    rerender(
      <InvitePreview
        token={TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );

    // The re-entry read has to LAND FIRST — that is the order the finding
    // describes, and it is what makes the write the last word. Releasing while
    // the read is still out would just be testing which promise resolved first.
    await waitFor(() => expect(fetchAnonRsvp).toHaveBeenCalledTimes(3));

    releaseA('sent');
    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-going'),
        'the recorded answer was never painted after a stale settle',
      ).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  test('a hung write for ANOTHER invite is still remembered when you come back to it', async () => {
    readRsvpKey.mockReturnValue(KEY);
    // A's write never settles. B's does.
    submitAnonRsvp.mockReturnValueOnce(new Promise<'sent'>(() => undefined));

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // B, answered and settled — this is what a single-slot lock forgot A for.
    submitAnonRsvp.mockResolvedValue('sent');
    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(2));

    // Back to A, whose write is STILL out. A set remembers it; one slot did not.
    rerender(
      <InvitePreview
        token={TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-maybe')).toBeDisabled(),
    );
    screen.getByTestId('invite-rsvp-maybe').click();
    expect(
      submitAnonRsvp,
      'taking a second invite’s lock forgot the first invite’s outstanding write',
    ).toHaveBeenCalledTimes(2);
  });

  /**
   * Round-10 round 5, Claude. The stale-settle branch returned BEFORE the
   * `sent` handling, so a successful write that landed after a token change
   * left an older queued answer in storage. Returning to that invite
   * auto-delivered it, and the last-write-wins upsert replaced the recipient's
   * newer answer — the older-answer-lands-last defect, reached through the
   * stale door. A sent answer is sent whoever is on screen.
   */
  test('a successful write that settles after navigation still spends its queue', async () => {
    readRsvpKey.mockReturnValue(KEY);
    // An older answer is already held for A.
    readQueuedRsvp.mockReturnValue('maybe');

    let releaseA: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        releaseA = resolve;
      }),
    );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // Away to B before A's write answers.
    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );

    clearQueuedRsvp.mockClear();
    releaseA('sent');

    await waitFor(() =>
      expect(
        clearQueuedRsvp,
        'the stale branch returned before spending the queue, so the older answer survived',
      ).toHaveBeenCalledWith(TOKEN),
    );
  });

  /**
   * ROUND-10 ROUND 8, both lanes. Module scope fixed the writes racing but put
   * the lock's span past the span of the thing that paints from it: the settle
   * runs in the UNMOUNTED instance's closure, where every setState is a no-op,
   * and the live instance derived `rsvpBusy` once at mount and was never told
   * again. Three disabled buttons and no message until a reload.
   */
  test('a write that settles after an unmount and remount gives the controls back', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let release: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        release = resolve;
      }),
    );

    const first = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    // Leaving the night-out route entirely — the bottom nav, a back gesture.
    // Not the A → B → A reuse every earlier revision reasoned about.
    first.unmount();
    renderPreview();
    // The hold survives, which is the point of module scope: coming back to an
    // invite whose write is still out looks busy.
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).toBeDisabled(),
    );

    release('sent');
    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-going'),
        'the settle released the hold in a dead closure and never told this instance',
      ).not.toBeDisabled(),
    );
  });

  /**
   * ROUND-10 ROUND 8, both lanes. The stale branch painted the answer that
   * landed but left `answered.current` false, so a re-entry read still in the
   * air — carrying a snapshot from before the write committed — passed the
   * guard and painted the un-answered state straight over it.
   */
  test('an answer painted by a stale settle survives the re-entry read', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let releaseWrite: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        releaseWrite = resolve;
      }),
    );
    // Reads: mount A, the move to B, and the return to A — the last of which is
    // the one that must not win. It was issued before the write committed, so
    // the answer it carries is honestly "none"; it is simply older.
    let releaseRead: (value: { kind: 'none' }) => void = () => undefined;
    fetchAnonRsvp
      .mockResolvedValueOnce({ kind: 'none' })
      .mockResolvedValueOnce({ kind: 'none' })
      .mockReturnValueOnce(
        new Promise<{ kind: 'none' }>((resolve) => {
          releaseRead = resolve;
        }),
      );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    const at = (token: string): JSX.Element => (
      <InvitePreview
        token={token}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />
    );
    rerender(at(OTHER_TOKEN));
    rerender(at(TOKEN));
    await waitFor(() => expect(fetchAnonRsvp).toHaveBeenCalledTimes(3));

    releaseWrite('sent');
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(/going/i),
    );

    releaseRead({ kind: 'none' });
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-sent')).toBeTruthy());
    expect(
      screen.getByTestId('invite-rsvp-sent').textContent,
      'the delayed re-entry read overwrote an answer the server already held',
    ).toMatch(/going/i);
  });

  /**
   * ROUND-10 ROUND 8, Codex. V8-R-INV-003's "an offline response is queued and
   * explicitly labelled as not yet sent" is a property of the ANSWER, not of
   * what happens to be on screen when it fails. The stale branch dropped it:
   * the answer was never sent, never held, and nothing said so.
   */
  test('an offline write that fails after navigation is still queued', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let release: (value: 'unreachable') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'unreachable'>((resolve) => {
        release = resolve;
      }),
    );

    const { rerender } = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    rerender(
      <InvitePreview
        token={OTHER_TOKEN}
        preview={PREVIEW}
        signedIn={false}
        onSignIn={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-going')).not.toBeDisabled(),
    );

    queueRsvp.mockClear();
    release('unreachable');
    await waitFor(() =>
      expect(
        queueRsvp,
        'the stale branch bypassed the offline queue, losing the answer entirely',
      ).toHaveBeenCalledWith(TOKEN, 'going'),
    );
  });

  /**
   * ROUND-10 ROUND 9, Claude gate — the half of the round-8 fix that was
   * missing. `epoch` is per-instance and an UNMOUNT never moves it, so the
   * settle takes the LIVE branch and paints into a dead component. Round 8
   * taught the STALE branch to paint the answer; a remount never reaches it.
   * The controls came back, unpressed, on an invite the server had recorded.
   */
  test('a write that settles after a remount shows the answer, not just the buttons', async () => {
    readRsvpKey.mockReturnValue(KEY);
    let release: (value: 'sent') => void = () => undefined;
    submitAnonRsvp.mockReturnValueOnce(
      new Promise<'sent'>((resolve) => {
        release = resolve;
      }),
    );
    // The remounted instance's own read is still in flight and carries a
    // snapshot from BEFORE the write committed — the second half of the defect.
    let releaseRead: (value: { kind: 'none' }) => void = () => undefined;
    fetchAnonRsvp.mockResolvedValueOnce({ kind: 'none' }).mockReturnValueOnce(
      new Promise<{ kind: 'none' }>((resolve) => {
        releaseRead = resolve;
      }),
    );

    const first = renderPreview();
    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() => expect(submitAnonRsvp).toHaveBeenCalledTimes(1));

    first.unmount();
    renderPreview();
    await waitFor(() => expect(fetchAnonRsvp).toHaveBeenCalledTimes(2));

    release('sent');
    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-sent').textContent,
        'the settle painted into the dead instance and the remount learned nothing',
      ).toMatch(/going/i),
    );

    // ...and the older read may not undo it.
    releaseRead({ kind: 'none' });
    await waitFor(() => expect(screen.getByTestId('invite-rsvp-sent')).toBeTruthy());
    expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(/going/i);
  });

  /**
   * ROUND-10 ROUND 9, Codex. The label rendered only when `rsvp === null`,
   * which is right for a FIRST answer and silently wrong for a changed one: a
   * recipient whose server answer is Maybe and who queues Going offline saw
   * Maybe pressed and Going marked by a dashed border alone. V8-R-INV-003 wants
   * it "explicitly labelled as not yet sent", and a border is not a label.
   */
  test('a queued answer that REPLACES one on record is still labelled as unsent', async () => {
    readRsvpKey.mockReturnValue(KEY);
    fetchAnonRsvp.mockResolvedValue({ kind: 'ok', choice: 'maybe' });
    readQueuedRsvp.mockReturnValue('going');
    submitAnonRsvp.mockResolvedValue('unreachable');

    renderPreview();

    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-sent').textContent).toMatch(/maybe/i),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('invite-rsvp-queued').textContent,
        'the held answer differed from the one on record and nothing said it was unsent',
      ).toMatch(/not sent yet/i),
    );
  });

  test('says the answer was not sent when the queue itself could not be written', async () => {
    submitAnonRsvp.mockResolvedValue('unreachable');
    queueRsvp.mockReturnValue(false);
    renderPreview();

    screen.getByTestId('invite-rsvp-going').click();
    await waitFor(() =>
      expect(screen.getByTestId('invite-rsvp-error').textContent).toMatch(
        /hasn't been sent/i,
      ),
    );
    expect(screen.queryByTestId('invite-rsvp-queued')).toBeNull();
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
