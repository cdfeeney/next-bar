/**
 * bias-smoke.spec.ts
 *
 * Simulates Midtown geolocation, navigates directly to /quiz, completes with
 * cocktail-leaning answers, asserts top result is in Midtown / Chelsea / UWS /
 * East Village.
 */

// The catalog fixture serves the bars table from the local catalog. Without it
// every navigation in this quiz walk refetches the whole table from Supabase
// (CatalogRefresh), and three parallel workers doing that starve the single
// server — which is what made this spec fail under load while passing alone.
import { test, expect } from './helpers/catalogTest';
import { pickOption } from './helpers/quizWalk';

const MIDTOWN_COORDS = { latitude: 40.7549, longitude: -73.984 };

test.describe('Bias smoke — Midtown geolocation', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(MIDTOWN_COORDS);
  });

  test('top result is a Midtown / Chelsea / UWS / East Village bar', async ({ page }) => {
    // Full quiz walk + first-load compile + location auto-resolve is
    // legitimately slow under parallel-worker load, especially on WebKit
    // (night-loop N1): the page reaches the right state, the budget just
    // runs out. test.slow() = 3× the project timeout.
    test.slow();
    // Do NOT raise this budget to chase a failure here. Both 180s and 300s
    // were tried and neither helped, because the cost was never in this test:
    // it was the live Supabase catalog refetch on every navigation, which is
    // why it passed alone in ~8s and failed at three workers. The fixture
    // above removes that. (A host carrying orphaned WebKitNetworkProcess
    // handles from killed Playwright runs breaks context launch outright and
    // looks similar — check for those before touching the test.)
    await page.goto('/quiz');

    // First-load compile of /quiz can take >10s under concurrent worker load.
    // Give the first quiz prompt a generous timeout; subsequent ones are fast.
    await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({ timeout: 30_000 });
    // Every step goes through pickOption, which clicks and then proves the
    // quiz advanced. See e2e/helpers/quizWalk.ts: the option buttons are
    // server-rendered and hit-testable before React hydrates them, so a click
    // can dispatch into nothing and the failure then names the NEXT question —
    // which is how this spec's 2026-08-18 failure pointed at Q4.
    await pickOption(page, 'A hidden cocktail spot', 'What energy are you bringing?');
    await pickOption(page, 'Mellow — we wanna talk', 'Where do you wanna be?');
    await pickOption(page, 'Tucked away inside', 'Soundtrack of the night?');
    await pickOption(page, 'Jazz / lounge', 'Who do you wanna be around?');
    await pickOption(page, 'Industry / creative', 'Who are you out with?');
    await pickOption(page, 'On a date', 'Spending vibe tonight?');
    await pickOption(page, 'Treating myself', 'Any neighborhoods you love?');
    await page.getByRole('button', { name: 'Anywhere works' }).click();

    // LocationPrompt — granted_precise auto-resolves via useEffect, but the
    // resolve can take >3s under concurrent worker load (night-loop N1: the
    // old 3s race window was the real cause of the "drift" here — results
    // arrived WHILE we waited for a button that never comes on the granted
    // path). Race BOTH outcomes with one generous window, then branch.
    const resultsHeading = page.getByRole('heading', { name: /Your next \d+ bars?/i });
    const useLocationBtn = page.getByRole('button', { name: /Use my location/i });

    await expect(resultsHeading.or(useLocationBtn).first()).toBeVisible({
      timeout: 15_000,
    });
    if (!(await resultsHeading.isVisible())) {
      // The granted path renders a DISABLED "Use my location" ("Using your
      // location…") while auto-resolving — results replace it on their own,
      // sometimes mid-click (it can flash enabled). The click is therefore
      // BEST-EFFORT with a short cap; the results assertion below is the
      // real gate either way.
      // BOUNDED, and that bound is the whole fix. `isEnabled()` auto-waits for
      // the element to attach, and with no `actionTimeout` in the config the
      // default is 0 — wait forever. The results replace this button while we
      // are asking about it, so on the granted path the locator resolves to
      // nothing and this call NEVER SETTLES: `.catch()` cannot help, because the
      // promise does not reject. The trace shows the quiz walk finishing at 8.1s
      // and `isEnabled` still pending when the 90s test timeout fired.
      //
      // This is why raising the budget never worked (180s and 300s were both
      // tried): an unbounded wait does not care how large the budget is.
      if (await useLocationBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
        await useLocationBtn.click({ timeout: 5_000 }).catch(() => {});
      }
    }

    await expect(resultsHeading).toBeVisible({ timeout: 15_000 });
    const cards = page.getByTestId('result-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Hell's Kitchen joined the catalog 2026-07-24 — from Midtown coords its
    // bars are legitimately the nearest strong matches (Bar Centrale 6/6).
    const firstCard = cards.first();
    await expect(firstCard).toContainText(
      /Midtown|Hell's Kitchen|Chelsea|UWS|Upper West Side|East Village/i,
    );
  });
});
