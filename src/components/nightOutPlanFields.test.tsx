import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE THREE ROWS OF THE START A NIGHT OUT FORM (V8-R-NO-002, NO-003, NO-005).
 *
 * Migration 0068 grew `starts_at`, `area` and `voting_closes_at` plus their
 * three owner-only writers in round 4. Nothing in `src` called any of them for
 * five rounds, so all three approved requirements were unreachable from the
 * product: the ledger names "the Start a Night Out form" as their entry point
 * and that form had a CTA and nothing else. These tests pin the rows and the
 * one property every one of them states — a row never blocks the CTA, and a
 * refused edit is never silent.
 */

const setNightOutStart = vi.fn();
const setNightOutArea = vi.fn();
const setNightOutVotingDeadline = vi.fn();
let presence: { barId: string | null } | null = null;

vi.mock('@/lib/nightOutPlan', () => ({
  setNightOutStart: (...a: unknown[]) => setNightOutStart(...a),
  setNightOutArea: (...a: unknown[]) => setNightOutArea(...a),
  setNightOutVotingDeadline: (...a: unknown[]) => setNightOutVotingDeadline(...a),
}));
vi.mock('@/lib/catalog', () => ({
  getBarById: (id: string) =>
    id === 'attaboy' ? { id, name: 'Attaboy', neighborhood: 'Lower East Side' } : undefined,
}));
vi.mock('@/lib/nightKey', () => ({
  nycNightKey: (at: Date = new Date()) =>
    at.getTime() >= Date.parse('2026-08-21T08:00:00.000Z')
      ? '2026-08-21'
      : '2026-08-20',
}));
vi.mock('@/app/friends/_components/usePinnedHandles', () => ({
  useMyPresence: () => presence,
}));

import { useNightOutPlanFields } from './NightOutPlanFields';

const PLAN = '11111111-1111-4111-8111-111111111111';
const supabase = {} as never;

/**
 * A host for the hook that also exposes `apply` as a button, as the form does —
 * and RENDERS WHAT APPLY RETURNED, because the caller owns that message now.
 * The hook used to paint it itself, which is how it came to be rendered into
 * the wrong account's view and then destroyed by navigation.
 */
function Harness({
  hasInvitees = true,
  identity = null,
}: {
  hasInvitees?: boolean;
  identity?: string | null;
}): JSX.Element {
  const planFields = useNightOutPlanFields({ hasInvitees, identity });
  const [refused, setRefused] = useState<readonly string[] | null>(null);
  return (
    <div>
      {planFields.fields}
      <button
        type="button"
        data-testid="create"
        onClick={() => void planFields.apply(supabase, PLAN).then(setRefused)}
      >
        Start
      </button>
      {refused !== null ? (
        <p data-testid="refused">{refused.length === 0 ? 'none' : refused.join(' or ')}</p>
      ) : null}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Mid-evening on the night of the 20th, well inside that night key.
  vi.setSystemTime(Date.parse('2026-08-21T01:30:00.000Z'));
  presence = null;
  setNightOutStart.mockResolvedValue(true);
  setNightOutArea.mockResolvedValue(true);
  setNightOutVotingDeadline.mockResolvedValue(true);
});

describe('the When row (V8-R-NO-002)', () => {
  test('shows tonight at 9:00 PM as a value, not a placeholder', () => {
    render(<Harness />);
    // "the default is visible, not hidden behind a tap" — in the field itself,
    // not offered as a placeholder the owner has to accept.
    const when = screen.getByLabelText('When') as HTMLInputElement;
    expect(when.value).toBe('2026-08-20T21:00');
    expect(when.placeholder).toBe('');
  });

  test('an untouched default is not written — it is already the server’s', async () => {
    render(<Harness />);
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutArea).not.toHaveBeenCalled());
    expect(setNightOutStart).not.toHaveBeenCalled();
  });

  /**
   * The instant is pinned ABSOLUTELY, not recomputed with the same rule the
   * code uses, and not with `new Date(value)` — which reads the naive string in
   * whatever zone the test runner happens to sit in and would therefore pass on
   * a New York machine and fail everywhere else, while asserting nothing about
   * the zone at all. 22:30 on 2026-08-20 in New York is EDT, UTC-4.
   */
  test('an edited time is written as an instant read in America/New_York', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-08-20T22:30' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutStart).toHaveBeenCalledTimes(1));
    expect(setNightOutStart).toHaveBeenCalledWith(
      supabase,
      PLAN,
      '2026-08-21T02:30:00.000Z',
    );
  });

  /**
   * The EDT case above and this EST one together are what make the assertion
   * discriminating: a device-zone parse answers 22:30 in the RUNNER's zone for
   * both, and a fixed-offset implementation answers the same offset for both.
   * Only a real America/New_York conversion gets UTC-4 in August and UTC-5 in
   * January. Stated plainly: on a runner that is itself in New York these two
   * would also pass against the old device-zone parse — the zone this suite
   * runs in is not something the lane can read under its command guard — so
   * they are a correct pin everywhere and a regression catcher everywhere but
   * there.
   */
  test('a winter time is read in EST, so the offset is not hardcoded', async () => {
    // 2026-01-15 is EST, UTC-5. Same wall clock, a different instant.
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-01-15T22:30' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutStart).toHaveBeenCalledTimes(1));
    expect(setNightOutStart).toHaveBeenCalledWith(
      supabase,
      PLAN,
      '2026-01-16T03:30:00.000Z',
    );
  });

  test('clearing the When row says the 9:00 PM default will be used', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '' } });
    expect(screen.getByTestId('when-missing')).toBeTruthy();

    // The default IS what happens — a night out must start somewhere — so the
    // row states it rather than the owner discovering it on the plan.
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe('none'));
    expect(setNightOutStart).not.toHaveBeenCalled();
  });

  /**
   * `set_night_out_start` bounds the start to the plan's own night, so a time
   * on another day is declined server-side with nothing on screen explaining
   * why. Said in the row instead, and not attempted.
   */
  test('a time on a different night is explained rather than sent', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-08-22T22:00' },
    });
    expect(screen.getByTestId('when-off-night')).toBeTruthy();
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutArea).not.toHaveBeenCalled());
    expect(setNightOutStart).not.toHaveBeenCalled();
  });
});

describe('the Area row (V8-R-NO-003)', () => {
  test('is labelled optional and starts empty with no pin tonight', () => {
    render(<Harness />);
    expect(screen.getByText(/optional/i)).toBeTruthy();
    expect((screen.getByLabelText(/^Area/) as HTMLInputElement).value).toBe('');
  });

  test('reuses the area already known from Tonight', () => {
    presence = { barId: 'attaboy' };
    render(<Harness />);
    expect((screen.getByLabelText(/^Area/) as HTMLInputElement).value).toBe(
      'Lower East Side',
    );
  });

  test('the inherited area is a seed, not a lock — clearing it is a state', async () => {
    presence = { barId: 'attaboy' };
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Area/), { target: { value: '' } });
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('create')).toBeTruthy());
    expect(setNightOutArea).not.toHaveBeenCalled();
  });

  test('an entered area is written trimmed', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: '  East Village  ' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutArea).toHaveBeenCalledTimes(1));
    expect(setNightOutArea).toHaveBeenCalledWith(supabase, PLAN, 'East Village');
  });
});

describe('the Voting closes row (V8-R-NO-005)', () => {
  test('is absent on a solo plan and present once somebody is selected', () => {
    const solo = render(<Harness hasInvitees={false} />);
    expect(screen.queryByText('No deadline')).toBeNull();
    solo.unmount();

    render(<Harness />);
    expect(screen.getByText('No deadline')).toBeTruthy();
  });

  test('defaults to No deadline, which needs no write', async () => {
    render(<Harness />);
    expect((screen.getByLabelText('No deadline') as HTMLInputElement).checked).toBe(
      true,
    );
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('create')).toBeTruthy());
    expect(setNightOutVotingDeadline).not.toHaveBeenCalled();
  });

  test('a picked time is written, and stated in words', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Pick a time'));
    fireEvent.change(screen.getByLabelText('Voting closes at'), {
      target: { value: '2026-08-20T22:00' },
    });
    // "expressed in time and remaining minutes in words, never by colour alone"
    expect(screen.getByTestId('deadline-remaining').textContent).toMatch(
      /in about \d+ (minute|hour)/,
    );
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutVotingDeadline).toHaveBeenCalledTimes(1));
    // America/New_York, EDT: 22:00 on the 20th is 02:00Z on the 21st.
    expect(setNightOutVotingDeadline).toHaveBeenCalledWith(
      supabase,
      PLAN,
      '2026-08-21T02:00:00.000Z',
    );
  });
});

describe('the drafts belong to an account', () => {
  /**
   * Round-10 round 2, Codex. `useAuth` updates IN PLACE on a cross-tab
   * sign-out and sign-in, with no unmount, so the rows kept A's edits and
   * `apply` wrote A's When and Area onto B's plan.
   */
  test('an in-place identity change clears every row', async () => {
    const view = render(<Harness identity="user-a" />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-08-20T23:45' },
    });
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    fireEvent.click(screen.getByLabelText('Pick a time'));

    view.rerender(<Harness identity="user-b" />);

    expect((screen.getByLabelText('When') as HTMLInputElement).value).toBe(
      '2026-08-20T21:00',
    );
    expect((screen.getByLabelText(/^Area/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('No deadline') as HTMLInputElement).checked).toBe(true);

    // And nothing of A's reaches B's plan.
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe('none'));
    expect(setNightOutStart).not.toHaveBeenCalled();
    expect(setNightOutArea).not.toHaveBeenCalled();
    expect(setNightOutVotingDeadline).not.toHaveBeenCalled();
  });
});

describe('a refusal is RETURNED, never swallowed and never painted here', () => {
  test('names each edit the server declined', async () => {
    setNightOutStart.mockResolvedValue(false);
    setNightOutArea.mockResolvedValue(false);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-08-20T22:30' },
    });
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByTestId('create').click();
    await waitFor(() =>
      expect(screen.getByTestId('refused').textContent).toBe('the time or the area'),
    );
  });

  test('returns an EMPTY list when everything landed', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe('none'));
    expect(setNightOutArea).toHaveBeenCalledTimes(1);
  });

  /**
   * The hook must not render the refusal itself. It did, and the message then
   * belonged to a component the caller navigates away from — and to whichever
   * account happened to be on screen when the RPC settled. Both panels filed
   * it; this is the assertion that keeps it fixed.
   */
  test('the rows themselves render no refusal message', async () => {
    setNightOutArea.mockResolvedValue(false);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe('the area'));
    expect(
      screen.getByTestId('night-out-plan-fields').textContent,
    ).not.toMatch(/couldn|could not/i);
  });
});

describe('the two defects the round-10 panel found by triggering them', () => {
  /**
   * CODEX, HIGH. The default start was captured by `useState` at mount, so a
   * form left open across the 4:00 AM rollover displayed YESTERDAY at 9:00 PM
   * while `createNightOut` used today's key — and `apply` skipped the write as
   * "unchanged", so nothing corrected it. The stub's night key flips at
   * 2026-08-21T08:00:00Z, which is 4:00 AM New York.
   */
  test('an untouched When row follows the rollover instead of freezing at mount', async () => {
    render(<Harness />);
    expect((screen.getByLabelText('When') as HTMLInputElement).value).toBe(
      '2026-08-20T21:00',
    );

    // Cross 4:00 AM with the form still open, then re-render.
    vi.setSystemTime(Date.parse('2026-08-21T08:30:00.000Z'));
    fireEvent.change(screen.getByLabelText(/^Area/), { target: { value: 'x' } });
    expect((screen.getByLabelText('When') as HTMLInputElement).value).toBe(
      '2026-08-21T21:00',
    );
    // And it is not an off-night start, because it moved with the night.
    expect(screen.queryByTestId('when-off-night')).toBeNull();

    // Still nothing to write: untouched means "the server's own default".
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutArea).toHaveBeenCalledTimes(1));
    expect(setNightOutStart).not.toHaveBeenCalled();
  });

  /**
   * CLAUDE, MEDIUM. "Pick a time" with the field left blank pushed "the voting
   * deadline" onto the refusal list without any RPC being called — a refusal
   * attributed to a server that was never asked, delivered after the fact.
   */
  test('a blank deadline is stated in the row, and is not reported as a refusal', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Pick a time'));
    expect(screen.getByTestId('deadline-missing')).toBeTruthy();

    screen.getByTestId('create').click();
    await waitFor(() => expect(screen.getByTestId('refused').textContent).toBe('none'));
    expect(setNightOutVotingDeadline).not.toHaveBeenCalled();

    // Filling it in clears the notice and restores the real write.
    fireEvent.change(screen.getByLabelText('Voting closes at'), {
      target: { value: '2026-08-21T22:00' },
    });
    expect(screen.queryByTestId('deadline-missing')).toBeNull();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
