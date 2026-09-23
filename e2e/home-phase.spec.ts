/**
 * home-phase.spec.ts — E2.4/E3.4 phase-adaptive home.
 *
 * NB-01 (owner 2026-09-23) removed the header phase chip: the phase is
 * now DERIVED only (clock + intent + night log), never chosen. What is
 * left of the contract: the planning phase shows NO lead card (QA5-S1),
 * and the morning after a committed night the recap card LEADS while the
 * find-a-bar flow stays on the screen (fail-safe — a wrong guess never
 * strands the user, R5).
 *
 * All tests pin the clock (page.clock) so phase derivation is
 * deterministic at any wall-clock hour. Times are LOCAL-format strings
 * (no Z) so the derived hour matches on any runner timezone.
 */

import { test, expect } from './helpers/test';
import { denyGeolocation } from './helpers/geo';

const SUNDAY_2PM = new Date('2026-07-26T14:00:00');
const SUNDAY_9AM = new Date('2026-07-26T09:00:00');

test.describe('Phase-adaptive home (E2.4/E3.4)', () => {
  test('midday derives Planning: no chip, no planning lead card (QA5-S1 + NB-01)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(SUNDAY_2PM);
    await page.goto('/');

    // The find-a-bar flow renders as the screen (denied geo → manual
    // picker).
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();

    // NB-01: the header carries the wordmark only — no phase chip.
    await expect(page.getByRole('button', { name: /Night phase/i })).toHaveCount(0);
    await expect(page.getByText('Planning', { exact: true })).toHaveCount(0);

    // QA5-S1 (operator 2026-07-26): the planning-phase lead card is GONE
    // from home — the Friends tab owns Plan Night Out.
    await expect(page.getByTestId('phase-card-planning')).toHaveCount(0);
  });

  test('the morning after a committed night derives Last night: recap card points at rankings', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    // Last night's intent: physically at a bar at 11pm.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'next-bar:intent:v1',
        JSON.stringify({ status: 'here', setAt: '2026-07-25T23:00:00' }),
      );
    });
    await page.clock.setFixedTime(SUNDAY_9AM);
    await page.goto('/');

    const recapCard = page.getByTestId('phase-card-recap');
    await expect(recapCard).toBeVisible();
    await expect(
      recapCard.getByRole('link', { name: /Rank last night/i }),
    ).toHaveAttribute('href', '/rankings');

    // The flow is still reachable below the card (R5).
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();
  });
});
