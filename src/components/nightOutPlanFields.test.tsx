import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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

/** A host for the hook that also exposes `apply` as a button, as the form does. */
function Harness({ hasInvitees = true }: { hasInvitees?: boolean }): JSX.Element {
  const planFields = useNightOutPlanFields({ hasInvitees });
  return (
    <div>
      {planFields.fields}
      <button
        type="button"
        data-testid="create"
        onClick={() => void planFields.apply(supabase, PLAN)}
      >
        Start
      </button>
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

  test('an edited time is written as an instant', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2026-08-20T22:30' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutStart).toHaveBeenCalledTimes(1));
    expect(setNightOutStart).toHaveBeenCalledWith(
      supabase,
      PLAN,
      new Date('2026-08-20T22:30').toISOString(),
    );
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
    expect(setNightOutVotingDeadline).toHaveBeenCalledWith(
      supabase,
      PLAN,
      new Date('2026-08-20T22:00').toISOString(),
    );
  });
});

describe('a refusal is reported, never swallowed', () => {
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
      expect(screen.getByTestId('plan-fields-refused').textContent).toMatch(
        /the time or the area/,
      ),
    );
  });

  test('says nothing when everything landed', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByTestId('create').click();
    await waitFor(() => expect(setNightOutArea).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('plan-fields-refused')).toBeNull();
  });
});
