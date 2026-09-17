/**
 * add-story.spec.ts — the Add-to-Story branch, after the V8 Stories backend.
 *
 * WHAT THIS FILE NO LONGER DOES, AND WHY. Cycle 1 could walk the whole branch
 * signed-OUT: capture wrote a data URL, compose picked from `demoFriends`, and
 * "Add to my story" wrote a `localStorage` record, so the receipt and the
 * stored payload were both assertable here.
 *
 * None of that is true now. Publication uploads real bytes to a private bucket
 * and calls `publish_story`, which requires a session, and the recipients come
 * from the real mutual-friend graph.
 *
 * THAT DOES NOT MEAN THE BRANCH IS UNTESTABLE, which is what this header used
 * to claim ("needs two real accounts and a database") — and the branch then
 * shipped with no end-to-end coverage at all. A session and a transport are
 * stubbable; an authorization RULE is not. The split:
 *
 *   - custom-audience enforcement, non-mutual refusal, expiry, ownership of an
 *     object key, tag withdrawal → `src/lib/storiesRls.live.test.ts` (two
 *     identities, needs a database; NOT run here — the attended staging
 *     verification). These are decisions the DATABASE makes.
 *   - upload-then-publish ordering, cleanup of a partial upload, "Shared" only
 *     after BOTH succeed, honest failure text, signed-URL lifetime →
 *     `src/lib/stories.server.test.ts` (runs in this gate).
 *   - the five screens themselves, the review gate, the compose dock, the
 *     audience sheet, the receipt, Undo and its failure → the signed-in block
 *     at the bottom of this file, driven through the production UI against a
 *     stubbed Supabase (`e2e/helpers/stories.ts`).
 *
 * CAPTURE-MODE COVERAGE, STATED HONESTLY. This header used to claim the
 * signed-in block covered "the capture modes". It did not, and both reviewer
 * lanes caught the claim: every signed-in test drives the LIBRARY path only.
 * What is actually covered end-to-end:
 *
 *   - library pick → review → compose → publish: yes, below.
 *   - permission DENIED on a live capture mode: yes, below — `getUserMedia` is
 *     stubbed to reject with NotAllowedError, which is the one camera outcome
 *     reachable without a real device.
 *   - live single-camera capture and front+back composition: NOT covered here.
 *     Both need a fake media stream (`--use-fake-device-for-media-stream`) and
 *     a Chromium-only launch flag; the pairing and one-camera state machines
 *     are unit-covered in `src/components/capture/pairing.test.ts` and
 *     `oneCameraSystem.test.ts`. Recorded as a gap rather than implied away.
 *
 * The signed-out assertions stay: the entry point is absent without a session,
 * and the audience surface offers no group feature that does not exist.
 */

import { test, expect, type Page } from './helpers/test';
import { cameraCalls, stubCamera, waitForCameraFrame } from './helpers/camera';
import {
  CLAIRE,
  CLAIRE_ID,
  DEV_ID,
  DEV,
  SUPABASE_URL,
  YOU_ID,
  ago,
  signIn,
  stubStories,
  story,
} from './helpers/stories';

test.describe('Add to Story', () => {
  test('there is no add entry point without a session', async ({ page }) => {
    await page.goto('/friends');
    await expect(page.getByTestId('social-subtabs')).toBeVisible();

    // The plus lives on your own rail cell, and there is no rail signed out.
    await expect(page.getByTestId('add-story')).toHaveCount(0);
    await expect(page.getByTestId('capture-modes')).toHaveCount(0);
    await expect(page.getByTestId('composer-compose')).toHaveCount(0);

    // And the surface says why rather than showing a dead control.
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
  });

  test('"Selected groups" is removed from the V8 audience surface', async ({
    page,
  }) => {
    // Item 6 of the amendment: no saved-groups capability exists, so a people
    // picker must not be presented as a group feature. Asserted as ABSENCE of
    // the string anywhere on Social — the sheet itself needs a session, and a
    // test that could only run signed-in would not catch a stray label here.
    await page.goto('/friends');
    await expect(page.locator('main')).not.toContainText(/Selected groups/i);
  });

  test('no story is ever written to browser storage', async ({ page }) => {
    // The strongest local assertion left: whatever the surface does signed
    // out, it must not create the retired story records.
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();
    const stored = await page.evaluate(() => ({
      stories: window.localStorage.getItem('next-bar:stories:v1'),
      replies: window.localStorage.getItem('next-bar:story-replies:v1'),
      untagged: window.localStorage.getItem('next-bar:stories-untagged:v1'),
    }));
    expect(stored.stories).toBeNull();
    expect(stored.replies).toBeNull();
    expect(stored.untagged).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* SIGNED IN — the five-screen branch, the capture pipeline, the receipt.    */
/* ------------------------------------------------------------------------ */

/**
 * The Add-Story branch and the capture pipeline had NO end-to-end coverage
 * after the move to the server-backed store: this file checked only that the
 * entry point is absent while signed out. Publication needs a session, so the
 * session is stubbed (the `friends-real.spec.ts` cookie + route pattern) and
 * the branch is driven through the production UI exactly as a user drives it —
 * library pick, review gate, compose, audience, "Add to my story", receipt,
 * Undo. What the SERVER decides (mutuality, expiry, ownership) stays in
 * `src/lib/storiesRls.live.test.ts`; what the BROWSER does is asserted here.
 */

/** A real 1x1 PNG, so the capture pipeline's decode + re-encode actually runs. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function pickFromLibrary(page: Page): Promise<void> {
  await page.getByTestId('capture-mode-library').click();
  await page.getByTestId('capture-library-input').setInputFiles({
    name: 'night.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
}

/** Capture → review → approve, landing on compose. */
async function captureAndApprove(page: Page): Promise<void> {
  await page.getByTestId('add-story').click();
  await expect(page.getByTestId('capture-modes')).toBeVisible();
  await pickFromLibrary(page);
  // The review gate is not skippable: there is no path from a frame to
  // compose that does not pass through it.
  await expect(page.getByTestId('capture-review')).toBeVisible();
  await page.getByTestId('capture-approve').click();
  await expect(page.getByTestId('composer-compose')).toBeVisible();
}

/**
 * S-11: compose → Next → Destinations → Story on → Share. Since the one
 * composer replaced the Story-only dock, "add to my story" is a destination
 * choice like any other, and the CTA names it.
 */
async function shareToStory(page: Page): Promise<void> {
  await page.getByTestId('composer-next').click();
  await expect(page.getByTestId('composer-destinations')).toBeVisible();
  await page.getByTestId('composer-destination-story').click();
  await expect(page.getByTestId('composer-share')).toHaveText('Share to Story');
  await page.getByTestId('composer-share').click();
}

test.describe('Add to Story — signed in', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('the whole branch: capture, review, compose, audience, receipt', async ({
    page,
  }) => {
    const stub = await stubStories(page, { following: [CLAIRE, DEV] });
    await page.goto('/friends');
    await expect(page.getByTestId('social-subtabs')).toBeVisible();

    await captureAndApprove(page);

    // Compose (README §9.3): "Share a moment.", Bar and People rows, Next.
    await expect(page.getByTestId('composer-compose')).toContainText('Share a moment.');
    await expect(page.getByTestId('composer-next')).toHaveText('Next');
    await page.getByTestId('composer-next').click();

    // Destinations (README §9.4): exactly four rows, no fifth; nothing selected
    // holds the CTA; Story on reveals the JOINED audience sub-row, which opens
    // the audience sheet (Friends by default) as a sheet, not a fourth screen.
    const destinations = page.getByTestId('composer-destinations');
    await expect(destinations).toBeVisible();
    await expect(destinations.locator('[data-destination]')).toHaveCount(4);
    await expect(destinations.locator('[data-destination]')).toHaveText([
      /Feed/, /Story/, /Night Out/, /Group/,
    ]);
    await expect(page.getByTestId('composer-share')).toBeDisabled();
    await expect(page.getByTestId('composer-story-audience')).toHaveCount(0);
    await page.getByTestId('composer-destination-story').click();
    await expect(page.getByTestId('composer-story-audience')).toBeVisible();
    await expect(page.getByTestId('composer-story-audience-value')).toHaveText('Friends');
    await page.getByTestId('composer-story-audience').click();
    await expect(page.getByTestId('composer-audience-sheet')).toBeVisible();
    await expect(page.getByTestId('composer-audience-option')).toHaveCount(2);
    await page.getByTestId('composer-audience-done').click();
    await expect(page.getByTestId('composer-share')).toHaveText('Share to Story');
    await page.getByTestId('composer-share').click();

    // The receipt claims the story is live for 24 hours, so it appears only
    // once BOTH the upload and the metadata publish actually succeeded.
    const receipt = page.getByTestId('composer-receipt');
    await expect(receipt).toBeVisible();
    // README §9.5: "Shared." + one consequence line, "See it" + Undo.
    await expect(page.getByTestId('composer-receipt-headline')).toHaveText('Shared.');
    await expect(page.getByTestId('composer-receipt-consequence')).toHaveText('Live for 24 hours.');
    await expect(page.getByTestId('composer-receipt-primary')).toHaveText('See it');
    await expect(page.getByTestId('composer-receipt-undo')).toHaveText('Undo');
    expect(stub.published).toHaveLength(1);
    expect(stub.uploads).toHaveLength(1);
    // Upload comes FIRST and under the author's own prefix — the key
    // convention migration 0065's bucket policy keys ownership on.
    expect(stub.uploads[0].startsWith(`${YOU_ID}/`)).toBe(true);
    expect(stub.published[0].p_media_path).toBe(stub.uploads[0]);
    expect(stub.published[0].p_audience).toBe('friends');
  });

  test('a picked photo that cannot be re-encoded is refused, out loud', async ({
    page,
  }) => {
    // The canvas re-encode is the ONLY thing stripping EXIF/GPS on this path,
    // so a file that will not go through it is not published. It used to
    // return silently, which read as a dead button — and the fallback it
    // replaced published the original bytes, metadata intact.
    await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    await page.getByTestId('capture-mode-library').click();
    await page.getByTestId('capture-library-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a photo'),
    });

    await expect(page.getByTestId('capture-library-failed')).toBeVisible();
    // And it did not sneak past the review gate.
    await expect(page.getByTestId('capture-review')).toHaveCount(0);
    await expect(page.getByTestId('capture-modes')).toBeVisible();
  });

  test('Retake returns to the capture options, and the footer says so', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    await pickFromLibrary(page);

    const review = page.getByTestId('capture-review');
    await expect(review).toBeVisible();
    // The copy used to promise the CAMERA reopens — doubly wrong for a
    // library-sourced draft that never used one.
    await expect(review).toContainText(/reopens the capture options/i);
    await page.getByTestId('capture-retake').click();
    await expect(page.getByTestId('capture-modes')).toBeVisible();
    await expect(page.getByTestId('capture-review')).toHaveCount(0);
  });

  test('people picked in compose are published as tags and come back on the story', async ({
    page,
  }) => {
    const stub = await stubStories(page, { following: [CLAIRE, DEV] });
    await page.goto('/friends');
    await captureAndApprove(page);

    await page.getByTestId('composer-people').click();
    const sheet = page.getByTestId('story-people-sheet');
    await expect(sheet).toBeVisible();
    // README §9.3 "Tag friends": the mutuals line, a search field, a count.
    await expect(sheet).toContainText('Friends are people you follow who follow you back.');
    await expect(page.getByTestId('story-people-count')).toHaveText('2 friends · 0 picked');
    await page.getByTestId('story-people-row').first().click();
    await expect(page.getByTestId('story-people-count')).toHaveText('2 friends · 1 picked');
    await page.getByTestId('story-people-done').click();
    await expect(sheet).toHaveCount(0);

    await shareToStory(page);
    await expect(page.getByTestId('composer-receipt')).toBeVisible();

    // Published as a REAL profile id, never a handle…
    expect(stub.published[0].p_tag_ids).toEqual([CLAIRE_ID]);
    // …and the tag survives the round trip into the viewer, which is what the
    // discarded read path made impossible.
    await page.getByTestId('composer-receipt-primary').click();
    await expect(page.getByTestId('story-viewer')).toBeVisible();
    await expect(page.getByTestId('story-people-chip')).toBeVisible();
  });

  test('"View story" opens YOUR story, never whoever happens to be first', async ({
    page,
  }) => {
    // The reachable bug: publish, tap View story, and the refreshed queue has
    // not landed your own story yet — your id is absent, so the viewer fell
    // back to groups[0] and opened a FRIEND, then stayed there.
    await stubStories(page, {
      following: [CLAIRE, DEV],
      stories: [
        story({ id: 'c1', author_id: CLAIRE_ID, created_at: ago(5) }),
        story({ id: 'd1', author_id: DEV_ID, created_at: ago(30) }),
      ],
    });
    await page.goto('/friends');
    await captureAndApprove(page);
    await shareToStory(page);
    await expect(page.getByTestId('composer-receipt')).toBeVisible();

    await page.getByTestId('composer-receipt-primary').click();
    const viewer = page.getByTestId('story-viewer');
    await expect(viewer).toBeVisible();
    // "You", not Claire and not Dev.
    await expect(viewer).toHaveAttribute('aria-label', /^You/);
  });

  test('a failed Undo is visible, and says the story is still live', async ({
    page,
  }) => {
    // Undo DELETES on the server. A failure used to be stored in state and
    // rendered nowhere: the user tapped Undo, the screen sat there unchanged,
    // and they were left believing the story had been withdrawn while it
    // stayed live for every friend.
    const stub = await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await shareToStory(page);
    await expect(page.getByTestId('composer-receipt')).toBeVisible();

    stub.deleteError = { message: 'delete refused' };
    await page.getByTestId('composer-receipt-undo').click();

    const failure = page.getByTestId('composer-undo-failed');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(/still live/i);
    // The receipt does NOT close on a failed Undo — closing would be the
    // same silent claim in a different costume.
    await expect(page.getByTestId('composer-receipt')).toBeVisible();
    expect(stub.stories).toHaveLength(1);
  });

  test('a successful Undo removes the story and leaves the branch', async ({ page }) => {
    const stub = await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await shareToStory(page);
    await expect(page.getByTestId('composer-receipt')).toBeVisible();
    expect(stub.stories).toHaveLength(1);

    await page.getByTestId('composer-receipt-undo').click();
    await expect(page.getByTestId('composer-receipt')).toHaveCount(0);
    expect(stub.stories).toHaveLength(0);
    // The bytes go too — the RPC hands back the keys precisely so they can.
    expect(stub.removed.length).toBeGreaterThan(0);
  });

  test('a refused publish shows no receipt and says nothing was shared', async ({
    page,
  }) => {
    const stub = await stubStories(page, { following: [CLAIRE] });
    stub.publishError = { code: '42501', message: 'not a mutual friend' };
    await page.goto('/friends');
    await captureAndApprove(page);
    await shareToStory(page);

    // "Shared" is only true when the server took it: a publish that landed
    // nowhere returns to Compose with the draft intact and says so.
    await expect(page.getByTestId('composer-publish-failed')).toBeVisible();
    await expect(page.getByTestId('composer-publish-failed')).toContainText(/Nothing was shared/i);
    await expect(page.getByTestId('composer-receipt')).toHaveCount(0);
    await expect(page.getByTestId('composer-compose')).toBeVisible();
  });

  // S-11 (README §9.3 / §9.4 / audience sheet): the composer's own contracts,
  // driven on the real route. The store is stubbed; nothing here writes until
  // a test says so.
  test('the caption counter appears only in the last 40 characters, and Retake reopens the capture options', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await captureAndApprove(page);
    const caption = page.getByTestId('composer-caption');
    await expect(page.getByTestId('composer-caption-count')).toHaveCount(0);
    await caption.fill('x'.repeat(99));
    await expect(page.getByTestId('composer-caption-count')).toHaveCount(0);
    await caption.fill('x'.repeat(100));
    await expect(page.getByTestId('composer-caption-count')).toHaveText('40 characters left');
    await caption.fill('x'.repeat(200));
    await expect(caption).toHaveValue('x'.repeat(140));
    await expect(page.getByTestId('composer-caption-count')).toHaveText('0 characters left');

    await page.getByTestId('composer-retake').click();
    await expect(page.getByTestId('capture-modes')).toBeVisible();
    await expect(page.getByTestId('composer-compose')).toHaveCount(0);
  });

  test('the CTA names its picks, and the Story audience sub-row comes and goes with the Story row', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    const share = page.getByTestId('composer-share');
    await expect(share).toBeDisabled();
    await expect(share).toHaveText('Pick a place to share');

    await page.getByTestId('composer-destination-feed').click();
    await expect(share).toHaveText('Share to Feed');
    await page.getByTestId('composer-destination-story').click();
    await expect(share).toHaveText('Share to Feed and Story');
    await expect(page.getByTestId('composer-story-audience')).toBeVisible();
    await page.getByTestId('composer-destination-story').click();
    await expect(page.getByTestId('composer-story-audience')).toHaveCount(0);
    await expect(share).toHaveText('Share to Feed');
    // With no night out tonight the row says so and cannot be turned on.
    await expect(page.getByTestId('composer-destination-night_out')).toContainText('No night out tonight');
    await expect(page.getByTestId('composer-destination-night_out')).toBeDisabled();
    await expect(page.getByTestId('composer-destinations')).toContainText(
      'One capture, one publish — no review screen after this.',
    );
  });

  test('the audience sheet: two options, Done held until somebody is picked, search by @handle, dismiss falls back to Friends', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE, DEV] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    await page.getByTestId('composer-destination-story').click();
    await page.getByTestId('composer-story-audience').click();
    const sheet = page.getByTestId('composer-audience-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('composer-audience-option')).toHaveCount(2);
    await expect(sheet).toContainText('Applies to this story only. Your Account default stays Friends.');

    await sheet.getByText('Custom', { exact: true }).click();
    const done = page.getByTestId('composer-audience-done');
    await expect(done).toHaveText('Pick at least one person');
    await expect(done).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('composer-audience-person')).toHaveCount(2);
    await page.getByTestId('composer-audience-search').fill(`@${CLAIRE.handle}`);
    await expect(page.getByTestId('composer-audience-person')).toHaveCount(1);
    await expect(page.getByTestId('composer-audience-person')).toHaveAttribute('data-profile', CLAIRE_ID);
    // …and by NAME (R-05a: both dimensions, both pickers).
    await page.getByTestId('composer-audience-search').fill('Dev');
    await expect(page.getByTestId('composer-audience-person')).toHaveCount(1);
    await expect(page.getByTestId('composer-audience-person')).toHaveAttribute('data-profile', DEV_ID);
    await page.getByTestId('composer-audience-search').fill('');
    await expect(page.getByTestId('composer-audience-person')).toHaveCount(2);

    // Dismiss with Custom still empty → back to Friends.
    await sheet.getByRole('button', { name: 'Close story audience' }).click();
    await expect(page.getByTestId('composer-story-audience-value')).toHaveText('Friends');
  });

  // Fable, S-11 round 1 (HIGH): Feed is reachable from here for the first
  // time, and "See it" after a Feed-only publish used to land on the Feed
  // panel's story-only empty state — the page mounted FeedSection (the only
  // reader of feed_posts) only when a live story existed, so the post the
  // author had just been told about was unreachable anywhere in the app.
  test('a Feed-only publish uploads once, and "See it" opens a Feed that shows the post', async ({
    page,
  }) => {
    const stub = await stubStories(page, { following: [CLAIRE], stories: [] });
    const posts: Record<string, unknown>[] = [];
    const seen: { feed: Record<string, unknown> | null } = { feed: null };
    // The two Feed surfaces the stories stub does not cover: the publish RPC
    // and the posts read. Registered after stubStories so they win (newest-first).
    await page.route('**/rest/v1/rpc/publish_feed_post**', async (route) => {
      const args = route.request().postDataJSON() as Record<string, unknown>;
      seen.feed = args;
      const row = {
        id: 'post-1',
        author_id: YOU_ID,
        media_id: String(args.p_media_id),
        bar_id: null,
        caption: (args.p_caption as string | null) ?? null,
        night_out_id: null,
        audience: 'friends',
        audience_group_id: null,
        created_at: ago(0),
      };
      posts.unshift(row);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) });
    });
    await page.route('**/rest/v1/feed_posts**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(posts) });
    });

    await page.goto('/friends');
    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    await page.getByTestId('composer-destination-feed').click();
    await expect(page.getByTestId('composer-share')).toHaveText('Share to Feed');
    await page.getByTestId('composer-share').click();

    const receipt = page.getByTestId('composer-receipt');
    await expect(receipt).toBeVisible();
    await expect(page.getByTestId('composer-receipt-consequence')).toHaveText(
      'On your feed until you delete it.',
    );
    // ONE upload through the media boundary, and the post is keyed to it.
    expect(stub.uploads).toHaveLength(1);
    expect(seen.feed?.p_media_id).toBe('e2e-media-1');
    // Nothing went to Story: only Feed was picked.
    expect(stub.published).toHaveLength(0);

    await expect(page.getByTestId('composer-receipt-primary')).toHaveText('See it');
    await page.getByTestId('composer-receipt-primary').click();
    await expect(page.getByTestId('composer-receipt')).toHaveCount(0);
    await expect(page.getByTestId('social-panel-feed')).toBeVisible();
    await expect(page.getByTestId('friends-feed')).toBeVisible();
    await expect(page.getByTestId('feed-post')).toHaveCount(1);
    await expect(page.getByTestId('feed-empty')).toHaveCount(0);
  });

  // R-05a: composer targets are read when the flow OPENS, not at page mount, and
  // the Night Out row honours the plan's media window (the server's answer).
  test('composer targets load on open, and a plan whose photo window has not opened is held with the time', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    let groupReads = 0;
    let nightReads = 0;
    await page.route('**/rest/v1/groups**', async (route) => {
      groupReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/rest/v1/rpc/get_my_night_outs**', async (route) => {
      nightReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    // The owner read: RLS filtering is the server's; the stub answers the row.
    // A REAL uuid: the window helper refuses anything else before it asks.
    await page.route('**/rest/v1/night_outs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: '0f3a1b2c-4d5e-4f60-8a71-92b3c4d5e6f7', title: 'Friday at The Fox', night: '2026-09-16', status: 'open' }]),
      });
    });
    // Switchable, so the same page can prove the row is re-read on each open.
    const windowRow: { is_open: boolean; state: string } = { is_open: false, state: 'before' };
    await page.route('**/rest/v1/rpc/night_out_media_window**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            opens_at: '2026-09-17T01:00:00.000Z',
            expires_at: '2026-09-17T09:00:00.000Z',
            is_open: windowRow.is_open,
            state: windowRow.state,
          },
        ]),
      });
    });

    await page.goto('/friends');
    await expect(page.getByTestId('social-subtabs')).toBeVisible();
    // Nothing read yet: the composer is closed.
    expect(groupReads).toBe(0);
    expect(nightReads).toBe(0);

    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    const row = page.getByTestId('composer-destination-night_out');
    // Held, and it SAYS when — 01:00Z is 9:00 PM in New York.
    await expect(row).toContainText('Friday at The Fox · opens at 9:00 PM');
    await expect(row).toBeDisabled();
    expect(groupReads).toBeGreaterThan(0);
    expect(nightReads).toBeGreaterThan(0);
    const readsAfterFirstOpen = nightReads;

    // A closed window is held too, in words (R-05a2).
    windowRow.is_open = false;
    windowRow.state = 'closed';
    await page.getByTestId('composer-destinations-exit').click();
    await expect(page.getByTestId('composer-destinations')).toHaveCount(0);
    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    await expect(row).toContainText("this night's photo window has closed");
    await expect(row).toBeDisabled();

    // Reopen with the window OPEN: the targets are re-read on THIS open (not
    // cached from the first), and the row is selectable and names the plan.
    windowRow.is_open = true;
    windowRow.state = 'open';
    await page.getByTestId('composer-destinations-exit').click();
    await expect(page.getByTestId('composer-destinations')).toHaveCount(0);
    await captureAndApprove(page);
    await page.getByTestId('composer-next').click();
    await expect(row).toBeEnabled();
    await expect(row).toContainText('Friday at The Fox · 24 hours from the start');
    expect(nightReads).toBeGreaterThan(readsAfterFirstOpen);
    await row.click();
    await expect(page.getByTestId('composer-share')).toHaveText('Share to Night Out');
  });

  test('Tag friends: the search field narrows the rows by name', async ({ page }) => {
    await stubStories(page, { following: [CLAIRE, DEV] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await page.getByTestId('composer-people').click();
    await expect(page.getByTestId('story-people-row')).toHaveCount(2);
    await page.getByTestId('story-people-search').fill('Dev');
    await expect(page.getByTestId('story-people-row')).toHaveCount(1);
    await expect(page.getByTestId('story-people-row')).toHaveAttribute('data-profile', DEV_ID);
    // …and by @HANDLE (R-05a: both dimensions, both pickers).
    await page.getByTestId('story-people-search').fill(`@${CLAIRE.handle}`);
    await expect(page.getByTestId('story-people-row')).toHaveCount(1);
    await expect(page.getByTestId('story-people-row')).toHaveAttribute('data-profile', CLAIRE_ID);
  });

  test('the page under the capture and compose dialogs does not scroll', async ({
    page,
  }) => {
    // Exactly one of the seven dialogs in this tree locked body scroll, so
    // wheel and touch scrolling moved the Social page underneath capture and
    // compose. A shared modal contract half the callers implement is not one.
    await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    await expect(page.getByTestId('capture-modes')).toBeVisible();

    const locked = await page.evaluate(() => getComputedStyle(document.body).position);
    expect(locked).toBe('fixed');

    await page.getByTestId('capture-cancel').click();
    await expect(page.getByTestId('capture-modes')).toHaveCount(0);
    const released = await page.evaluate(() => getComputedStyle(document.body).position);
    expect(released).not.toBe('fixed');
  });

  // The one live-camera outcome reachable without a real device, and the one a
  // user actually hits. Both reviewer lanes flagged that no e2e drove any
  // camera mode; a denied permission is a state the capture flow RENDERS
  // rather than throws, so it must not dead-end.
  test('a denied camera permission is an honest state with a way forward', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    // Reject exactly the way a real refusal does: the hook branches on the
    // error NAME, so a generic Error would take the 'unavailable' path and
    // assert nothing about denial.
    await page.addInitScript(() => {
      const denial = (): Promise<never> => {
        const error = new Error('Permission denied');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      };
      const media = navigator.mediaDevices ?? ({} as MediaDevices);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { ...media, getUserMedia: denial },
      });
    });

    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    await expect(page.getByTestId('capture-modes')).toBeVisible();
    await page.getByRole('button', { name: 'Take one photo' }).click();

    // Honest about what happened, and never a dead end: the library route out
    // is still offered, which is the whole point of rendering the state rather
    // than throwing.
    await expect(
      page.getByText('Camera access is off for Next Bar.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Choose from library')).toBeVisible();
  });

  // S-10 (README §9.1 + owner 2026-09-14): the live camera modes, driven end to
  // end through a fake stream that works on BOTH engines (helpers/camera.ts),
  // which closes the "capture modes NOT covered" gap the file header recorded.
  test('"Front + back" opens the rear camera at once, flips to the front, and lands on a paired review', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    await stubCamera(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    const sheet = page.getByTestId('capture-modes');
    await expect(sheet).toBeVisible();
    // §9.1: three rows, each with a stroked icon tile; a ✕ labelled "Close
    // capture" and no back chevron on this step.
    await expect(sheet.locator('svg')).toHaveCount(3);
    await expect(sheet.getByRole('button', { name: 'Close capture' })).toBeVisible();
    // No back chevron on this step (exact name — the "Front + back" row is not it).
    await expect(sheet.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await expect(sheet.getByText('‹')).toHaveCount(0);

    await page.getByTestId('capture-mode-dual').click();
    // No explainer interstitial: the rear camera opens at once.
    await expect(page.getByTestId('capture-dual-explainer')).toHaveCount(0);
    await expect(page.getByTestId('camera-stage')).toBeVisible();
    await expect(page.getByTestId('camera-step')).toHaveText(/1 of 2/);
    await waitForCameraFrame(page);
    expect(await cameraCalls(page)).toEqual(['environment']);

    // First shutter → the stage flips to the FRONT camera for the second shot.
    await page.getByTestId('camera-shutter').click();
    await expect(page.getByTestId('camera-step')).toHaveText(/2 of 2/);
    await waitForCameraFrame(page);
    expect(await cameraCalls(page)).toEqual(['environment', 'user']);

    // Second shutter → the paired review: inset present at 92px, 2×2 buttons.
    await page.getByTestId('camera-shutter').click();
    const review = page.getByTestId('capture-review');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute('data-pair-kind', 'dual');
    const inset = page.getByTestId('capture-inset');
    await expect(inset).toBeVisible();
    const box = await inset.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(92);
    await expect(page.getByTestId('capture-swap-main')).toBeVisible();
    await expect(page.getByTestId('capture-rotate-inset')).toBeVisible();
    await expect(page.getByTestId('capture-approve')).toHaveText('Use photos');

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('"Take one photo" reaches a review with no inset and no composition buttons', async ({
    page,
  }) => {
    await stubStories(page, { following: [CLAIRE] });
    await stubCamera(page);
    await page.goto('/friends');
    await page.getByTestId('add-story').click();
    await page.getByTestId('capture-mode-single').click();
    await expect(page.getByTestId('camera-stage')).toBeVisible();
    // The single path has no step chip and keeps its own Front/Rear flip.
    await expect(page.getByTestId('camera-step')).toHaveCount(0);
    await expect(page.getByTestId('camera-flip')).toBeVisible();
    await waitForCameraFrame(page);
    await page.getByTestId('camera-shutter').click();

    const review = page.getByTestId('capture-review');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute('data-pair-kind', 'single');
    await expect(page.getByTestId('capture-inset')).toHaveCount(0);
    await expect(page.getByTestId('capture-swap-main')).toHaveCount(0);
    await expect(page.getByTestId('capture-approve')).toHaveText('Use photo');
    // And the approved single frame lands on compose like a library pick does.
    await page.getByTestId('capture-approve').click();
    await expect(page.getByTestId('composer-compose')).toBeVisible();
  });
});

/**
 * V9-06: media capture belongs to THIS origin only. Inside the iPhone shell
 * Capacitor's WKUIDelegate grants getUserMedia to any origin it is asked about,
 * so the document itself must forbid capture for anything embedded in it —
 * and the app never requests a microphone. Asserted on the response header of
 * every kind of route the shell can load.
 */
test('every route forbids camera capture to other origins and the microphone entirely', async ({ page }) => {
  for (const route of ['/', '/friends', '/map']) {
    const response = await page.goto(route);
    expect(response, route).not.toBeNull();
    const policy = response!.headers()['permissions-policy'] ?? '';
    expect(policy, `${route} permissions-policy`).toMatch(/camera=\(self\)/);
    expect(policy, `${route} permissions-policy`).toMatch(/microphone=\(\)/);
  }
});
