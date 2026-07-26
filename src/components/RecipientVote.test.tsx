import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RecipientVote from './RecipientVote';
import { loadRatings } from '@/lib/ratings';

const BAR_ID = 'death-and-co';

function renderVote() {
  return render(<RecipientVote barId={BAR_ID} barName="Death & Co" />);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('RecipientVote — signed-out recipient', () => {
  it('offers all three ratings without asking for an account', () => {
    renderVote();

    expect(screen.getByRole('button', { name: /Loved it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Liked it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pass/i })).toBeTruthy();
    expect(screen.getByText(/No signup, no email/i)).toBeTruthy();
  });

  it('persists the vote for a signed-out visitor', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));

    const stored = loadRatings();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ barId: BAR_ID, rating: 'loved' });
  });

  it('marks the chosen rating as pressed', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Liked it/i }));

    expect(
      screen.getByRole('button', { name: /Liked it/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /Loved it/i }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('lets the recipient change their mind', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pass/i }));

    const stored = loadRatings();
    expect(stored).toHaveLength(1);
    expect(stored[0].rating).toBe('pass');
  });

  // Review Q3: re-tapping the current choice must not un-vote. setRating is a
  // write, not a toggle — it keeps the pairwise-derived score on a same-tier
  // re-tap — but nothing in the component said so, so lock it.
  it('does not un-vote when the recipient re-taps their current choice', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));
    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));

    const stored = loadRatings();
    expect(stored).toHaveLength(1);
    expect(stored[0].rating).toBe('loved');
    expect(
      screen.getByRole('button', { name: /Loved it/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('announces the three choices as one named group', () => {
    renderVote();

    const group = screen.getByRole('group', { name: /Your rating/i });
    expect(group).toBeTruthy();
    expect(group.querySelectorAll('button')).toHaveLength(3);
  });

  it('announces the confirmation rather than only showing it', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Pass/i }));

    expect(screen.getByRole('status').textContent).toMatch(/your list started/i);
  });

  it('rewards the vote with the list, never a signup form', () => {
    renderVote();
    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));

    const cta = screen.getByRole('link', { name: /See your list/i });
    expect(cta.getAttribute('href')).toBe('/rankings');
  });

  // The negative assertion that matters: nowhere in this component, before or
  // after casting, is there a route to /auth. A signup wall in front of the one
  // moment of intent the share bought is how the loop stayed open.
  it('never links to /auth, before or after casting', () => {
    const { container } = renderVote();
    expect(container.querySelector('a[href^="/auth"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Loved it/i }));
    expect(container.querySelector('a[href^="/auth"]')).toBeNull();
  });

  it('shows the pre-vote prompt only until a vote exists', () => {
    renderVote();
    expect(screen.queryByText(/That is your list started/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Pass/i }));
    expect(screen.getByText(/That is your list started/i)).toBeTruthy();
    expect(screen.queryByText(/No signup, no email/i)).toBeNull();
  });

  it('reflects a rating the visitor already had', () => {
    window.localStorage.setItem(
      'next-bar:ratings:v1',
      JSON.stringify([
        { barId: BAR_ID, rating: 'loved', ratedAt: '2026-07-26T00:00:00.000Z' },
      ]),
    );

    renderVote();

    expect(
      screen.getByRole('button', { name: /Loved it/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
