/**
 * add-story.spec.ts
 *
 * Add to Story and the capture pipeline — V8-1f criteria 8, 9 and 10, against
 * `docs/design-reference/approved/next-bar-add-story-flow.png` and
 * `next-bar-camera-modes.png`.
 *
 * WHY THE CAMERA IS STUBBED. The suite runs on iPhone 13 (WebKit) and Pixel 7
 * (Chromium), and Chromium's fake-device launch flags have no WebKit
 * equivalent — a spec that relied on them would assert one thing on one
 * viewport and something else on the other, which CLAUDE.md forbids. Replacing
 * `getUserMedia` in an init script is identical in both engines, so the
 * permission-denied and no-device paths are exercised the same way everywhere,
 * and the successful capture is driven through the library mode, whose file
 * input behaves identically in both.
 */

import { test, expect, type Page } from '@playwright/test';

/** A 1x1 PNG — the smallest thing the library row can legitimately return. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Deny the camera the way a real refusal does, in both engines. */
async function denyCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: Object.assign(media, {
        getUserMedia: () => {
          const error = new Error('denied');
          error.name = 'NotAllowedError';
          return Promise.reject(error);
        },
      }),
    });
  });
}

async function openAddStory(page: Page): Promise<void> {
  await page.goto('/friends');
  await page.getByTestId('add-story').click();
  await expect(page.getByTestId('capture-modes')).toBeVisible();
}

test.describe('Add to Story — the plus-badge entry branch', () => {
  test('the plus opens the approved capture chooser, with all three modes', async ({
    page,
  }) => {
    await openAddStory(page);

    const sheet = page.getByTestId('capture-modes');
    await expect(sheet).toContainText('Add to your story');
    await expect(page.getByTestId('capture-mode-single')).toHaveText(/Take one photo/);
    await expect(page.getByTestId('capture-mode-dual')).toHaveText(/Front \+ back/);
    await expect(page.getByTestId('capture-mode-library')).toHaveText(
      /Choose from library/,
    );
    await expect(sheet).toContainText(
      /Nothing is shared until you review it and pick an audience/i,
    );

    // No destination picker in this branch: the destination is known.
    await expect(page.getByText(/Choose where to share/i)).toHaveCount(0);
  });

  test('the library mode runs the whole five-screen branch to the Shared receipt', async ({
    page,
  }) => {
    await openAddStory(page);

    // Screen 2 → 3: a library photo takes the same hard review gate.
    await page.getByTestId('capture-library-input').setInputFiles({
      name: 'night.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    const review = page.getByTestId('capture-review');
    await expect(review).toBeVisible();
    await expect(review).toContainText(/Draft — not shared/);
    await expect(page.getByTestId('capture-retake')).toBeVisible();

    // Screen 4: compose carries Bar and People only — no destination row.
    await page.getByTestId('capture-approve').click();
    const compose = page.getByTestId('story-compose');
    await expect(compose).toBeVisible();
    await expect(page.getByTestId('story-compose-bar')).toBeVisible();
    await expect(page.getByTestId('story-compose-people')).toBeVisible();
    await expect(compose.getByText(/Choose where to share/i)).toHaveCount(0);

    // Tagging someone is a story-local edit.
    await page.getByTestId('story-compose-people').click();
    await page
      .locator('[data-testid="story-people-row"][data-handle="dev"]')
      .click();
    await page.getByTestId('story-people-sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('story-compose-people')).toContainText('Dev');

    // Screen 5: audience resolves at action time and overrides this post only.
    await page.getByTestId('story-compose-audience').click();
    const audience = page.getByTestId('story-audience-sheet');
    await expect(page.getByTestId('story-audience-option')).toHaveCount(3);
    await expect(audience).toContainText(
      /Applies to this story only\. Your Account default stays Friends\./,
    );
    await page
      .locator('[data-testid="story-audience-option"][data-value="groups"]')
      .click();
    await page.getByTestId('story-audience-done').click();
    await expect(page.getByTestId('story-compose-audience')).toContainText(
      'Selected groups',
    );

    // Screen 6: the locked receipt, two actions, ✕ exits.
    await page.getByTestId('story-compose-add').click();
    const receipt = page.getByTestId('story-shared-receipt');
    await expect(receipt).toContainText('Added to your story.');
    await expect(receipt).toContainText(/Live for 24 hours/);
    await expect(page.getByTestId('story-receipt-view')).toBeVisible();
    await expect(page.getByTestId('story-receipt-undo')).toBeVisible();

    // The ring is live, and the plus is still there — adding is never hidden
    // behind viewing.
    await page.getByTestId('story-receipt-close').click();
    await expect(page.getByTestId('story-rail-your-story')).toBeVisible();
    await expect(page.getByTestId('add-story')).toBeVisible();
  });

  test('Undo takes the moment back off your story', async ({ page }) => {
    await openAddStory(page);
    await page.getByTestId('capture-library-input').setInputFiles({
      name: 'night.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await page.getByTestId('capture-approve').click();
    await page.getByTestId('story-compose-add').click();
    await page.getByTestId('story-receipt-undo').click();

    await expect(page.getByTestId('story-shared-receipt')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-your-story')).toHaveCount(0);
    await expect(page.getByTestId('add-story')).toBeVisible();
  });

  test('Retake discards the frame and reopens the chooser', async ({ page }) => {
    await openAddStory(page);
    await page.getByTestId('capture-library-input').setInputFiles({
      name: 'night.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await expect(page.getByTestId('capture-review')).toBeVisible();

    await page.getByTestId('capture-retake').click();
    await expect(page.getByTestId('capture-review')).toHaveCount(0);
    await expect(page.getByTestId('capture-modes')).toBeVisible();
    // Nothing reached compose, so nothing could have been shared.
    await expect(page.getByTestId('story-compose')).toHaveCount(0);
  });
});

test.describe('The capture pipeline — modes and permission', () => {
  test('the single-photo mode opens a viewfinder and captures nothing on entry', async ({
    page,
  }) => {
    await denyCamera(page);
    await openAddStory(page);

    await page.getByTestId('capture-mode-single').click();
    const stage = page.getByTestId('camera-stage');
    await expect(stage).toBeVisible();
    await expect(page.getByTestId('camera-preview')).toBeVisible();
    // Entering the camera creates no draft and no review screen.
    await expect(page.getByTestId('capture-review')).toHaveCount(0);
  });

  test('a denied camera is a rendered state with a working way forward', async ({
    page,
  }) => {
    await denyCamera(page);
    await openAddStory(page);
    await page.getByTestId('capture-mode-single').click();

    const stage = page.getByTestId('camera-stage');
    await expect(stage).toHaveAttribute('data-camera-status', 'denied');
    await expect(page.getByTestId('camera-notice')).toContainText(/Camera access is off/i);
    // The shutter cannot fabricate a frame while there is no stream. It is
    // `aria-disabled`, not `disabled` (a disabled button drops focus to
    // <body>, which this repo's overlays specifically avoid), so the press
    // is forced past Playwright's enabled check to prove the GUARD holds
    // rather than merely that the attribute is present.
    await expect(page.getByTestId('camera-shutter')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByTestId('camera-shutter').click({ force: true });
    await expect(page.getByTestId('capture-review')).toHaveCount(0);

    // The library is the documented way out of a denial.
    await expect(page.getByTestId('camera-use-library')).toBeVisible();
    await expect(page.getByTestId('camera-retry')).toBeVisible();
  });

  test('the front+back mode explains its two counted steps before the camera opens', async ({
    page,
  }) => {
    await denyCamera(page);
    await openAddStory(page);
    await page.getByTestId('capture-mode-dual').click();

    const explainer = page.getByTestId('capture-dual-explainer');
    await expect(explainer).toBeVisible();
    await expect(explainer.getByRole('listitem')).toHaveCount(3);
    await expect(explainer).toContainText(/Outward photo/);
    await expect(explainer).toContainText(/Selfie/);
    await expect(explainer).toContainText(/You approve both/);

    // Step 1 of 2 is labelled on the camera itself.
    await page.getByTestId('capture-dual-start').click();
    await expect(page.getByTestId('camera-step')).toHaveText(/1 of 2 · Outward/);
  });

  test('the dual mode can fall back to one photo without leaving the flow', async ({
    page,
  }) => {
    await denyCamera(page);
    await openAddStory(page);
    await page.getByTestId('capture-mode-dual').click();
    await page.getByTestId('capture-dual-single-instead').click();

    await expect(page.getByTestId('camera-stage')).toBeVisible();
    await expect(page.getByTestId('camera-step')).toHaveCount(0);
  });

  test('there is one camera system: the global share path is untouched', async ({
    page,
  }) => {
    // The share-a-moment entry points that existed before this lane still
    // behave exactly as their own specs assert; what this checks is that Add
    // to Story did not grow a second chooser alongside them.
    await openAddStory(page);
    await expect(page.getByTestId('capture-modes')).toHaveCount(1);
    await page.getByTestId('capture-cancel').click();
    await expect(page.getByTestId('capture-modes')).toHaveCount(0);
    await expect(page.getByTestId('stories-rail')).toBeVisible();
  });
});
