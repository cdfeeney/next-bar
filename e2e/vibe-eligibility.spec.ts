/**
 * vibe-eligibility.spec.ts
 *
 * V8-R-NXT-009 / D-C-41 on the real surface: an EXPLICIT vibe selection both
 * gates which bars are eligible and is the only thing that puts a match badge
 * on a card.
 *
 * The arithmetic (denominator = N, threshold = max(1, N - 1), dedup) is pinned
 * deterministically in src/lib/matching.test.ts and
 * src/lib/matching.explicitVibe.test.ts. What these carry is the part unit
 * tests cannot: that applying, clearing and re-driving the surface's controls
 * keeps the rendered page honest — no badge without a selection, no 0/N card
 * with one, and no rejected bar reappearing when another control moves.
 *
 * Fixed clock (Fri 11pm) for the same reason as the other results specs: the
 * live surfaces hard-filter KNOWN-closed bars, so counts are only
 * deterministic under a mocked clock.
 */

import { test, expect } from './helpers/catalogTest';
import type { Page } from '@playwright/test';
import { grantGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');
const LES = { latitude: 40.725, longitude: -73.985 };

const cards = (page: Page) => page.getByTestId('result-card');
const badges = (page: Page) => page.getByTestId('vibe-match');

async function reachAutoResults(
  page: Page,
  context: import('@playwright/test').BrowserContext,
): Promise<void> {
  await grantGeolocation(context, LES);
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your next/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(cards(page).first()).toBeVisible();
}

async function openTweak(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Tweak the vibe/i }).click();
  await expect(
    page.getByRole('heading', { name: /Tweak the vibe/i }),
  ).toBeVisible();
}

/** Toggle one chip, leaving the surface open. */
async function toggleChip(
  page: Page,
  axis: string,
  chip: string,
): Promise<void> {
  const header = page.getByRole('button', { name: new RegExp(`^${axis}`) });
  // The axis holding a seeded pick auto-opens, so this must not blindly click
  // (that would collapse it) — and only one axis is open at a time.
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click();
  }
  await page
    .getByRole('group', { name: `${axis} vibes` })
    .getByRole('button', { name: new RegExp(`^${chip}`) })
    .click();
}

async function applyTweak(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await expect(page.getByRole('heading', { name: /Your next/i })).toBeVisible();
}

/** Every badge's text, whitespace-normalised. */
async function badgeTexts(page: Page): Promise<string[]> {
  return (await badges(page).allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
}

test.describe('D-C-41 — explicit vibe eligibility and the match badge', () => {
  test('no badge without a selection; applying one badges every card; clearing removes it again', async ({
    page,
    context,
  }) => {
    await reachAutoResults(page, context);

    // Nothing applied: the default home ranking has no selection to report.
    await expect(badges(page)).toHaveCount(0);
    const ungatedCount = await cards(page).count();
    expect(ungatedCount).toBeGreaterThan(0);

    await openTweak(page);
    await toggleChip(page, 'Drink', 'Cocktails');
    await applyTweak(page);

    // N = 1: every surviving card must read exactly 1/1. A 0/1 card would be
    // an ineligible bar the gate let through.
    const gatedCount = await cards(page).count();
    expect(gatedCount).toBeGreaterThan(0);
    await expect(badges(page)).toHaveCount(gatedCount);
    for (const text of await badgeTexts(page)) {
      expect(text).toContain('Vibe match 1/1');
    }

    // Clearing is the same chip toggled back off and applied — an APPLIED
    // empty pick, which must restore the ungated, unbadged page exactly.
    await openTweak(page);
    await toggleChip(page, 'Drink', 'Cocktails');
    await applyTweak(page);
    await expect(badges(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(ungatedCount);
  });

  test('two selected vibes give a denominator of 2 and forgive exactly one miss', async ({
    page,
    context,
  }) => {
    await reachAutoResults(page, context);

    await openTweak(page);
    await toggleChip(page, 'Drink', 'Cocktails');
    await toggleChip(page, 'Setting', 'Speakeasy');
    await applyTweak(page);

    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(badges(page)).toHaveCount(count);
    for (const text of await badgeTexts(page)) {
      // max(1, 2 - 1) = 1, so 1/2 is admitted and 2/2 is admitted; 0/2 is not.
      expect(text).toMatch(/Vibe match [12]\/2/);
    }
  });

  test('rapid chip toggling applies the FINAL selection, not an intermediate one', async ({
    page,
    context,
  }) => {
    await reachAutoResults(page, context);

    await openTweak(page);
    // Drive the controls faster than a user would, ending on Wine alone.
    await toggleChip(page, 'Drink', 'Cocktails');
    await toggleChip(page, 'Drink', 'Wine');
    await toggleChip(page, 'Drink', 'Beer');
    await toggleChip(page, 'Drink', 'Beer');
    await toggleChip(page, 'Drink', 'Cocktails');
    await applyTweak(page);

    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(badges(page)).toHaveCount(count);
    for (const text of await badgeTexts(page)) {
      // One tag survived the churn, so the denominator is 1 — not 2 or 3 from
      // a selection the surface only passed through.
      expect(text).toContain('Vibe match 1/1');
    }
  });

  test('rapid distance changes cannot reintroduce a rejected bar', async ({
    page,
    context,
  }) => {
    await reachAutoResults(page, context);

    await openTweak(page);
    await toggleChip(page, 'Drink', 'Cocktails');
    await applyTweak(page);

    const radius = page.getByRole('group', { name: 'Search radius' });
    await radius.getByRole('button', { name: 'Anywhere' }).click();
    await radius.getByRole('button', { name: 'Worth a cab' }).click();
    await radius.getByRole('button', { name: 'Walkable' }).click();
    await expect(
      radius.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Whatever the widening/narrowing did to the pool, the gate held: every
    // card still carries a badge and none of them is a 0/N pad.
    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(badges(page)).toHaveCount(count);
    await expect(page.getByText(/Vibe match 0\//)).toHaveCount(0);
  });
});
