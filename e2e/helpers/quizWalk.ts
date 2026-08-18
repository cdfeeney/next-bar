import { expect, type Page } from '@playwright/test';

/**
 * One step of the vibe quiz: click an option and confirm the quiz actually
 * advanced.
 *
 * Why this exists rather than `getByRole('button', …).click()` inline.
 *
 * A click on the option is not enough evidence that the step happened. Under
 * the zero-retry release gate on 2026-08-18 a lost click surfaced three ways
 * in one afternoon, each mis-naming the step that broke:
 *
 *   - quiz-path.spec.ts:94  clicked Q1, page stayed on "Question 1 of 8",
 *                           failure reported as Q2's prompt "not found"
 *   - quiz-path.spec.ts:65  clicked Q2, page stayed on "Question 2 of 8",
 *                           failure reported as a 30s timeout on Q3's option
 *   - bias-smoke.spec.ts:23 same walk, failure reported at Q4's prompt
 *
 * The cause was a pre-hydration click: the SSR'd button was enabled and
 * hit-testable before React attached its handler. That is fixed in the product
 * (`VibeQuiz` disables the options until it mounts), so Playwright's own
 * "enabled" wait now covers the window and no click needs retrying here. What
 * stays is the assertion: `nextPrompt` must appear, so a quiz that fails to
 * advance fails on the step that actually broke.
 */
export async function pickOption(
  page: Page,
  option: string | RegExp,
  nextPrompt: string,
): Promise<void> {
  await page.getByRole('button', { name: option }).click();
  await expect(
    page.getByText(nextPrompt),
    `quiz did not advance to ${JSON.stringify(nextPrompt)} after picking ${String(option)}`,
  ).toBeVisible();
}
