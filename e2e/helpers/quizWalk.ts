import { expect, type Page } from '@playwright/test';

/**
 * One step of the vibe quiz: click an option and confirm the quiz actually
 * advanced.
 *
 * Why this exists rather than `getByRole('button', …).click()` inline.
 *
 * The quiz page is server-rendered, so every option button is visible,
 * enabled, stable and hit-testable BEFORE React has hydrated it. Playwright's
 * actionability checks all pass on such a button, the click dispatches, and
 * nothing happens — no handler is attached yet. Under the zero-retry release
 * gate on 2026-08-18 that surfaced three different ways in one afternoon, all
 * on the slower iPhone 13 project and all mis-naming the step that broke:
 *
 *   - quiz-path.spec.ts:94  clicked Q1, page stayed on "Question 1 of 8",
 *                           failure reported as Q2's prompt "not found"
 *   - quiz-path.spec.ts:65  clicked Q2, page stayed on "Question 2 of 8",
 *                           failure reported as a 30s timeout on Q3's option
 *   - bias-smoke.spec.ts:23 same walk, failure reported at Q4's prompt
 *
 * So the click is retried — the ASSERTION is not. `nextPrompt` must appear or
 * the step fails, exactly as before; a quiz that is genuinely broken still
 * fails here. What the retry removes is the pre-hydration window, which is a
 * property of the harness and not of the product.
 *
 * Clicks are idempotent for this UI: an option that did register advances the
 * quiz, so the button is gone and the retry is never reached.
 */
export async function pickOption(
  page: Page,
  option: string | RegExp,
  nextPrompt: string,
): Promise<void> {
  const button = page.getByRole('button', { name: option });
  await button.click();
  const next = page.getByText(nextPrompt);
  try {
    await expect(next).toBeVisible({ timeout: 5_000 });
  } catch {
    // Still on the same question: the first click predated hydration. Click
    // the same option again and let the real timeout decide.
    if (await button.isVisible()) await button.click();
    await expect(
      next,
      `quiz did not advance to ${JSON.stringify(nextPrompt)} after picking ${String(option)}`,
    ).toBeVisible();
  }
}
