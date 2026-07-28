/**
 * rankings-add-flow.spec.ts
 *
 * B4 — quick-add flow on /rankings with the Beli-style comparison CHAIN
 * (binary insert). Anonymous (local) mode: no auth stubs needed.
 *
 * What this covers:
 *   - "+ Add a bar" is present in the empty state AND in the header once
 *     the list is non-empty.
 *   - BarPicker search → tier pick → comparison chain via PairwiseSheet.
 *   - First bar: NO comparison prompt (no peer) — negative assertion.
 *   - Second bar: single one-shot prompt (1 peer → legacy fallback path).
 *   - Third/fourth bars: binary-insert chain with "1 of 2" / "2 of 2"
 *     progress copy.
 *   - Final /rankings order matches the answers (new bar always won → each
 *     bar ranks above all earlier ones).
 *   - Reload → order persists (localStorage transcript replay).
 *
 * Dev-server note: /rankings cold-compile can race in isolation — run the
 * suite (or at least a warming spec such as app-shell-smoke) alongside,
 * per CLAUDE.md / NIGHTLOG-2026-07-23. Re-run once before debugging if the
 * only failure is the goto-interrupted-navigation signature.
 *
 * WebKit (iPhone 13): `.fill()` on a controlled input can race React
 * hydration/onChange — click + pressSequentially produces real key events
 * both engines handle consistently (same footgun documented in
 * auth-page.spec.ts).
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

async function clearStorage(page: Page): Promise<void> {
  // Home is location-first; deny geo so nothing hangs on the async locate
  // spinner.
  await denyGeolocation(page.context());
  // Clear on /rankings ITSELF rather than on `/`.
  //
  // This used to `goto('/')`, clear, and let the test `goto('/rankings')`.
  // That raced: `/` finishes hydrating after the second goto is issued, and
  // its client-side navigation aborts the pending one —
  //   "Navigation to .../rankings is interrupted by another navigation to /".
  // Reproduced 3/3 in true isolation (--workers=1) against an already-warm
  // dev server, so this is NOT the cold-compile flake documented in
  // CLAUDE.md; that diagnosis was wrong. Never leaving `/rankings` removes
  // the second navigation entirely.
  await page.goto('/rankings');
  await page.evaluate(() => {
    window.localStorage.clear();
    // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
    // and clearing storage must not resurface the overlay mid-test.
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  // Reload so the app boots against the cleared storage.
  await page.reload();
}

/**
 * Drive the quick-add flow for one bar, rating it Loved and answering
 * every comparison prompt by picking the NEW bar (so each added bar ranks
 * above all earlier ones — makes the expected final order deterministic).
 *
 * `expectedPrompts` is exact: 0 for the first bar, 1 for the second
 * (one-shot fallback), ceil(log2(n+1)) for an n-peer chain when the new
 * bar wins every probe.
 */
async function addBarLoved(
  page: Page,
  name: string,
  expectedPrompts: number,
  expectedMaxSteps?: number,
): Promise<void> {
  await page.getByRole('button', { name: '+ Add a bar' }).click();

  const picker = page.getByRole('dialog', { name: 'Add a bar' });
  await expect(picker).toBeVisible();
  await typeInto(picker.getByLabel('Search bars'), name);
  await picker.locator('li button').filter({ hasText: name }).first().click();

  // Tier stage — the heading confirms the picked bar carried over.
  await expect(picker).toContainText(`How was ${name}?`);
  await picker.getByRole('button', { name: /^Loved/ }).click();
  await expect(picker).not.toBeVisible();

  for (let i = 0; i < expectedPrompts; i++) {
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/which did you love more\?/i);
    if (expectedMaxSteps !== undefined && expectedMaxSteps > 1) {
      await expect(sheet).toContainText(`${i + 1} of ${expectedMaxSteps}`);
    }
    // Pick the just-added bar as winner.
    await sheet.getByRole('button').filter({ hasText: name }).first().click();
  }

  // The chain must END after the expected answers — a runaway chain (or a
  // prompt that never appeared) fails here.
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

async function rankedNames(page: Page): Promise<string[]> {
  const texts = await page.locator('article h2').allTextContents();
  return texts.map((t) => t.replace(/^\d+\.\s*/, '').trim());
}

test.describe('/rankings — B4 quick-add with comparison chain', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test('adds 4 bars via the chain; order matches the answers and survives reload', async ({
    page,
  }) => {
    await page.goto('/rankings');

    // Empty state exposes the quick-add entry.
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '+ Add a bar' }),
    ).toBeVisible();

    // Bar 1 — no peers → no prompt (negative assertion).
    await addBarLoved(page, 'Attaboy', 0);
    await expect(page.locator('article')).toHaveCount(1);

    // The list is non-empty now → the header hosts the persistent button.
    await expect(
      page.getByRole('button', { name: '+ Add a bar' }),
    ).toBeVisible();

    // Bar 2 — exactly 1 peer → single one-shot prompt (fallback path).
    await addBarLoved(page, 'Death & Co', 1);

    // Bar 3 — 2 peers → binary-insert chain, worst case 2 (ceil(log2(3))).
    await addBarLoved(page, 'Employees Only', 2, 2);

    // Bar 4 — 3 peers → chain of 2 (ceil(log2(4))).
    await addBarLoved(page, 'Mr. Purple', 2, 2);

    // Every answer picked the new bar → strict reverse-add order.
    const expectedOrder = [
      'Mr. Purple',
      'Employees Only',
      'Death & Co',
      'Attaboy',
    ];
    await expect(page.locator('article')).toHaveCount(4);
    expect(await rankedNames(page)).toEqual(expectedOrder);

    // 0 + 1 + 2 + 2 comparisons should be in the local transcript.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toHaveLength(5);

    // Reload → replay of the persisted transcript reproduces the order.
    await page.reload();
    await expect(page.locator('article')).toHaveCount(4);
    expect(await rankedNames(page)).toEqual(expectedOrder);
  });

  test('Skip ends the chain; the bar stays listed at the tier midpoint', async ({
    page,
  }) => {
    await page.goto('/rankings');

    await addBarLoved(page, 'Attaboy', 0);
    await addBarLoved(page, 'Death & Co', 1);
    await addBarLoved(page, 'Employees Only', 2, 2);

    // Add a 4th bar but SKIP on the first probe.
    await page.getByRole('button', { name: '+ Add a bar' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a bar' });
    await typeInto(picker.getByLabel('Search bars'), 'Mr. Purple');
    await picker
      .locator('li button')
      .filter({ hasText: 'Mr. Purple' })
      .first()
      .click();
    await picker.getByRole('button', { name: /^Loved/ }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /skip/i }).click();

    // The WHOLE chain ends — no follow-up prompt (negative assertion).
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // No comparison recorded for the skipped bar (still 3 from before)…
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    expect(JSON.parse(stored as string)).toHaveLength(3);

    // …and the bar is listed, at the Loved band midpoint (9.0), i.e. below
    // the compared bars (10.0 / 9.0+ / 8.0 interpolation) but present.
    await expect(page.locator('article')).toHaveCount(4);
    const names = await rankedNames(page);
    expect(names).toContain('Mr. Purple');
    expect(names[0]).toBe('Employees Only');
  });
});
