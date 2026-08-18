import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Criterion 2: "no authenticated response can populate member state after
 * sign-out" — and its sibling, no response for plan A may populate the view of
 * plan B.
 *
 * Both panels filed the absence of this file, not a defect in the guard: the
 * epoch guard is four lines of subtle code protecting PRIVATE member data, and
 * it was verified only by prose. A guard nothing exercises is a guard nobody
 * knows is still connected — the next refactor of `loadMemberView` silently
 * removes it and every other test stays green.
 *
 * The mocks are deliberately DEFERRED (`Deferred` below) rather than resolved.
 * The whole defect lives in the window between issuing an authenticated read
 * and painting its answer, so a test that cannot hold a response open cannot
 * express it — which is how this stayed untested through three rounds.
 */

class Deferred<T> {
  readonly promise: Promise<T>;
  private settle!: (value: T) => void;
  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.settle = resolve;
    });
  }
  resolve(value: T): void {
    this.settle(value);
  }
}

const OWNER_PRIVATE_NAME = 'Private Member Name';

type Auth = { status: 'loading' | 'signed-in' | 'signed-out'; user?: { id: string } };
let auth: Auth = { status: 'signed-in', user: { id: 'u1' } };

const resolveByToken = vi.fn();
const getNightOut = vi.fn();
const getNightOutMembers = vi.fn();
const getNightOutBoard = vi.fn();
const previewNightOut = vi.fn();
const joinNightOutByToken = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/catalog', () => ({
  getBarById: () => null,
}));

vi.mock('@/lib/pendingInvite', () => ({
  consumePendingInvite: vi.fn(),
  peekPendingInvite: () => null,
  storePendingInvite: vi.fn(),
}));

vi.mock('@/lib/nightOuts.server', () => ({
  resolveNightOutByToken: (...a: unknown[]) => resolveByToken(...a),
  getNightOut: (...a: unknown[]) => getNightOut(...a),
  getNightOutMembers: (...a: unknown[]) => getNightOutMembers(...a),
  getNightOutBoard: (...a: unknown[]) => getNightOutBoard(...a),
  previewNightOut: (...a: unknown[]) => previewNightOut(...a),
  cancelNightOut: vi.fn(),
  decideNightOut: vi.fn(),
  declineNightOutByToken: vi.fn(),
  isNightOutFullByToken: vi.fn(),
  joinNightOutByToken: (...a: unknown[]) => joinNightOutByToken(...a),
  respondNightOut: vi.fn(),
  suggestNightOutBar: vi.fn(),
  voteNightOutBar: vi.fn(),
}));

import NightOutPage from './page';

const TOKEN_A = '11111111-1111-4111-8111-111111111111';
const TOKEN_B = '22222222-2222-4222-8222-222222222222';

function planFor(title: string) {
  return {
    id: `plan-${title}`,
    night: '2026-08-20',
    title,
    status: 'open' as const,
    decidedBarId: null,
    ownerHandle: 'host',
    ownerDisplayName: 'Host',
    shareToken: TOKEN_A,
    callerRole: 'member' as const,
    callerStatus: 'accepted' as const,
  };
}

const PRIVATE_MEMBERS = [
  {
    userId: 'u9',
    handle: 'private',
    displayName: OWNER_PRIVATE_NAME,
    role: 'member' as const,
    inviteStatus: 'accepted' as const,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth = { status: 'signed-in', user: { id: 'u1' } };
});

describe('the plan page never paints an answer the view has moved on from', () => {
  test('an authenticated load settling AFTER sign-out shows no private member data', async () => {
    const heldPlan = new Deferred<ReturnType<typeof planFor>>();
    const heldMembers = new Deferred<typeof PRIVATE_MEMBERS>();
    const heldBoard = new Deferred<never[]>();

    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockReturnValue(heldPlan.promise);
    getNightOutMembers.mockReturnValue(heldMembers.promise);
    getNightOutBoard.mockReturnValue(heldBoard.promise);
    previewNightOut.mockResolvedValue({
      night: '2026-08-20',
      title: 'A night out',
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 2,
    });

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await waitFor(() => expect(getNightOut).toHaveBeenCalled());

    // The user signs out while the authenticated read is still in flight.
    auth = { status: 'signed-out' };
    view.rerender(<NightOutPage params={{ token: TOKEN_A }} />);

    // ...and only now does the authenticated answer arrive.
    heldPlan.resolve(planFor('A night out'));
    heldMembers.resolve(PRIVATE_MEMBERS);
    heldBoard.resolve([]);

    // The signed-out view settles into the bearer preview.
    await waitFor(() => expect(screen.getByText("You're invited")).toBeTruthy());

    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      'a stale authenticated load put private member data in front of a signed-out viewer',
    ).toBeNull();
    expect(
      screen.queryByText(/Who's in/),
      'the member board rendered for a signed-out viewer',
    ).toBeNull();
  });

  test('a load for plan A cannot paint under plan B when the token changes', async () => {
    const heldPlanA = new Deferred<ReturnType<typeof planFor>>();
    const heldMembersA = new Deferred<typeof PRIVATE_MEMBERS>();
    const heldBoardA = new Deferred<never[]>();

    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockReturnValueOnce(heldPlanA.promise);
    getNightOutMembers.mockReturnValueOnce(heldMembersA.promise);
    getNightOutBoard.mockReturnValueOnce(heldBoardA.promise);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await waitFor(() => expect(getNightOut).toHaveBeenCalled());

    // Client-side navigation to a DIFFERENT plan. Next reuses this component —
    // no remount, no sign-out, so nothing about auth changes.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    getNightOutBoard.mockResolvedValue([]);
    auth = { status: 'signed-in', user: { id: 'u1' } };
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);

    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    // Plan A's answer arrives late, addressed to a screen that has moved on.
    heldPlanA.resolve(planFor("A's night out"));
    heldMembersA.resolve(PRIVATE_MEMBERS);
    heldBoardA.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText("A's night out"),
      "plan A's member state painted under plan B's URL",
    ).toBeNull();
    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      "plan A's member list leaked into plan B's view",
    ).toBeNull();
    expect(screen.getByText("B's night out")).toBeTruthy();
  });

  test('a join issued on plan A cannot paint plan A after navigating to plan B', async () => {
    /**
     * The hole the epoch guard still had (cold-panel round 2, Codex).
     *
     * `loadMemberView` read the epoch when IT was called, but every direct
     * caller awaits a write first. So the sequence "tap Join on A / navigate to
     * B / A's join resolves" reached the guard after the epoch had already
     * moved, captured B's epoch, compared it against itself, and passed — then
     * painted A's private member board under B's URL. The view identity has to
     * be captured before the write, not before the read that follows it.
     */
    const heldJoin = new Deferred<string>();

    // Signed-in NON-member: the page settles on the bearer preview, which is
    // the only surface that offers Join.
    resolveByToken.mockResolvedValue(null);
    previewNightOut.mockResolvedValue({
      night: '2026-08-20',
      title: "A's night out",
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 2,
    });
    joinNightOutByToken.mockReturnValue(heldJoin.promise);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    const join = await screen.findByRole('button', { name: /join this night out/i });
    join.click();
    await waitFor(() => expect(joinNightOutByToken).toHaveBeenCalled());

    // Client-side navigation to plan B while the join RPC is still open.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    getNightOutBoard.mockResolvedValue([]);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);
    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    // Plan A's join finally lands. Its follow-up read must never be issued.
    getNightOut.mockResolvedValue(planFor("A's night out"));
    getNightOutMembers.mockResolvedValue(PRIVATE_MEMBERS);
    heldJoin.resolve('plan-A');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText("A's night out"),
      "a join for plan A repainted the screen while plan B was open",
    ).toBeNull();
    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      "plan A's member list leaked into plan B's view through the join handler",
    ).toBeNull();
    expect(screen.getByText("B's night out")).toBeTruthy();
  });

  test("plan A's preview stops being a live control the moment the token changes", async () => {
    /**
     * Round-3 panel (Codex, HIGH). The epoch effect cleared only the 'member'
     * view, because the argument for clearing was about LEAKING private data
     * and a preview is public bearer data. What that missed is what a stale
     * view can still DO: plan A's preview stayed on screen under plan B's URL,
     * and its Join button reads `token` from the CURRENT render — so tapping
     * the Join under A's title and A's host joined B.
     */
    const heldPreviewB = new Deferred<{
      night: string; title: string; ownerHandle: string;
      ownerDisplayName: string; acceptedCount: number;
    }>();

    // Signed-in non-member on plan A: the page settles on A's preview.
    resolveByToken.mockResolvedValue(null);
    previewNightOut.mockResolvedValueOnce({
      night: '2026-08-20',
      title: "A's night out",
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 2,
    });

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await screen.findByRole('button', { name: /join this night out/i });
    expect(screen.getByText("A's night out")).toBeTruthy();

    // Client-side navigation to plan B. B's preview is held open, which is the
    // whole window: whatever is on screen now belongs to A but is addressed by
    // B's token.
    previewNightOut.mockReturnValueOnce(heldPreviewB.promise);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);

    await waitFor(() =>
      expect(
        screen.queryByText("A's night out"),
        "plan A's preview stayed on screen under plan B's URL",
      ).toBeNull(),
    );
    expect(
      screen.queryByRole('button', { name: /join this night out/i }),
      "plan A's Join button survived the token change, wired to plan B",
    ).toBeNull();
    expect(
      joinNightOutByToken,
      'a join fired from a view whose identity had already moved on',
    ).not.toHaveBeenCalled();

    // And the new view still arrives normally once its own read settles.
    heldPreviewB.resolve({
      night: '2026-08-20',
      title: "B's night out",
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 1,
    });
    expect(await screen.findByText("B's night out")).toBeTruthy();
  });

  test("a join whose follow-up read is refused does not announce itself on the next plan", async () => {
    /**
     * Round-4 panel (Codex). `loadMemberView` returning false is AMBIGUOUS: it
     * means either "the read failed" or "the view moved on and I refused to
     * paint". The handler treated both as a read failure and called
     * setActionError unguarded, so a stale abort printed "You're in — but this
     * page couldn't load" over whatever plan is now on screen.
     */
    const heldPlanA = new Deferred<ReturnType<typeof planFor>>();

    resolveByToken.mockResolvedValue(null);
    previewNightOut.mockResolvedValueOnce({
      night: '2026-08-20',
      title: "A's night out",
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 2,
    });
    // The join resolves immediately; its follow-up member read is what we hold,
    // so the epoch moves DURING loadMemberView rather than before it.
    joinNightOutByToken.mockResolvedValue('plan-A');
    getNightOut.mockReturnValueOnce(heldPlanA.promise);
    getNightOutMembers.mockResolvedValue(PRIVATE_MEMBERS);
    getNightOutBoard.mockResolvedValue([]);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    (await screen.findByRole('button', { name: /join this night out/i })).click();
    await waitFor(() => expect(joinNightOutByToken).toHaveBeenCalled());

    // Navigate to plan B while plan A's follow-up read is still open.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);
    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    // Now plan A's read settles. loadMemberView refuses to paint — correctly —
    // and the handler must not mistake that refusal for a failure.
    heldPlanA.resolve(planFor("A's night out"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText(/You're in/i),
      "plan A's join announced itself over plan B",
    ).toBeNull();
    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      "plan A's member list leaked into plan B's view",
    ).toBeNull();
    expect(screen.getByText("B's night out")).toBeTruthy();
  });

  test("plan A's share notice does not offer its invite link from plan B", async () => {
    /**
     * Round-5 panel (Codex). The epoch effect cleared the view state but not the
     * auxiliary state around it. When the clipboard write is refused, the share
     * notice holds plan A's URL as a selectable fallback — and it sat there under
     * plan B, offering one plan's invite link from another plan's page.
     */
    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockResolvedValue(planFor("A's night out"));
    getNightOutMembers.mockResolvedValue(PRIVATE_MEMBERS);
    getNightOutBoard.mockResolvedValue([]);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await screen.findByText("A's night out");

    // Clipboard refused: the notice becomes the URL itself.
    Object.assign(navigator, {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    (await screen.findByRole('button', { name: /copy invite link/i })).click();
    await waitFor(() => expect(screen.getByText(new RegExp(TOKEN_A))).toBeTruthy());

    // Navigate to plan B.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);
    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    expect(
      screen.queryByText(new RegExp(TOKEN_A)),
      "plan A's invite link was still on offer from plan B's page",
    ).toBeNull();
  });
  test('a clipboard rejection settling after the token changed says nothing', async () => {
    /**
     * Round-6 panel (Codex). The clipboard write is an await like any other, so
     * its continuation belongs to the view that started it. A late rejection
     * printed plan A's bearer URL as a fallback under plan B.
     */
    let reject: (reason: unknown) => void = () => {};
    const held = new Promise((_resolve, r) => {
      reject = r;
    });
    Object.assign(navigator, { clipboard: { writeText: () => held } });

    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockResolvedValue(planFor("A's night out"));
    getNightOutMembers.mockResolvedValue(PRIVATE_MEMBERS);
    getNightOutBoard.mockResolvedValue([]);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await screen.findByText("A's night out");
    (await screen.findByRole('button', { name: /copy invite link/i })).click();

    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);
    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    reject(new Error('denied'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText(new RegExp(TOKEN_A)),
      "a late clipboard rejection printed plan A's invite link under plan B",
    ).toBeNull();
  });

  test('the initial load for plan A cannot paint after the token changes', async () => {
    /**
     * Round-6 panel (Claude). The loading effect awaited resolveNightOutByToken
     * and then called loadMemberView with NO captured epoch, so it captured
     * whatever epoch was current when it finally ran. `cancelled` did not cover
     * it: the epoch bump is a LAYOUT effect that runs inside the commit, while
     * this effect's cleanup runs in the later passive flush, so between them the
     * epoch has moved and `cancelled` is still false.
     *
     * Holding the resolve is what expresses that window here.
     */
    const heldResolve = new Deferred<string>();
    resolveByToken.mockReturnValueOnce(heldResolve.promise);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await waitFor(() => expect(resolveByToken).toHaveBeenCalled());

    // Plan B takes over the mounted route while A's resolve is still open.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    getNightOutBoard.mockResolvedValue([]);
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);
    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    // A's resolve finally answers, pointing at A's private member board.
    getNightOut.mockResolvedValue(planFor("A's night out"));
    getNightOutMembers.mockResolvedValue(PRIVATE_MEMBERS);
    heldResolve.resolve('plan-A');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText("A's night out"),
      "plan A's initial load painted under plan B's URL",
    ).toBeNull();
    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      "plan A's member list leaked into plan B's view through the loading effect",
    ).toBeNull();
    expect(screen.getByText("B's night out")).toBeTruthy();
  });
});

/**
 * A STATIC guard, and the honest reason it is static.
 *
 * The epoch must advance inside the commit, not in a passive effect that flushes
 * in a task after paint — otherwise a response settling in between compares the
 * old epoch against itself, passes, and paints the previous view's private data
 * into the committed new one (round-5 panel, Codex).
 *
 * That window cannot be expressed in this suite: Testing Library wraps render
 * and rerender in `act()`, which flushes passive effects synchronously before
 * returning, so `useEffect` and `useLayoutEffect` are indistinguishable here —
 * every behavioral test above passes either way, which is exactly why this
 * assertion exists. A static guard is the honest fallback, not a substitute; it
 * fails if someone downgrades the effect, which is the regression that would
 * otherwise ship green.
 */
describe('the view epoch advances inside the commit', () => {
  test('the initial loading effect captures its epoch before its first await', () => {
    // Same environment limit as the layout-effect assertion below, and it was
    // caught the same way: reverting this fix leaves every behavioral test in
    // this file green, because `act()` runs the effect cleanup synchronously on
    // rerender, so `cancelled` covers the window that a real browser leaves
    // open between the commit and the passive flush. The behavioral test above
    // proves the view does not leak; only this proves it is the EPOCH doing it.
    //
    // The region is SLICED, not searched from an offset. The first version of
    // this guard used indexOf(needle, effectStart) and passed against a
    // deliberately broken page, because the join handler further down the file
    // contains the identical call and satisfied the search.
    const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    const from = source.indexOf('let cancelled = false;');
    const to = source.indexOf('}, [auth.status, token, loadMemberView]);', from);
    expect(from, 'the loading effect moved or was renamed').toBeGreaterThan(-1);
    expect(to, 'the loading effect no longer ends where expected').toBeGreaterThan(from);
    const effect = source.slice(from, to);

    const capture = effect.indexOf('const startedAt = viewEpoch.current;');
    const firstAwait = effect.indexOf('await resolveNightOutByToken');
    expect(capture, 'the loading effect captures no epoch of its own').toBeGreaterThan(-1);
    expect(
      capture,
      'the epoch is captured AFTER the first await, which is the defect itself',
    ).toBeLessThan(firstAwait);
    expect(
      effect.includes('loadMemberView(planId, startedAt)'),
      'the loading effect does not pass its captured epoch down',
    ).toBe(true);
  });

  test('the epoch effect is a layout effect', () => {
    const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    const epochAt = source.indexOf('viewEpoch.current += 1;');
    expect(epochAt, 'the epoch bump moved or was renamed').toBeGreaterThan(-1);
    const opener = source.lastIndexOf('useLayoutEffect(() => {', epochAt);
    const passive = source.lastIndexOf('useEffect(() => {', epochAt);
    expect(
      opener,
      'the epoch bump is not inside a useLayoutEffect',
    ).toBeGreaterThan(-1);
    expect(
      opener,
      'a passive effect now sits between useLayoutEffect and the epoch bump',
    ).toBeGreaterThan(passive);
  });
});
