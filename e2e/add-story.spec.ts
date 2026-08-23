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
 *   - the five screens themselves, the capture modes, the review gate, the
 *     compose dock, the audience sheet, the receipt, Undo and its failure →
 *     the signed-in block at the bottom of this file, driven through the
 *     production UI against a stubbed Supabase (`e2e/helpers/stories.ts`).
 *
 * The signed-out assertions stay: the entry point is absent without a session,
 * and the audience surface offers no group feature that does not exist.
 */

import { test, expect, type Page } from '@playwright/test';
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
    await expect(page.getByTestId('story-compose')).toHaveCount(0);

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
  await expect(page.getByTestId('story-compose')).toBeVisible();
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

    // Audience defaults to Friends and is a real screen, not a label.
    await page.getByTestId('story-compose-audience').click();
    await expect(page.getByTestId('story-audience-sheet')).toBeVisible();
    await page.getByTestId('story-audience-done').click();

    await page.getByTestId('story-compose-add').click();

    // The receipt claims the story is live for 24 hours, so it appears only
    // once BOTH the upload and the metadata publish actually succeeded.
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();
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

    await page.getByTestId('story-compose-people').click();
    await expect(page.getByTestId('story-people-sheet')).toBeVisible();
    await page.getByTestId('story-people-row').first().click();
    await page.getByTestId('story-people-sheet').getByRole('button', { name: /close/i }).click();

    await page.getByTestId('story-compose-add').click();
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();

    // Published as a REAL profile id, never a handle…
    expect(stub.published[0].p_tag_ids).toEqual([CLAIRE_ID]);
    // …and the tag survives the round trip into the viewer, which is what the
    // discarded read path made impossible.
    await page.getByTestId('story-receipt-view').click();
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
    await page.getByTestId('story-compose-add').click();
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();

    await page.getByTestId('story-receipt-view').click();
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
    await page.getByTestId('story-compose-add').click();
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();

    stub.deleteError = { message: 'delete refused' };
    await page.getByTestId('story-receipt-undo').click();

    const failure = page.getByTestId('story-undo-failed');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(/still live/i);
    // The receipt does NOT close on a failed Undo — closing would be the
    // same silent claim in a different costume.
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();
    expect(stub.stories).toHaveLength(1);
  });

  test('a successful Undo removes the story and leaves the branch', async ({ page }) => {
    const stub = await stubStories(page, { following: [CLAIRE] });
    await page.goto('/friends');
    await captureAndApprove(page);
    await page.getByTestId('story-compose-add').click();
    await expect(page.getByTestId('story-shared-receipt')).toBeVisible();
    expect(stub.stories).toHaveLength(1);

    await page.getByTestId('story-receipt-undo').click();
    await expect(page.getByTestId('story-shared-receipt')).toHaveCount(0);
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
    await page.getByTestId('story-compose-add').click();

    // "Shared" is only true when the server took it.
    await expect(page.getByTestId('story-save-failed')).toBeVisible();
    await expect(page.getByTestId('story-save-failed')).toContainText(/Nothing was shared/i);
    await expect(page.getByTestId('story-shared-receipt')).toHaveCount(0);
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
});
