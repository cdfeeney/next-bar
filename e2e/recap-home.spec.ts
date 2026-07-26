/**
 * recap-home.spec.ts — E4.2 auto-recap + E4.5 recap home phase.
 *
 * The morning after a logged night, home leads with the composed recap:
 * stops in order, the Loved one named in the headline, rank CTA. Zero
 * input — the seeded night log IS the artifact. The no-log morning
 * keeps the plain nudge card (home-phase.spec.ts covers its links), and
 * the phase now derives from the night LOG alone — no intent required.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const SUNDAY_9AM = new Date('2026-07-26T09:00:00');
// lastNightKey(SUNDAY_9AM) — the night that just ended.
const LAST_NIGHT = '2026-07-25';

test.describe('E4.2/E4.5 recap home', () => {
  test('a logged night renders the composed recap: stops in order, Loved headline, rank CTA', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.addInitScript(
      ([night]) => {
        window.localStorage.setItem(
          'next-bar:night-log:v1',
          JSON.stringify({
            night,
            visits: [
              { barId: 'attaboy', at: `${night}T22:30:00-04:00` },
              { barId: 'mister-paradise', at: `${night}T23:45:00-04:00` },
            ],
          }),
        );
        window.localStorage.setItem(
          'next-bar:ratings:v1',
          JSON.stringify([
            {
              barId: 'attaboy',
              rating: 'loved',
              ratedAt: `${night}T23:00:00-04:00`,
            },
          ]),
        );
      },
      [LAST_NIGHT],
    );
    await page.clock.setFixedTime(SUNDAY_9AM);
    await page.goto('/');

    // Phase derives from the night log alone (no intent seeded).
    await expect(
      page.getByRole('button', { name: /Night phase: Last night/i }),
    ).toBeVisible();

    const recap = page.getByTestId('recap-card');
    await expect(recap).toBeVisible();

    // Headline: stop count + the Loved bar by name.
    await expect(recap.getByText(/2 stops · you loved Attaboy/i)).toBeVisible();

    // The route, in order.
    const rows = recap.locator('ol li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Attaboy');
    await expect(rows.nth(1)).toContainText('Mister Paradise');

    // Mister Paradise is unrated → the rank CTA leads.
    await expect(
      recap.getByRole('link', { name: /Rank last night/i }),
    ).toHaveAttribute('href', '/rankings');

    // The find-a-bar flow is still on the screen below (R5).
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();
  });

  test('no logged night: the plain nudge card keeps the slot, no recap composition', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    // Recap phase via last-night intent only — log stays empty.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'next-bar:intent:v1',
        JSON.stringify({ status: 'here', setAt: '2026-07-25T23:00:00' }),
      );
    });
    await page.clock.setFixedTime(SUNDAY_9AM);
    await page.goto('/');

    await expect(page.getByTestId('phase-card-recap')).toBeVisible();
    await expect(page.getByTestId('recap-card')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /Rank last night/i }),
    ).toHaveAttribute('href', '/rankings');
  });
});
