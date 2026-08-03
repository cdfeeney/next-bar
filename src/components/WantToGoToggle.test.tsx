import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WantToGoToggle from './WantToGoToggle';
import { WANT_TO_GO_KEY, loadWantToGo } from '@/lib/wantToGo';
import {
  __resetAdaptersForTests,
  registerAdapter,
  type AnalyticsEnvelope,
} from '@/lib/analyticsAdapters';

/**
 * The restored Want-to-Go writer (goal g-8557db39). Unit level pins the
 * contract the e2e cannot cheaply assert: exactly ONE persistence path
 * (the shared lib), state-bearing accessible names, and idempotent writes.
 */

describe('WantToGoToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('writes through the shared persistence and reflects state in the accessible name', async () => {
    const user = userEvent.setup();
    render(<WantToGoToggle barId="bar-1" barName="Attaboy" />);

    const save = screen.getByRole('button', { name: 'Save Attaboy to Want to go' });
    expect(save).toHaveAttribute('aria-pressed', 'false');

    await user.click(save);

    // Persisted via lib/wantToGo — the facade now stores saves in the
    // Lists model (g-ac3a291c), so assert through the same API every
    // consumer reads rather than the retired legacy key.
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['bar-1']);
    expect(window.localStorage.getItem('next-bar:lists:v1')).toContain('bar-1');

    const remove = screen.getByRole('button', {
      name: 'Remove Attaboy from Want to go',
    });
    expect(remove).toHaveAttribute('aria-pressed', 'true');

    await user.click(remove);
    expect(loadWantToGo()).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'Save Attaboy to Want to go' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('hydrates as saved when the bar is already in the list', () => {
    window.localStorage.setItem(
      WANT_TO_GO_KEY,
      JSON.stringify([{ barId: 'bar-2', addedAt: '2026-08-01T00:00:00.000Z' }]),
    );
    render(<WantToGoToggle barId="bar-2" barName="Dead Rabbit" />);
    expect(
      screen.getByRole('button', { name: 'Remove Dead Rabbit from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('a second surface mounted LATER hydrates as saved', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WantToGoToggle barId="bar-3" barName="Bar Three" />);
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    unmount();
    render(<WantToGoToggle barId="bar-3" barName="Bar Three" variant="full" />);
    expect(screen.getByRole('button', { name: /^Remove/ })).toBeInTheDocument();
    expect(loadWantToGo()).toHaveLength(1);
  });

  it('TWO toggles for the same bar mounted at once stay in sync (both directions)', async () => {
    // Santa: Claude+Codex convergent — ResultCard mounts BarLightbox as a
    // SIBLING, so two live toggles for one bar is the normal case this
    // feature exists to keep consistent. The sync rides lib/wantToGo's
    // synthesized storage event; without a test, dropping that listener
    // would ship silently.
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="card">
          <WantToGoToggle barId="bar-4" barName="Twin Bar" />
        </div>
        <div data-testid="dialog">
          <WantToGoToggle barId="bar-4" barName="Twin Bar" variant="full" />
        </div>
      </>,
    );

    const inCard = () =>
      within(screen.getByTestId('card')).getByRole('button', { name: /Want to go$/ });
    const inDialog = () =>
      within(screen.getByTestId('dialog')).getByRole('button', { name: /Want to go$/ });

    // Save from the DIALOG — the card's toggle must follow without remount.
    await user.click(inDialog());
    expect(inDialog()).toHaveAttribute('aria-pressed', 'true');
    expect(inCard()).toHaveAttribute('aria-pressed', 'true');
    expect(inCard()).toHaveAccessibleName('Remove Twin Bar from Want to go');
    expect(loadWantToGo()).toHaveLength(1);

    // Unsave from the CARD — the dialog's toggle must follow too.
    await user.click(inCard());
    expect(inCard()).toHaveAttribute('aria-pressed', 'false');
    expect(inDialog()).toHaveAttribute('aria-pressed', 'false');
    expect(loadWantToGo()).toEqual([]);
  });

  it('double-clicking Save on one instance writes exactly one entry', async () => {
    const user = userEvent.setup();
    render(<WantToGoToggle barId="bar-5" barName="Double Bar" />);
    const button = screen.getByRole('button', { name: /Want to go$/ });
    await user.dblClick(button);
    // Click 1 saves, click 2 (now "Remove") unsaves — the invariant is that
    // no double-write can ever produce a duplicate entry.
    expect(loadWantToGo().filter((e) => e.barId === 'bar-5')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    expect(loadWantToGo().filter((e) => e.barId === 'bar-5')).toHaveLength(1);
  });

  describe('dark analytics (g-ee6c250d): save emits ONE name-only event, only on success', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      __resetAdaptersForTests();
    });

    it('a successful save emits exactly one {v,name:"save"}; remove emits nothing', async () => {
      vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
      const seen: AnalyticsEnvelope[] = [];
      registerAdapter({ name: 'spy', capture: (e) => seen.push(e) });
      const user = userEvent.setup();
      render(<WantToGoToggle barId="bar-9" barName="Attaboy" />);
      await user.click(screen.getByRole('button', { name: /^Save/ }));
      expect(seen).toEqual([{ v: 1, name: 'save' }]);
      await user.click(screen.getByRole('button', { name: /^Remove/ }));
      expect(seen).toHaveLength(1); // removal is not a save
    });

    it('with the master flag absent no event reaches any adapter', async () => {
      const seen: AnalyticsEnvelope[] = [];
      registerAdapter({ name: 'spy', capture: (e) => seen.push(e) });
      const user = userEvent.setup();
      render(<WantToGoToggle barId="bar-10" barName="Attaboy" />);
      await user.click(screen.getByRole('button', { name: /^Save/ }));
      expect(seen).toEqual([]);
    });
  });
});
