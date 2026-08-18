import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Criterion 1: "a brand-new account opening an invite link, signing up, and
 * completing onboarding lands on THAT plan."
 *
 * Cold whole-artifact panel, HIGH: the gate could fire on the invite landing
 * page and replace the route with /onboarding AFTER that page had spent the
 * pending-invite token, and nothing brought the user back to the plan.
 *
 * The first fix EXCLUDED /night-out from the gate. Fix round 1 (Codex, HIGH)
 * rejected it: excluding the path only DEFERS onboarding to the next
 * navigation, which then ends on `/`. The user reaches the plan and is pulled
 * off it a moment later, so criterion 1 was still unmet — and the test here
 * passed anyway, because it asserted the exclusion rather than the criterion.
 *
 * What is pinned now is the criterion itself: the gate carries WHERE IT
 * INTERRUPTED, and onboarding returns there. The invite token no longer has to
 * win a race it cannot win, which is why the special case for /night-out is
 * gone rather than reinforced.
 */

let pathname = '/rankings';
const replaced: string[] = [];
let handle: string | null = null;

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: (href: string) => replaced.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

let heldProfile: Promise<unknown> | null = null;

vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: () => (heldProfile !== null ? heldProfile : Promise.resolve({ handle })),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
}));

import OnboardingGate, { isSafeReturnPath } from './OnboardingGate';

const PLAN_PATH = '/night-out/2f1c9e2a-0000-4000-8000-000000000000';

beforeEach(() => {
  replaced.length = 0;
  handle = null; // a brand-new account: signed in, no handle yet
  heldProfile = null;
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('OnboardingGate — the invite survives onboarding', () => {
  test('redirects a handle-less account to onboarding on an ordinary route', async () => {
    pathname = '/rankings';
    render(<OnboardingGate />);
    await waitFor(() =>
      expect(replaced).toEqual(['/onboarding?next=%2Frankings']),
    );
  });

  test('DOES onboard on the invite landing, carrying the plan as the return path', async () => {
    pathname = PLAN_PATH;
    render(<OnboardingGate />);
    await waitFor(() =>
      expect(
        replaced,
        'the gate must onboard here — deferring it is what lost the plan',
      ).toEqual([`/onboarding?next=${encodeURIComponent(PLAN_PATH)}`]),
    );
  });

  test('the carried return path is the plan, so onboarding can complete the trip', async () => {
    pathname = PLAN_PATH;
    render(<OnboardingGate />);
    await waitFor(() => expect(replaced.length).toBe(1));

    // The half that criterion 1 actually turns on: whatever onboarding reads
    // back out of the URL must be the plan the user was invited to.
    const next = new URLSearchParams(replaced[0].split('?')[1]).get('next');
    expect(next, 'onboarding would send the new account somewhere else').toBe(PLAN_PATH);
  });

  test('an already-onboarded account is not redirected at all', async () => {
    handle = 'someone';
    pathname = PLAN_PATH;
    render(<OnboardingGate />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replaced).toEqual([]);
  });
});

/**
 * The return path comes out of the URL bar, so it is untrusted input. These are
 * the cases that decide whether it is a redirect or an open redirect.
 */
describe('isSafeReturnPath', () => {
  test('accepts a same-origin absolute path', () => {
    expect(isSafeReturnPath(PLAN_PATH)).toBe(true);
    expect(isSafeReturnPath('/')).toBe(true);
  });

  test('rejects a protocol-relative URL, which browsers resolve OFF-ORIGIN', () => {
    expect(isSafeReturnPath('//evil.example')).toBe(false);
    // Same attack, one character changed — several browsers normalise the
    // backslash to a slash before resolving.
    expect(isSafeReturnPath('/\\evil.example')).toBe(false);
  });

  test('rejects the ASCII tab/newline bypass (round 2, HIGH)', () => {
    // ?next=/%09/evil.example decodes to this. The first version of the check
    // inspected value[1], saw a tab, and allowed it — then the WHATWG URL
    // parser STRIPPED the tab and navigated to //evil.example. Character
    // blacklists lose to the parser, so the check now asks the parser.
    expect(isSafeReturnPath('/\t/evil.example')).toBe(false);
    expect(isSafeReturnPath('/\n/evil.example')).toBe(false);
    expect(isSafeReturnPath('/\r/evil.example')).toBe(false);
    expect(isSafeReturnPath('/\t\\evil.example')).toBe(false);
  });

  test('still accepts ordinary paths with queries and fragments', () => {
    expect(isSafeReturnPath('/friends/consensus?tab=all')).toBe(true);
    expect(isSafeReturnPath('/settings#account')).toBe(true);
  });

  test('rejects a protocol-relative URL naming the CHECK’s own helper host', () => {
    // The round-3 HIGH. The check used to resolve against a fixed sentinel
    // origin so it would behave the same on the server and in jsdom — which
    // made the sentinel itself a reachable target: this value starts with '/',
    // resolved to the sentinel's origin, compared equal, and navigated
    // off-origin for real. The comparison is against window.location.origin
    // now, so there is no third host to aim at.
    expect(isSafeReturnPath('//return-path-check.invalid/evil')).toBe(false);
    expect(isSafeReturnPath('/\t/return-path-check.invalid/evil')).toBe(false);
  });

  test('accepts a protocol-relative URL naming the REAL origin, which is same-origin', () => {
    // Not a hole: this resolves to this very site. Rejecting it would be
    // arbitrary; the property under test is "cannot reach another origin".
    const host = window.location.host;
    expect(isSafeReturnPath(`//${host}/rankings`)).toBe(true);
  });

  test('rejects absolute URLs and anything that is not a path', () => {
    expect(isSafeReturnPath('https://evil.example')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnPath('rankings')).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });

  test('the recovery marker survives the onboarding round trip', async () => {
    // Round-7 panel (Codex). The gate forwarded `pathname` only, so a
    // handle-less account recovering its password was sent to
    // /onboarding?next=/settings, came back to an UNMARKED /settings, and
    // PendingInviteRedirect pulled it to the plan before the password was set.
    pathname = '/settings';
    window.history.replaceState({}, '', '/settings?from=recovery');

    render(<OnboardingGate />);

    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    expect(
      replaced[0],
      'the recovery marker was dropped, so the return trip lands unmarked',
    ).toBe(`/onboarding?next=${encodeURIComponent('/settings?from=recovery')}`);
  });

  test('an ordinary query string is still NOT forwarded', async () => {
    // The original rule holds for everything except the one named marker:
    // nothing attacker-shaped rides back on the return path.
    pathname = '/rankings';
    window.history.replaceState({}, '', '/rankings?utm=x&from=elsewhere');

    render(<OnboardingGate />);

    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    expect(replaced[0]).toBe(`/onboarding?next=${encodeURIComponent('/rankings')}`);
  });

  test('a profile answer for the PREVIOUS route does not redirect the new one', async () => {
    // Round-8 panel (Codex). The effect's `cancelled` flag is cleared by a
    // passive cleanup, which runs after the new route commits — so a fetch
    // started on route A and settling in that window saw cancelled === false and
    // an unchanged cache epoch (the identity did not change, only the route) and
    // redirected the freshly committed route B carrying `next=A`.
    let release: (value: unknown) => void = () => {};
    heldProfile = new Promise((resolve) => {
      release = resolve;
    });

    pathname = '/rankings';
    const view = render(<OnboardingGate />);

    // Route B commits while A's profile fetch is still open.
    pathname = '/map';
    heldProfile = null;
    view.rerender(<OnboardingGate />);
    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    expect(replaced[0], "route B's own redirect did not fire").toBe(
      `/onboarding?next=${encodeURIComponent('/map')}`,
    );

    // Now A's answer lands, addressed to a route the user already left.
    release({ handle: null });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      replaced.filter((h) => h.includes(encodeURIComponent('/rankings'))),
      "a stale profile answer redirected the new route back to the old one",
    ).toEqual([]);
  });
});

/**
 * STATIC guard, same reason as its siblings: `act()` runs the previous effect's
 * cleanup synchronously on rerender, so `cancelled` covers the stale-route
 * window here and the behavioural test above passes with the fix reverted. It
 * proves the redirect does not fire; only this proves the ROUTE identity is what
 * stops it.
 */
describe('the gate answers only for the route it was started on', () => {
  test('the live pathname is committed in a layout effect and compared in the fetch', () => {
    const source = readFileSync(path.join(__dirname, 'OnboardingGate.tsx'), 'utf8');
    const assign = source.indexOf('livePathname.current = pathname;');
    expect(assign, 'the live pathname ref moved or was renamed').toBeGreaterThan(-1);
    const opener = source.lastIndexOf('useLayoutEffect(() => {', assign);
    const passive = source.lastIndexOf('useEffect(() => {', assign);
    expect(opener, 'the live pathname is not committed in a layout effect').toBeGreaterThan(-1);
    expect(opener, 'a passive effect sits between the opener and the assignment').toBeGreaterThan(passive);

    const from = source.indexOf('fetchOwnProfile(supabase).then(');
    const to = source.indexOf('setPromptedFlag();', from);
    expect(from, 'the profile fetch moved').toBeGreaterThan(-1);
    expect(
      source.slice(from, to).includes('livePathname.current !== pathname'),
      'the fetch continuation does not check the route it was started on',
    ).toBe(true);
  });
});

