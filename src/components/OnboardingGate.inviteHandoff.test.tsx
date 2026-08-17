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

vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => ({ handle }),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
}));

import OnboardingGate, { isSafeReturnPath } from './OnboardingGate';

const PLAN_PATH = '/night-out/2f1c9e2a-0000-4000-8000-000000000000';

beforeEach(() => {
  replaced.length = 0;
  handle = null; // a brand-new account: signed in, no handle yet
  window.sessionStorage.clear();
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
});
