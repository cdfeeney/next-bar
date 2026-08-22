/**
 * story-rail.spec.ts
 *
 * The Stories rail, the story viewer and the story QUEUE — V8-1f criteria
 * 1, 2, 4, 5, 6, 7 and 11, against
 * `docs/design-reference/approved/next-bar-social-v2-core.png` and
 * `next-bar-story-tag-placement.png`.
 *
 * Everything here runs signed-OUT on purpose: the rail, the queue and the
 * viewer are the half of the surface that does not depend on a session, and
 * the seeded friend stories are identical in both auth modes. The signed-in
 * half of Social (presence rows, the pin badge's source) is covered by
 * follow-requests.spec.ts and friends-real.spec.ts.
 */

import { test, expect, type Page } from '@playwright/test';

/** Seeded item counts, in rail order — see storyStore.seededGroups. */
const SASHA_ITEMS = 3;

/**
 * The circle these tests walk. The rail and Feed are friends-only, so who has
 * a story is a function of who you FOLLOW — a signed-out device starts on
 * `DEFAULT_FOLLOWS` (Claire and John) and would show no Dev and no Sasha.
 * Naming the circle here makes the queue this file steps through explicit
 * rather than a property of the seed data.
 */
const CIRCLE = ['claire', 'dev', 'sasha', 'john'];

async function seedCircle(page: Page, circle: string[]): Promise<void> {
  await page.addInitScript((handles) => {
    window.localStorage.setItem('next-bar:follows:v1', JSON.stringify(handles));
  }, circle);
}

async function openSocial(page: Page): Promise<void> {
  await seedCircle(page, CIRCLE);
  await page.goto('/friends');
  await expect(page.getByTestId('social-subtabs')).toBeVisible();
}

async function openStory(page: Page, handle: string): Promise<void> {
  await page.locator(`[data-testid="story-rail-item"][data-handle="${handle}"]`).click();
  await expect(page.getByTestId('story-viewer')).toBeVisible();
}

/** Freeze the clock by parking focus in the reply field. */
async function pauseViewer(page: Page): Promise<void> {
  await page.getByTestId('story-reply-input').focus();
  await expect(page.getByTestId('story-viewer')).toHaveAttribute('data-paused', 'true');
}

test.describe('Social sub-tabs and the Stories rail', () => {
  test('Social presents exactly three sub-tabs and no sixth main tab', async ({
    page,
  }) => {
    await openSocial(page);

    const tabs = page.getByTestId('social-subtabs').getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText(/Tonight/i);
    await expect(tabs.nth(1)).toHaveText(/Plans/i);
    await expect(tabs.nth(2)).toHaveText(/Feed/i);

    // The five-tab bottom contract is untouched.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveCount(5);

    // One panel at a time, and each sub-tab reaches its own surface.
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await tabs.nth(1).click();
    await expect(page.getByRole('heading', { name: /^Plans$/i })).toBeVisible();
    await expect(page.getByTestId('social-panel-tonight')).toHaveCount(0);
    await tabs.nth(2).click();
    await expect(page.getByTestId('friends-feed')).toBeVisible();
  });

  test('the rail is on Tonight and on Feed, your avatar first with the plus', async ({
    page,
  }) => {
    await openSocial(page);
    await expect(page.getByTestId('stories-rail')).toBeVisible();

    // Your cell leads the rail.
    const cells = page.getByTestId('stories-rail').locator('li');
    await expect(cells.first()).toContainText('You');
    await expect(page.getByTestId('add-story')).toBeVisible();

    // The visible badge is 18px…
    const badge = page.getByTestId('add-story-badge');
    const badgeBox = await badge.boundingBox();
    expect(badgeBox?.width).toBeCloseTo(18, 0);

    // …but avatar and badge resolve as one target of at least 44x44.
    const cellBox = await page.getByTestId('story-rail-you').boundingBox();
    expect(cellBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(cellBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Same rail on Feed.
    await page.getByRole('tab', { name: /Feed/i }).click();
    await expect(page.getByTestId('stories-rail')).toBeVisible();
    await expect(page.getByTestId('add-story')).toBeVisible();
  });

  test('the ring means an unseen story and is not merged with the pin badge', async ({
    page,
  }) => {
    await openSocial(page);

    const claire = page.locator('[data-testid="story-rail-item"][data-handle="claire"]');
    await expect(claire).toHaveAttribute('data-unseen', 'true');
    // The state is in the label too, so it is never colour alone.
    await expect(claire).toHaveAttribute('aria-label', /unseen story/i);
    await expect(claire.getByTestId('story-ring')).toHaveAttribute('data-active', 'true');

    await claire.click();
    await expect(page.getByTestId('story-viewer')).toBeVisible();
    await page.getByTestId('story-close').click();

    // Watched: the ring is gone as a SHAPE, not merely recoloured.
    await expect(claire).toHaveAttribute('data-unseen', 'false');
    await expect(claire.getByTestId('story-ring')).toHaveAttribute('data-active', 'false');
    await expect(claire).toHaveAttribute('aria-label', /already seen/i);

    // Signed out there is no shared-presence data, so no pin is drawn — the
    // ring above proves the two signals are not the same flag.
    await expect(page.getByTestId('story-pin-badge')).toHaveCount(0);
  });

  test('someone you do not follow is on neither the rail nor Feed', async ({
    page,
  }) => {
    // The default circle, not the widened one the rest of the file uses.
    await seedCircle(page, ['claire']);
    await page.goto('/friends');
    await expect(page.getByTestId('stories-rail')).toBeVisible();

    await expect(
      page.locator('[data-testid="story-rail-item"][data-handle="claire"]'),
    ).toBeVisible();
    for (const handle of ['dev', 'sasha', 'john']) {
      await expect(
        page.locator(`[data-testid="story-rail-item"][data-handle="${handle}"]`),
      ).toHaveCount(0);
    }

    // Feed is friends-only memories by the same rule, not just the rail.
    await page.getByRole('tab', { name: /Feed/i }).click();
    const feed = page.getByTestId('friends-feed');
    await expect(feed.getByTestId('feed-memory')).toHaveCount(1);
    await expect(feed).toContainText(/Claire R\./);
    await expect(feed).not.toContainText(/Dev P\./);
  });
});

test.describe('Story viewer and queue', () => {
  test('progress segments equal the current person’s item count', async ({ page }) => {
    await openSocial(page);
    await openStory(page, 'sasha');
    await pauseViewer(page);

    await expect(page.getByTestId('story-progress')).toHaveAttribute(
      'data-segments',
      String(SASHA_ITEMS),
    );
    await expect(page.getByTestId('story-progress-segment')).toHaveCount(SASHA_ITEMS);
  });

  test('metadata sits between the author row and the photo, never over it', async ({
    page,
  }) => {
    await openSocial(page);
    await openStory(page, 'claire');
    await pauseViewer(page);

    const chip = page.getByTestId('story-venue-chip');
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    const frameBox = await page.getByTestId('story-frame').boundingBox();
    // Option A: the strip is ABOVE the image, so it cannot cross a face.
    expect((chipBox?.y ?? 0) + (chipBox?.height ?? 0)).toBeLessThanOrEqual(
      (frameBox?.y ?? 0) + 1,
    );
    // …and below the status area, never at the very top of the screen.
    expect(chipBox?.y ?? 0).toBeGreaterThan(0);
  });

  test('tap zones step by hand and hand off to the next person with no interstitial', async ({
    page,
  }) => {
    await openSocial(page);
    await openStory(page, 'claire');

    // Claire has one item, so forward is a person handoff.
    await page.getByTestId('story-forward-zone').click();
    await expect(page.getByTestId('story-viewer')).toContainText('Dev P.');
    await expect(page.getByTestId('story-progress')).toHaveAttribute('data-segments', '2');
    // No interstitial and no confirmation between people.
    await expect(page.getByRole('button', { name: /continue|next person/i })).toHaveCount(0);

    // Backward still works by hand, all the way across the handoff.
    await page.getByTestId('story-back-zone').click();
    await expect(page.getByTestId('story-viewer')).toContainText('Claire R.');
  });

  test('items advance automatically', async ({ page }) => {
    await openSocial(page);
    await openStory(page, 'dev');
    await expect(page.getByTestId('story-progress')).toHaveAttribute('data-segments', '2');

    // Dev's second item, reached with no input at all.
    await expect(page.getByTestId('story-progress')).toHaveAttribute(
      'aria-label',
      'Item 2 of 2',
      { timeout: 15_000 },
    );
  });

  test('an exhausted queue closes to Social · Tonight with no "all caught up" screen', async ({
    page,
  }) => {
    await openSocial(page);
    await page.getByRole('tab', { name: /Feed/i }).click();
    await openStory(page, 'john');

    // John is last in rail order with a single item, so forward exhausts it.
    await page.getByTestId('story-forward-zone').click();
    await expect(page.getByTestId('story-viewer')).toHaveCount(0);
    await expect(page.getByText(/all caught up/i)).toHaveCount(0);
    // The completion receipt is Tonight itself, even though Feed opened it.
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await expect(page.getByTestId('friends-tonight')).toBeVisible();
  });

  test('✕ closes early and returns to the surface that opened it', async ({ page }) => {
    await openSocial(page);
    await page.getByRole('tab', { name: /Feed/i }).click();
    await openStory(page, 'sasha');

    await page.getByTestId('story-close').click();
    await expect(page.getByTestId('story-viewer')).toHaveCount(0);
    await expect(page.getByTestId('friends-feed')).toBeVisible();
    await expect(page.getByTestId('social-panel-tonight')).toHaveCount(0);
  });

  test('progression pauses while a reply is composed', async ({ page }) => {
    await openSocial(page);
    await openStory(page, 'sasha');
    const viewer = page.getByTestId('story-viewer');

    await page.getByTestId('story-reply-input').fill('good booth');
    await expect(viewer).toHaveAttribute('data-paused', 'true');
    // Still paused with text in the field: composing is not just focus.
    await page.getByTestId('story-reply-input').blur();
    await expect(viewer).toHaveAttribute('data-paused', 'true');

    await page.getByTestId('story-reply-input').fill('good booth');
    await page.getByTestId('story-reply-send').click();
    await expect(page.getByTestId('story-reply-input')).toHaveValue('');
  });

  test('long-press holds the item past its own duration and releasing does not skip it', async ({
    page,
  }) => {
    await openSocial(page);
    await openStory(page, 'sasha');
    const viewer = page.getByTestId('story-viewer');
    const progress = page.getByTestId('story-progress');
    await expect(progress).toHaveAttribute('aria-label', 'Item 1 of 3');

    await page.getByTestId('story-forward-zone').dispatchEvent('pointerdown');
    await expect(viewer).toHaveAttribute('data-paused', 'true');
    // Held well past the 5s an item would otherwise hold the screen for.
    await page.waitForTimeout(7_000);
    await expect(progress).toHaveAttribute('aria-label', 'Item 1 of 3');

    // Releasing a long press is not a tap: it resumes, it does not step.
    await page.getByTestId('story-forward-zone').dispatchEvent('pointerup');
    await expect(viewer).toHaveAttribute('data-paused', 'false');
    await expect(progress).toHaveAttribute('aria-label', 'Item 2 of 3', {
      timeout: 12_000,
    });
  });

  test('the tagged-people sheet lists everyone, pauses the story, and offers a way out', async ({
    page,
  }) => {
    await openSocial(page);
    // Claire's first item is the seeded story that tags YOU, so this is also
    // the only place "Remove me" is reachable.
    await openStory(page, 'claire');
    await pauseViewer(page);

    const chip = page.getByTestId('story-people-chip');
    await expect(chip).toHaveText(/With .+ \+1/);
    await chip.click();

    const sheet = page.getByTestId('tagged-people-sheet');
    await expect(sheet).toBeVisible();
    // The full list the "+N" collapsed, every row a 56px target.
    const rows = page.getByTestId('tagged-person-row');
    await expect(rows).toHaveCount(2);
    const rowBox = await rows.first().boundingBox();
    expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(56);

    // Profiles are reachable, and no like count appears anywhere.
    await expect(sheet.getByRole('link', { name: /Profile/i }).first()).toHaveAttribute(
      'href',
      /^\/u\//,
    );
    await expect(sheet.getByText(/\blikes?\b/i)).toHaveCount(0);

    // Automatic progression is paused while it is open.
    await expect(page.getByTestId('story-viewer')).toHaveAttribute('data-paused', 'true');

    // Anyone tagged can take themselves out, from this same sheet.
    await page.getByTestId('remove-me').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('story-people-chip')).not.toHaveText(/\+1/);
  });

  test('arrow keys navigate the queue but not while a reply is being typed', async ({
    page,
  }) => {
    await openSocial(page);
    await openStory(page, 'sasha');
    const progress = page.getByTestId('story-progress');
    await pauseViewer(page);
    await expect(progress).toHaveAttribute('aria-label', 'Item 1 of 3');

    // With the caret in the reply field, arrows are TEXT EDITING. Stepping the
    // queue underneath a half-typed reply also re-targets what Enter sends.
    const input = page.getByTestId('story-reply-input');
    await input.fill('good booth');
    await input.press('ArrowLeft');
    await input.press('ArrowRight');
    await expect(progress).toHaveAttribute('aria-label', 'Item 1 of 3');
    await expect(input).toHaveValue('good booth');

    // Away from the field they still drive the queue.
    await input.fill('');
    await page.getByTestId('story-close').focus();
    await page.keyboard.press('ArrowRight');
    await expect(progress).toHaveAttribute('aria-label', 'Item 2 of 3');
  });

  test('the viewer is a real modal: Tab stays inside it and Escape closes it', async ({
    page,
  }) => {
    await openSocial(page);
    await openStory(page, 'sasha');
    const viewer = page.getByTestId('story-viewer');
    // Park the clock first: an auto-advance mid-loop would move focus for
    // reasons that have nothing to do with the trap under test.
    await page.getByTestId('story-reply-input').fill('x');
    await expect(viewer).toHaveAttribute('data-paused', 'true');

    // aria-modal says the page underneath does not exist; Tab has to agree.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      await expect(
        viewer.locator(':focus'),
        `focus left the dialog after ${i + 1} tabs`,
      ).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
  });

  test('Remove me is a consent action, so it survives a reload', async ({ page }) => {
    await openSocial(page);
    await openStory(page, 'claire');
    await pauseViewer(page);
    await page.getByTestId('story-people-chip').click();
    await page.getByTestId('remove-me').click();
    await expect(page.getByTestId('tagged-people-sheet')).toHaveCount(0);

    // The tag does NOT come back. Replies and watched-ids are both written
    // down; an untag that lived only in component state was the one control
    // here that quietly undid itself.
    await page.reload();
    await expect(page.getByTestId('social-subtabs')).toBeVisible();
    await openStory(page, 'claire');
    await pauseViewer(page);
    await expect(page.getByTestId('story-people-chip')).not.toHaveText(/\+1/);
    await page.getByTestId('story-people-chip').click();
    await expect(page.getByTestId('tagged-person-row')).toHaveCount(1);
    await expect(page.getByTestId('remove-me')).toHaveCount(0);
  });
});
