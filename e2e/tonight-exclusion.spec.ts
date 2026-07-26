/**
 * tonight-exclusion.spec.ts — E3.1 "not the places I've already been
 * tonight."
 *
 * Self-referential and catalog-independent: the test discovers the top
 * result Y for a seed bar X, VISITS Y through the real flow (picking a
 * seed records the visit — E4.1), then proves Y no longer surfaces from
 * X the same night, and DOES surface again after the 6am rollover (the
 * night log forgets). Fixed clock throughout; Fri 11pm keeps the
 * open-now filter permissive.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const FRIDAY_11PM = new Date('2026-07-24T23:00:00');
const SATURDAY_10PM = new Date('2026-07-25T22:00:00'); // past the 6am rollover

const SEED = 'Attaboy';

async function pickSeed(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('textbox', { name: 'Search bars' }).fill(name);
  await page
    .getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .first()
    .click();
  await expect(
    page.locator('article').filter({ hasText: /Vibe match/i }).first(),
  ).toBeVisible();
}

async function topResultName(page: import('@playwright/test').Page) {
  const heading = page
    .locator('article')
    .filter({ hasText: /Vibe match/i })
    .first()
    .getByRole('heading')
    .first();
  const text = (await heading.innerText()).trim();
  // "1. Bar Name" → "Bar Name"
  return text.replace(/^\d+\.\s*/, '');
}

// Card headings render as "N. Bar Name" — match the name anywhere in the
// accessible name (role-name string matching is full-string).
function nameRegex(name: string) {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

test.describe('E3.1 tonight-exclusion', () => {
  test('a bar visited tonight stops surfacing; the rollover brings it back', async ({
    page,
  }) => {
    // Four full search cycles + a reload — WebKit needs the 3× budget
    // (same treatment as bias-smoke).
    test.slow();
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_11PM);
    await page.goto('/');

    // Search from X and learn tonight's would-be next stop Y.
    await pickSeed(page, SEED);
    const nextStop = await topResultName(page);
    expect(nextStop).not.toBe(SEED);

    // Go there: picking Y as the new seed records the visit (E4.1).
    await page.getByRole('button', { name: /Pick a different bar/i }).click();
    await pickSeed(page, nextStop);

    // Y's own results exclude Y (it's the seed) — sanity.
    await expect(
      page
        .locator('article')
        .filter({ hasText: /Vibe match/i })
        .getByRole('heading', { name: nameRegex(nextStop) }),
    ).toHaveCount(0);

    // Back at X: Y was the TOP result minutes ago, and now it never
    // surfaces — it's where we already are/were tonight.
    await page.getByRole('button', { name: /Pick a different bar/i }).click();
    await pickSeed(page, SEED);
    await expect(
      page
        .locator('article')
        .filter({ hasText: /Vibe match/i })
        .getByRole('heading', { name: nameRegex(nextStop) }),
    ).toHaveCount(0);

    // NEXT NIGHT (past 6am): the log is last night's, the exclusion set
    // is empty, and Y surfaces from X again.
    await page.clock.setFixedTime(SATURDAY_10PM);
    await page.reload();
    await pickSeed(page, SEED);
    await expect(
      page
        .locator('article')
        .filter({ hasText: /Vibe match/i })
        .getByRole('heading', { name: nameRegex(nextStop) }),
    ).not.toHaveCount(0);
  });
});
