/**
 * quiz-path.spec.ts
 *
 * End-to-end: navigate directly to /quiz, complete the 6-question vibe quiz,
 * pick a neighborhood on the LocationPrompt (avoids the geolocation popup),
 * and confirm 3 result cards render.
 *
 * Cards are identified by data-testid="result-card". The quiz profile is a
 * cold-start PRIOR, not an explicit selection, so these cards deliberately
 * carry no "Vibe match" badge at all (D-C-41) — the old text-based selector
 * would now match nothing here.
 *
 * Quiz route is /quiz (post Beli-style restructure — home / is Where-next).
 *
 * Quiz answers (cocktail-leaning):
 *   Q1  "A hidden cocktail spot"       → speakeasy, cocktail, polished
 *   Q2  "Mellow — we wanna talk"       → chill
 *   Q3  "Jazz / lounge"                → jazz, lounge
 *   Q4  "Industry / creative"          → industry, cocktail
 *   Q5  "Treating myself"              → pricey, cocktail
 *   Q6  "Anywhere works"               → preferredNeighborhoods = []
 * Combined tags: speakeasy, cocktail, polished, chill, jazz, lounge, industry, pricey
 * On LocationPrompt we pick "East Village" — 4 bars match at Jaccard ≥ 0.10.
 */

import { test, expect, type Page } from './helpers/test';
import { pickOption } from './helpers/quizWalk';

async function completeQuiz(page: Page): Promise<void> {
  // Every step goes through pickOption, which clicks and then proves the quiz
  // advanced. See e2e/helpers/quizWalk.ts: the option buttons are server-
  // rendered and hit-testable before React hydrates them, so a click can
  // dispatch into nothing and the failure then names the NEXT question.
  await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({ timeout: 30_000 });
  await pickOption(page, 'A hidden cocktail spot', 'What energy are you bringing?');
  await pickOption(page, 'Mellow — we wanna talk', 'Where do you wanna be?');
  await pickOption(page, 'Tucked away inside', 'Soundtrack of the night?');
  await pickOption(page, 'Jazz / lounge', 'Who do you wanna be around?');
  await pickOption(page, 'Industry / creative', 'Who are you out with?');
  await pickOption(page, 'On a date', 'Spending vibe tonight?');
  await pickOption(page, 'Treating myself', 'Any neighborhoods you love?');
  await page.getByRole('button', { name: 'Anywhere works' }).click();
}

async function reachQuizResults(page: Page): Promise<void> {
  await page.goto('/quiz');
  await completeQuiz(page);

  await expect(page.getByRole('button', { name: /Or pick a neighborhood/i })).toBeVisible();
  await page.getByRole('button', { name: /Or pick a neighborhood/i }).click();

  await expect(page.getByRole('button', { name: 'East Village' })).toBeVisible();
  await page.getByRole('button', { name: 'East Village' }).click();

  await expect(
    page.getByTestId('result-card').first(),
  ).toBeVisible();
}

test.describe('Quiz path', () => {
  // Every test here walks the full quiz. That walk costs ~11s on iPhone 13 and
  // ~7s on Pixel 7 when the host is quiet — against a 30s project budget, which
  // is only ~3x headroom on a machine that builds other worktrees concurrently.
  // It ran out on 2026-08-18 under the zero-retry release gate. bias-smoke.spec
  // already carries test.slow() for the identical walk; this is the same walk
  // and gets the same budget. It weakens no assertion — a genuinely broken quiz
  // still fails, just on the assertion rather than on the clock.
  test.slow();

  test('every answer on question 1 is tappable — none sits under the fixed tab bar (T-01f)', async ({ page }) => {
    // Owner, 2026-09-21: "the person can't choose the button". The quiz section
    // filled the viewport with no clearance for the fixed 5-tab nav, so the
    // last answer sat under it: visible, not tappable. elementFromPoint at
    // the answer's centre tells us who would actually receive the tap.
    await page.goto('/quiz');
    const answers = page.getByRole('main').getByRole('button').filter({ hasNotText: /Skip|Back|Next/ });
    await expect(answers.first()).toBeVisible();
    const count = await answers.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const answer = answers.nth(i);
      await answer.scrollIntoViewIfNeeded();
      const hit = await answer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return at !== null && el.contains(at);
      });
      expect(hit, `answer ${i + 1} of ${count} is covered (by the tab bar?) at its centre`).toBe(true);
    }
    // And the last one really advances the quiz when tapped.
    await answers.nth(count - 1).click();
    await expect(page.getByText(/Question 2 of/i)).toBeVisible();
  });

  test('navigates to /quiz, completes 6-question quiz, picks neighborhood, sees 3 result cards', async ({ page }) => {
    await reachQuizResults(page);

    const cards = page.getByTestId('result-card');
    // Quiz path shows top 10. East Village + cocktail-leaning currently
    // yields fewer than 10 candidates (5 East Village bars total), so just
    // assert at least 3 cards render.
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(10);
  });

  test('results show a subtle dismissible install nudge, not the full marketing CTA', async ({ page }) => {
    await reachQuizResults(page);

    // The subtle nudge is present...
    const nudge = page.getByTestId('install-nudge');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText('Add Next Bar to your home screen');

    // ...but the heavy AppStoreCta marketing block must NOT bleed into this
    // functional flow (it belongs only on /install + Settings).
    await expect(page.getByText('Install now · App Store coming')).toHaveCount(0);

    // Dismissing hides it and persists so it never nags again.
    await page.getByRole('button', { name: 'Dismiss install prompt' }).click();
    await expect(nudge).toHaveCount(0);
    const dismissed = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:install-nudge-dismissed:v1'),
    );
    expect(dismissed).toBe('1');
  });
});
