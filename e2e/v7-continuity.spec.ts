import { expect, test } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const STORED = {
  'next-bar:ratings:v1': JSON.stringify([
    {
      barId: 'attaboy',
      rating: 'loved',
      ratedAt: '2026-08-12T23:00:00-04:00',
      score: 8.8,
    },
    {
      barId: 'death-and-co',
      rating: 'loved',
      ratedAt: '2026-08-12T23:30:00-04:00',
      score: 8.8,
    },
    {
      barId: 'bar-54',
      rating: 'loved',
      ratedAt: '2026-08-12T23:45:00-04:00',
      score: 9.4,
    },
  ]),
  'next-bar:lists:v1': JSON.stringify([
    {
      id: 'v7-favorites',
      name: 'V7 favorites',
      barIds: ['attaboy', 'death-and-co', 'bar-54'],
      createdAt: '2026-08-12T20:00:00-04:00',
      updatedAt: '2026-08-12T23:30:00-04:00',
    },
  ]),
  'next-bar:night-log:v1': JSON.stringify({
    night: '2026-08-12',
    visits: [
      { barId: 'attaboy', at: '2026-08-12T22:30:00-04:00' },
      { barId: 'death-and-co', at: '2026-08-12T23:30:00-04:00' },
      { barId: 'bar-54', at: '2026-08-12T23:45:00-04:00' },
    ],
  }),
  'next-bar:profile:v1': JSON.stringify({
    tags: ['cocktail', 'rooftop'],
    preferredNeighborhoods: ['Midtown'],
    archetype: 'Skyline Sipper',
    savedAt: '2026-08-12T20:00:00-04:00',
  }),
};

test('V7 Bar 54, tied scores, lists, vibe profile, and night history survive navigation and reload', async ({
  page,
}) => {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(new Date('2026-08-13T09:00:00-04:00'));
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem('v7-continuity-seeded')) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    sessionStorage.setItem('v7-continuity-seeded', '1');
  }, STORED);

  await page.goto('/rankings');
  await expect(page.getByLabel(/^score 8\.8 out of 10/i)).toHaveCount(2);
  await expect(
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('next-bar:ratings:v1') ?? '[]').some(
        (rating: { barId?: string }) => rating.barId === 'bar-54',
      ),
    ),
  ).resolves.toBe(true);

  await page.goto('/lists');
  await expect(page.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^V7 favorites 3 bars$/ })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('Your quiz answers are saved.')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('recap-card')).toContainText('Attaboy');
  await expect(page.getByTestId('recap-card')).toContainText('Death & Co');
  await expect(
    page.evaluate(
      (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
      Object.keys(STORED),
    ),
  ).resolves.toEqual(STORED);
});
