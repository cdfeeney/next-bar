/**
 * home-phase.spec.ts — E2.4/E3.4 phase-adaptive home.
 *
 * The header chip always shows the derived night phase; tapping it opens
 * all four phases (R10: any phase reachable in ≤2 taps); the choice
 * persists for the night (R11) and the rollover forgets it. Planning and
 * recap LEAD with their card while the find-a-bar flow stays on the
 * screen (fail-safe — a wrong guess never strands the user, R5).
 *
 * All tests pin the clock (page.clock) so phase derivation is
 * deterministic at any wall-clock hour. Times are LOCAL-format strings
 * (no Z) so the derived hour matches on any runner timezone.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const SUNDAY_2PM = new Date('2026-07-26T14:00:00');
const MONDAY_2PM = new Date('2026-07-27T14:00:00');
const SUNDAY_9AM = new Date('2026-07-26T09:00:00');

test.describe('Phase-adaptive home (E2.4/E3.4)', () => {
  test('midday derives Planning: chip + plan card lead, the flow stays reachable below (R5)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(SUNDAY_2PM);
    await page.goto('/');

    // Chip shows the derived phase.
    const chip = page.getByRole('button', { name: /Night phase: Planning/i });
    await expect(chip).toBeVisible();

    // Planning leads with the plan-entry card → /friends/consensus.
    const planCard = page.getByTestId('phase-card-planning');
    await expect(planCard).toBeVisible();
    await expect(
      planCard.getByRole('link', { name: /Plan tonight/i }),
    ).toHaveAttribute('href', '/friends/consensus');

    // Fail-safe: the find-a-bar flow is still on this screen (denied geo
    // → manual picker), not replaced by the card.
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();
  });

  test('R10: every phase reachable in two taps; the choice persists tonight and the rollover forgets it (R11)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(SUNDAY_2PM);
    await page.goto('/');

    // Tap 1 opens the switcher with ALL four phases.
    await page.getByRole('button', { name: /Night phase:/i }).click();
    const group = page.getByRole('group', { name: 'Night phase' });
    for (const label of ['Planning', 'Starting out', 'Out now', 'Last night']) {
      await expect(group.getByRole('button', { name: label })).toBeVisible();
    }

    // Tap 2 lands the new phase: chip updates, planning card leaves.
    await group.getByRole('button', { name: 'Out now' }).click();
    await expect(
      page.getByRole('button', { name: /Night phase: Out now/i }),
    ).toBeVisible();
    await expect(page.getByTestId('phase-card-planning')).toHaveCount(0);

    // R11: the override survives a reload the same night…
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Night phase: Out now/i }),
    ).toBeVisible();

    // …and a NEW night derives fresh (midday next day → Planning again).
    await page.clock.setFixedTime(MONDAY_2PM);
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Night phase: Planning/i }),
    ).toBeVisible();
    await expect(page.getByTestId('phase-card-planning')).toBeVisible();
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

    await expect(
      page.getByRole('button', { name: /Night phase: Last night/i }),
    ).toBeVisible();
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
