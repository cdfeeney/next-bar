import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapFilterSheet from '@/components/MapFilterSheet';
import { EMPTY_FILTERS, type FindBarFilters } from '@/lib/findBarFilters';

/**
 * MapFilterSheet — what the sheet SHOWS and what Apply STORES must agree.
 *
 * This exists because of a review finding and a failed test. The scenario: a
 * user applies "Walkable" while located, then loses location. `filterBars`
 * deliberately no-ops radius without coords, and the Distance chips disable, so
 * the row reads "Anywhere" — the user is told distance filtering is off. If
 * Apply then re-emitted the hidden radius, regaining location later would narrow
 * the map to 1.5 miles nobody asked for.
 *
 * The first attempt to cover this was an e2e that drove permissions and called
 * `page.reload()`. It passed against the bug deliberately reintroduced, because
 * the applied filters live in React state and a reload resets them — the
 * scenario was never reachable through it. An assertion nobody has seen fail is
 * not evidence, so it was deleted rather than kept as decoration. These tests
 * exercise the actual unit and were both confirmed to fail against
 * `onApply(draft)` before being committed against `onApply(effectiveDraft)`.
 */

const WALKABLE: FindBarFilters = {
  ...EMPTY_FILTERS,
  radius: { kind: 'walking', maxMiles: 1.5 },
};

describe('MapFilterSheet — radius vs. location', () => {
  test('Apply emits no radius when there is no location to act on', async () => {
    const onApply = vi.fn();
    render(
      <MapFilterSheet
        filters={WALKABLE}
        hasLocation={false}
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    // The user is shown "Anywhere" on the Distance row. (No `\b` after
    // "Distance": jsdom concatenates the row's label and summary spans without
    // a separator, so the accessible name is "DistanceAnywhere".)
    expect(
      screen.getByRole('button', { name: /^Distance/ }),
    ).toHaveTextContent('Anywhere');
    // …and no active-filter badge, because the radius cannot act.
    expect(screen.queryByTestId('filter-count')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^Apply$/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: the hidden radius is NOT re-persisted.
    expect(onApply.mock.calls[0][0].radius).toBeNull();
  });

  test('Apply preserves the radius when there IS a location', async () => {
    const onApply = vi.fn();
    render(
      <MapFilterSheet
        filters={WALKABLE}
        hasLocation
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    // Guard against "fixing" the above by always dropping the radius.
    expect(screen.getByTestId('filter-count')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: /^Apply$/ }));

    expect(onApply.mock.calls[0][0].radius).toEqual({
      kind: 'walking',
      maxMiles: 1.5,
    });
  });

  test('Cancel never reports a value at all', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <MapFilterSheet
        filters={WALKABLE}
        hasLocation
        onApply={onApply}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
