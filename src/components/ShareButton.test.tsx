// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShareButton from './ShareButton';
import {
  __resetAdaptersForTests,
  registerAdapter,
  type AnalyticsEnvelope,
} from '@/lib/analyticsAdapters';

/**
 * Dark-analytics share boundary (g-ee6c250d crit 1): a SUCCESSFUL share or
 * copy emits exactly one name-only 'share'; a dismissed sheet emits
 * nothing (dismiss ≠ consent, same rule as the clipboard). Flag absent →
 * silence.
 */
describe('ShareButton dark analytics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __resetAdaptersForTests();
  });

  const spy = (): AnalyticsEnvelope[] => {
    const seen: AnalyticsEnvelope[] = [];
    registerAdapter({ name: 'spy', capture: (e) => seen.push(e) });
    return seen;
  };

  it('clipboard success emits exactly one share event', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    const seen = spy();
    // No navigator.share in jsdom → clipboard fallback path.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const user = userEvent.setup();
    render(<ShareButton text="hello" label="Share" />);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByRole('button', { name: 'Copied to clipboard' });
    expect(seen).toEqual([{ v: 1, name: 'share' }]);
  });

  it('a dismissed native sheet emits nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    const seen = spy();
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('abort'), { name: 'AbortError' }),
        ),
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const user = userEvent.setup();
    render(<ShareButton text="hello" label="Share" />);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(seen).toEqual([]);
  });

  it('with the master flag absent a successful copy emits nothing', async () => {
    const seen = spy();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const user = userEvent.setup();
    render(<ShareButton text="hello" label="Share" />);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByRole('button', { name: 'Copied to clipboard' });
    expect(seen).toEqual([]);
  });
});
