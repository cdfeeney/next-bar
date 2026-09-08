/**
 * story-rail.spec.ts — the Stories rail, after the V8 Stories backend.
 *
 * WHAT CHANGED, STATED PLAINLY. This file used to run signed-OUT against a
 * seeded rail: `demoFriends` gave Claire, Dev and Sasha stories, and the queue,
 * the viewer, the pause rules and the tagged-people sheet were all exercised
 * against that invented data. The header even claimed "the seeded friend
 * stories are identical in both auth modes", which was never true.
 *
 * There is no anonymous story surface any more. Stories are `public.stories`
 * rows readable only by accepted mutual friends, so a signed-out browser has
 * nothing to render.
 *
 * THE SIGNED-IN COVERAGE CAME BACK, and this header used to say it had "moved"
 * when a large part of it had simply been deleted. The claim rested on
 * conflating two different questions:
 *
 *   - WHO MAY READ A STORY is authorization. It lives in RLS and in SECURITY
 *     DEFINER functions, cannot be proven in a browser, and belongs in
 *     `src/lib/storiesRls.live.test.ts` — two identities, needs a database, NOT
 *     run in this gate; it is the attended staging verification.
 *   - WHAT THE UI DOES WITH THE ROWS IT IS GIVEN is browser behaviour, and
 *     stubbing the transport answers it. Progress counts, person-to-person
 *     handoff, exhaustion, the pause rules, the tagged-person consent sheet and
 *     the rail's own geometry are all in that second category, and every one of
 *     them regressed invisibly while this file asserted only signed-out states.
 *
 * PAUSE COVERAGE, STATED HONESTLY. A reviewer caught this block claiming
 * "automatic-progression and pause coverage" it did not have. What is actually
 * driven below: keyboard focus on the chrome pauses, a pointer tap does not,
 * and an OPEN SHEET pauses. What is NOT driven: the auto-advance TIMER itself
 * and a long-press hold — both need clock control this suite does not take, and
 * faking a timer through the production UI would assert the fake. The
 * progression state machine is unit-covered; this file covers what the browser
 * does with it. Recorded as a gap rather than implied away.
 *
 * So the second describe block below drives the real thing signed in, against a
 * stubbed Supabase (`e2e/helpers/stories.ts`, the same cookie + route-stub
 * pattern `friends-real.spec.ts` uses — no real accounts, no database rows).
 * Signed-URL lifetime, publish/cleanup and honest failure stay in
 * `src/lib/stories.server.test.ts`.
 */

import { test, expect, type Page } from './helpers/test';
import {
  CLAIRE,
  CLAIRE_ID,
  DEV,
  DEV_ID,
  SUPABASE_URL,
  YOU_ID,
  ago,
  signIn,
  stubStories,
  story,
} from './helpers/stories';

async function openSocial(page: Page): Promise<void> {
  await page.goto('/friends');
  await expect(page.getByTestId('social-subtabs')).toBeVisible();
}

test.describe('Social sub-tabs and the Stories rail', () => {
  test('exactly three sub-tabs, and the five-tab contract is untouched', async ({
    page,
  }) => {
    await openSocial(page);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await tabs.nth(1).click();
    await expect(page.getByRole('heading', { name: /^Plans$/i })).toBeVisible();
    await expect(page.getByTestId('social-panel-tonight')).toHaveCount(0);
    await tabs.nth(2).click();
    await expect(page.getByTestId('social-panel-feed')).toBeVisible();
  });

  test('signed out, the rail says so instead of showing invented friends', async ({
    page,
  }) => {
    await openSocial(page);

    // The honest state, on Tonight…
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-signed-out')).toContainText(
      /friends who follow you back/i,
    );
    await expect(page.getByTestId('stories-sign-in')).toHaveAttribute('href', '/auth');

    // …and no rail, no cells, no add control, because there is no session.
    await expect(page.getByTestId('stories-rail')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-item')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-you')).toHaveCount(0);
    await expect(page.getByTestId('add-story')).toHaveCount(0);

    // Same on Feed — the rail is drawn on both sub-tabs.
    await page.getByRole('tab', { name: /Feed/i }).click();
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
  });

  test('an unreachable backend is never rendered as an empty feed', async ({
    page,
  }) => {
    // The distinction this whole surface was rebuilt for: "nothing to show"
    // and "we could not ask" must not look the same. Signed out we assert the
    // states are DIFFERENT components, so a future change cannot collapse them
    // into one without failing here.
    await openSocial(page);
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-unavailable')).toHaveCount(0);
  });

  test('the retired local story surfaces are gone, not hidden', async ({ page }) => {
    await openSocial(page);

    // The viewer's reply field wrote to localStorage and delivered nothing.
    await expect(page.getByTestId('story-reply-input')).toHaveCount(0);
    await expect(page.getByTestId('story-reply-send')).toHaveCount(0);

    // No story key but the per-device seen list may exist at all.
    const keys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.includes('stor')));
    expect(keys).not.toContain('next-bar:stories:v1');
    expect(keys).not.toContain('next-bar:story-replies:v1');
    expect(keys).not.toContain('next-bar:stories-untagged:v1');
  });

  test('no demo identity leaks onto the signed-out Social surface', async ({
    page,
  }) => {
    // `demoFriends`, `demoShareId` and VIEWER_HANDLE = 'you' are removed from
    // production Stories and Feed. The seeded curators must not appear here.
    await openSocial(page);
    const main = page.locator('main');
    await expect(main).not.toContainText(/Your story/i);
    await expect(page.getByTestId('feed-memory')).toHaveCount(0);
    await expect(page.locator('[data-testid="story-rail-item"]')).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------------ */
/* SIGNED IN — the viewer, the queue, the pause rules, the consent sheet.    */
/* ------------------------------------------------------------------------ */

/**
 * Everything below was DELETED when Stories became server-backed, on the
 * reasoning that driving it "needs two real accounts and a database". Only the
 * AUTHORIZATION half needs that, and that half keeps its home in
 * `src/lib/storiesRls.live.test.ts`. Progress counts, person-to-person handoff,
 * exhaustion, the pause rules and the tagged-person consent control are UI
 * behaviour over rows the server hands down — stubbing the transport (the same
 * cookie + route-stub pattern `friends-real.spec.ts` uses) drives all of it
 * through the production build, on both engines. Both review families flagged
 * the deletion as coverage lost; it was.
 */
test.describe('Stories — signed in', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('the rail carries your cell and every friend with a live story', async ({ page }) => {
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await openSocial(page);

    await expect(page.getByTestId('stories-rail')).toBeVisible();
    await expect(page.getByTestId('story-rail-you')).toBeVisible();
    const cells = page.getByTestId('story-rail-item');
    await expect(cells).toHaveCount(2);
    // Newest author first, and an unwatched story draws the ring.
    await expect(cells.first()).toHaveAttribute('data-author', CLAIRE_ID);
    await expect(cells.first()).toHaveAttribute('data-unseen', 'true');
  });

  test('opening a friend opens THAT friend, one progress segment per item', async ({
    page,
  }) => {
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'c2', author_id: CLAIRE_ID, created_at: ago(6) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await openSocial(page);

    await page.getByTestId('story-rail-item').first().click();
    const viewer = page.getByTestId('story-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('aria-label', /Claire/);
    // The segment count is DATA, so a handoff visibly redraws the strip.
    await expect(page.getByTestId('story-progress')).toHaveAttribute('data-segments', '2');
  });

  test('the queue hands off person to person, then exhausts onto Tonight', async ({
    page,
  }) => {
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'c2', author_id: CLAIRE_ID, created_at: ago(6) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await openSocial(page);
    // Start from Feed, so exhaustion has a sub-tab to MOVE from.
    await page.getByRole('tab', { name: /Feed/i }).click();
    await page.getByTestId('story-rail-item').first().click();

    const viewer = page.getByTestId('story-viewer');
    await expect(viewer).toHaveAttribute('aria-label', /Claire/);

    // Advance with the keyboard: deterministic, and the same code path the
    // 5-second timer takes. Item 2 of Claire…
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toHaveAttribute('aria-label', /Claire/);
    // …then the HANDOFF: author, avatar and progress strip change together.
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toHaveAttribute('aria-label', /Dev/);
    await expect(page.getByTestId('story-progress')).toHaveAttribute('data-segments', '1');

    // Past the last item of the last person: the queue is exhausted, the
    // viewer closes, and the surface lands on Tonight — not on Feed, where it
    // started, and not on a dead dialog.
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
  });

  test('going back walks the queue in reverse, across the person boundary', async ({
    page,
  }) => {
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await openSocial(page);
    await page.getByTestId('story-rail-item').nth(1).click();

    const viewer = page.getByTestId('story-viewer');
    await expect(viewer).toHaveAttribute('aria-label', /Dev/);
    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toHaveAttribute('aria-label', /Claire/);
    // And the first person's first item is the floor — back does not close.
    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toBeVisible();
  });

  test('keyboard focus on the chrome pauses the queue; a pointer tap does not', async ({
    page,
  }) => {
    await stubStories(page, {
      following: [CLAIRE],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'c2', author_id: CLAIRE_ID, created_at: ago(6) }),
      ],
    });
    await openSocial(page);
    await page.getByTestId('story-rail-item').first().click();

    const viewer = page.getByTestId('story-viewer');
    await expect(viewer).toHaveAttribute('data-paused', 'false');

    // Accessibility focus on a control means someone is reading it: hold.
    await page.getByTestId('story-close').focus();
    await expect(viewer).toHaveAttribute('data-paused', 'true');
    await page.getByTestId('story-close').blur();
    await expect(viewer).toHaveAttribute('data-paused', 'false');

    // A pointer tap is NOT accessibility focus, on either engine: Chromium
    // focuses a button on pointer-down and WebKit does not, and the viewer
    // blurs on pointer-up precisely so the two agree.
    await page.getByTestId('story-forward-zone').click();
    await expect(viewer).toHaveAttribute('data-paused', 'false');
  });

  test('a tagged person can see the tag and withdraw it from the story', async ({
    page,
  }) => {
    // The whole tag surface was unreachable before this round: publication
    // wrote story_tags rows and the read path hardcoded an empty list, so the
    // chip, the sheet and Remove me could never render. This test fails
    // outright against that code.
    const stub = await stubStories(page, {
      following: [CLAIRE],
      stories: [story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) })],
      tags: [{ story_id: 'c1', profile_id: YOU_ID }],
    });
    await openSocial(page);
    await page.getByTestId('story-rail-item').first().click();

    const chip = page.getByTestId('story-people-chip');
    await expect(chip).toBeVisible();
    await chip.click();

    const sheet = page.getByTestId('tagged-people-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('tagged-person-row')).toHaveCount(1);

    // An OPEN SHEET PAUSES THE QUEUE. Reading who is tagged, and deciding
    // whether to withdraw, is not something the viewer should have to do
    // against a running timer — the story advancing out from under this sheet
    // would take the consent control with it.
    await expect(page.getByTestId('story-viewer')).toHaveAttribute('data-paused', 'true');

    const removeMe = page.getByTestId('remove-me');
    await expect(removeMe).toBeVisible();
    await removeMe.click();

    // The sheet closes only after the BACKEND confirmed, and the tag is gone
    // from the server's answer — not merely from this device.
    await expect(sheet).toHaveCount(0);
    expect(stub.tags).toHaveLength(0);
  });

  test('a refused withdrawal says so and keeps the sheet open', async ({ page }) => {
    const stub = await stubStories(page, {
      following: [CLAIRE],
      stories: [story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) })],
      tags: [{ story_id: 'c1', profile_id: YOU_ID }],
    });
    stub.untagResult = 'error';
    await openSocial(page);
    await page.getByTestId('story-rail-item').first().click();
    await page.getByTestId('story-people-chip').click();
    await page.getByTestId('remove-me').click();

    // A consent control that reports a removal it did not achieve is worse
    // than one that visibly refused.
    await expect(page.getByTestId('story-viewer-save-failed')).toBeVisible();
    await expect(page.getByTestId('tagged-people-sheet')).toBeVisible();
    expect(stub.tags).toHaveLength(1);
  });

  test('the plus you can SEE is the plus you can tap, and the avatar keeps its own pixels', async ({ page }) => {
    // THE DESIGN CHANGED HERE, on operator evidence, and the old assertion is
    // why the defect survived. This test used to require that the mark's left
    // edge belong to the AVATAR — the mark was declared decoration and the real
    // target was the 44px box beside it. That fixed the mark stealing taps by
    // making the visible thing and the tappable thing two different objects,
    // which is a bug in the other direction: the operator reported "I click the
    // button and it doesn't let me post", because a tap aimed at the badge
    // landed on the avatar and OPENED their story instead of the composer.
    //
    // The rule now is the one a user can actually predict: every pixel of the
    // mark adds to your story, every pixel of the avatar opens it, and the two
    // never overlap.
    await stubStories(page, {
      following: [],
      stories: [story({ id: 'y1', author_id: YOU_ID, created_at: ago(2) })],
    });
    await openSocial(page);

    const yourStory = page.getByTestId('story-rail-your-story');
    const add = page.getByTestId('add-story');
    await expect(yourStory).toBeVisible();
    await expect(add).toBeVisible();

    const avatarBox = await yourStory.boundingBox();
    const addBox = await add.boundingBox();
    const badgeBox = await page.getByTestId('add-story-badge').boundingBox();
    if (avatarBox === null || addBox === null || badgeBox === null) {
      throw new Error('rail cells not laid out');
    }

    // The two TARGETS still do not overlap, and the add target is still real.
    expect(addBox.x).toBeGreaterThanOrEqual(avatarBox.x + avatarBox.width - 0.5);
    expect(addBox.width).toBeGreaterThanOrEqual(44);
    expect(addBox.height).toBeGreaterThanOrEqual(44);

    // NEW: the mark no longer overhangs the avatar. It sits INSIDE its own
    // button, so what you aim at is what you hit.
    expect(badgeBox.x).toBeGreaterThanOrEqual(addBox.x - 0.5);
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(addBox.x + addBox.width + 0.5);

    // Hit-tested rather than merely measured, and at the badge's LEFT edge —
    // the pixel the old design gave to the avatar. elementFromPoint rather than
    // a click because the avatar is a circle and the two engines hit-test
    // border-radius differently, while the defect is engine-independent.
    const ownerAtBadge = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      if (element === null) return 'nothing';
      if (element.closest('[data-testid="add-story"]') !== null) return 'add';
      if (element.closest('[data-testid="story-rail-your-story"]') !== null) return 'story';
      return element.getAttribute('data-testid') ?? element.tagName.toLowerCase();
    }, { x: badgeBox.x + 2, y: badgeBox.y + badgeBox.height / 2 });
    expect(ownerAtBadge).toBe('add');

    // And the avatar's own bottom edge, mid-width, still opens the story —
    // the regression the previous version of this test existed to prevent.
    const ownerAtAvatarBottom = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      if (element === null) return 'nothing';
      if (element.closest('[data-testid="add-story"]') !== null) return 'add';
      if (element.closest('[data-testid="story-rail-your-story"]') !== null) return 'story';
      return element.getAttribute('data-testid') ?? element.tagName.toLowerCase();
    }, {
      x: avatarBox.x + avatarBox.width / 2,
      y: avatarBox.y + avatarBox.height - 4,
    });
    expect(ownerAtAvatarBottom).toBe('story');

    // AND THE AVATAR IS STILL CLICKED FOR REAL. Hit-testing proves ownership,
    // not that the handler behind it is the right one — a swapped onOpen would
    // satisfy every assertion above. Codex caught that this rewrite had dropped
    // the real click the old test carried.
    await yourStory.click();
    await expect(page.getByTestId('story-viewer')).toBeVisible();
    await expect(page.getByTestId('capture-modes')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('story-viewer')).toHaveCount(0);

    // Tapping the mark reaches CAPTURE, which is the thing the operator could
    // not do. Asserted through a real click, not geometry.
    await add.click();
    await expect(page.getByTestId('capture-modes')).toBeVisible();
  });

  test('the story ring is not clipped by the rail it sits in', async ({ page }) => {
    // An ACTIVE ring is `ring-2 ring-offset-2` — 4px painted OUTSIDE the 56px
    // avatar box on every side — and the rail is `overflow-x-auto`, which makes
    // the block axis a scroll container too, so it clips top and bottom as
    // well. The scroller carried `pb-1` and no top padding, so the bottom 4px
    // survived and the top 4px was cut. Operator: "the top of the circle for
    // story is still cropped". It only shows once a story exists, because the
    // ring is only drawn when active.
    //
    // Measured as a GAP, not as a box: the stroke is a box-shadow and does not
    // appear in getBoundingClientRect, so the assertion is that the avatar
    // leaves at least the stroke's width between itself and the clip edge.
    const RING_OUTSET = 4;
    await stubStories(page, {
      following: [],
      stories: [story({ id: 'y1', author_id: YOU_ID, created_at: ago(2) })],
    });
    await openSocial(page);

    const ring = page.getByTestId('story-ring').first();
    await expect(ring).toHaveAttribute('data-active', 'true');
    // The stroke must actually BE there. Asserting only the gap would stay
    // green if the ring classes were deleted outright, which is the failure
    // this test is supposed to make impossible.
    const shadow = await ring.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');

    const ringBox = await ring.boundingBox();
    const clipTop = await page.locator('[data-carousel]').evaluate(
      // Overflow clips at the PADDING box, so padding-top is room the stroke
      // may legally paint into; the border box top is the clip edge.
      (el) => el.getBoundingClientRect().top,
    );
    if (ringBox === null) throw new Error('rail not laid out');
    expect(ringBox.y - clipTop).toBeGreaterThanOrEqual(RING_OUTSET);
  });

  test('the page under an open story dialog is inert', async ({ page }) => {
    // aria-modal="true" claims the rest of the page does not exist. A Tab trap
    // is only one way in — a screen-reader cursor or a programmatic focus()
    // reaches the backdropped page regardless — so the claim is only true if
    // the background is actually inert.
    await stubStories(page, {
      following: [CLAIRE],
      stories: [story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) })],
    });
    await openSocial(page);
    await page.getByTestId('story-rail-item').first().click();
    await expect(page.getByTestId('story-viewer')).toBeVisible();

    const railReachable = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('[data-testid="story-rail-item"]');
      if (rail === null) return 'missing';
      rail.focus();
      return document.activeElement === rail ? 'focused' : 'inert';
    });
    expect(railReachable).toBe('inert');

    // And closing gives the page back.
    await page.getByTestId('story-close').click();
    await expect(page.getByTestId('story-viewer')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-item').first()).toBeVisible();
  });

  test('a signed-in Feed with nothing in it says so rather than rendering nothing', async ({
    page,
  }) => {
    // READY-AND-EMPTY is its own state. Rendering nothing made an account with
    // no friends' stories look exactly like one that had not finished loading
    // — the collapse StoriesEmptyState exists to prevent, one level down.
    await stubStories(page, { following: [], stories: [] });
    await openSocial(page);
    await page.getByRole('tab', { name: /Feed/i }).click();

    await expect(page.getByTestId('feed-empty')).toBeVisible();
    await expect(page.getByTestId('feed-empty')).toContainText(/24 hours/i);
    await expect(page.getByTestId('feed-memory')).toHaveCount(0);
    // And it is NOT the unreachable state: those must never look the same.
    await expect(page.getByTestId('stories-unavailable')).toHaveCount(0);
  });

  test('the Feed lists the same live stories, newest first', async ({ page }) => {
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await openSocial(page);
    await page.getByRole('tab', { name: /Feed/i }).click();

    const memories = page.getByTestId('feed-memory');
    await expect(memories).toHaveCount(2);
    await expect(page.getByTestId('feed-empty')).toHaveCount(0);
    await expect(memories.first()).toContainText(/Claire/);
  });
});
