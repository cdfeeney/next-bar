import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Account root is a TAB; the Settings stack below it is not
 * (V8-R-NAV-001, and the push/pop relationship V8-R-ACC-005 depends on).
 *
 * This is the negative assertion that is easy to lose: `/settings` keeps the
 * five-tab nav, and every route BELOW it must not have one. Getting that wrong
 * does not look broken — it looks like a settings page with a tab bar, which
 * is exactly how a hierarchical stack quietly becomes a sixth tab.
 */

let pathname = '/settings';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));
vi.mock('@/hooks/useFollowRequests', () => ({
  useFollowRequests: () => ({ requests: [] }),
}));

import BottomNav from '@/components/BottomNav';
import { StackHeader } from './_ui';

beforeEach(() => {
  pathname = '/settings';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the Account root keeps the five-tab nav', () => {
  it('renders exactly the five approved tabs, and no sixth', () => {
    pathname = '/settings';
    render(<BottomNav />);

    const tabs = screen.getAllByRole('link');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Map',
      'Rankings',
      'Next Bar?',
      'Social',
      'Account',
    ]);
  });

  it('marks Account as the current tab on the root', () => {
    pathname = '/settings';
    render(<BottomNav />);

    expect(
      screen.getByRole('link', { name: 'Account' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

describe('the Settings stack carries no bottom nav', () => {
  it.each([
    '/settings/preferences',
    '/settings/profile',
    '/settings/security',
    '/settings/connections/blocked',
  ])('renders nothing on %s', (route) => {
    pathname = route;
    const { container } = render(<BottomNav />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('every screen in the stack has an explicit way back', () => {
  it('renders a labelled back link to the route it was pushed from', () => {
    render(<StackHeader title="Edit profile" backHref="/settings/preferences" />);

    const back = screen.getByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute('href', '/settings/preferences');
  });

  it('uses an explicit href, so a deep link has somewhere to go', () => {
    // history.back() would leave a deep-linked stack screen with nothing to
    // return to — the reason StackHeader takes a route rather than calling the
    // router.
    render(<StackHeader title="Settings" backHref="/settings" />);

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });
});
