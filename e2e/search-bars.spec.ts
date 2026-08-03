/**
 * search-bars.spec.ts (goal g-7b6021a8)
 *
 * /search — find any catalog bar and save it to Want to Go. Covers the
 * acceptance battery: exact name, partial name, neighborhood, no-match
 * recovery, open result (BarLightbox), add/remove Want to Go, reload
 * persistence, and cross-surface synchronization (search row toggle ↔
 * lightbox toggle ↔ /rankings Want-to-go tab).
 *
 * The catalog swap (CatalogRefresh) remounts result rows mid-run if you
 * interact across it — same hazard map-lightbox documents — so every
 * test waits for the data-catalog-swapped commit marker first.
 */

import { test, expect, type Page } from '@playwright/test';

const WANT_KEY = 'next-bar:list:want-to-go:v1';

async function openSearch(page: Page): Promise<void> {
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Search bars' })).toBeVisible();
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.dataset.catalogSwapped),
      { timeout: 20_000 },
    )
    .toBe('1');
}

async function clearWantToGo(page: Page): Promise<void> {
  // Saves live in the lists store now (g-ac3a291c facade); the legacy key
  // may also hold pre-fold seeds — clear the reserved list AND the key.
  await page.evaluate((key) => {
    window.localStorage.removeItem(key);
    try {
      const raw = window.localStorage.getItem('next-bar:lists:v1');
      if (!raw) return;
      const lists = JSON.parse(raw) as Array<{ id: string }>;
      window.localStorage.setItem(
        'next-bar:lists:v1',
        JSON.stringify(lists.filter((l) => l.id !== 'want-to-go')),
      );
    } catch {
      // corrupt lists store — leave it; the app's tolerant read handles it
    }
  }, WANT_KEY);
}

/** Read the saved bar ids from where they now live (the lists store). */
async function readWantIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('next-bar:lists:v1');
      if (!raw) return [];
      const lists = JSON.parse(raw) as Array<{ id: string; barIds: string[] }>;
      const wtg = lists.find((l) => l.id === 'want-to-go');
      return wtg ? wtg.barIds : [];
    } catch {
      return [];
    }
  });
}

const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search bars' });

test.describe('/search finds catalog bars', () => {
  test('exact name search finds the bar', async ({ page }) => {
    await openSearch(page);
    await searchBox(page).fill('Attaboy');
    const results = page.getByTestId('search-results');
    await expect(results.getByRole('button', { name: /^Attaboy/ })).toBeVisible();
  });

  test('partial name search finds the bar', async ({ page }) => {
    await openSearch(page);
    await searchBox(page).fill('attab');
    await expect(
      page.getByTestId('search-results').getByRole('button', { name: /^Attaboy/ }),
    ).toBeVisible();
  });

  test('neighborhood search returns bars from that neighborhood', async ({ page }) => {
    await openSearch(page);
    await searchBox(page).fill('Lower East Side');
    const results = page.getByTestId('search-results');
    await expect(results.getByRole('listitem').first()).toBeVisible();
    // Every rendered row carries the spelled-out neighborhood meta.
    const metas = await results.getByRole('listitem').allInnerTexts();
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) {
      // toUpperCase: the meta row renders with CSS `uppercase`, and
      // innerText reflects the transform.
      expect(meta.toUpperCase()).toContain('LOWER EAST SIDE');
    }
  });

  test('no-match state offers recovery, and Clear search restores the hint', async ({
    page,
  }) => {
    await openSearch(page);
    await searchBox(page).fill('zzzz definitely not a bar');
    await expect(page.getByTestId('search-no-match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('search-hint')).toBeVisible();
    await expect(searchBox(page)).toHaveValue('');
    // Recovery is real: a new query works after clearing.
    await searchBox(page).fill('Attaboy');
    await expect(
      page.getByTestId('search-results').getByRole('button', { name: /^Attaboy/ }),
    ).toBeVisible();
  });

  test('selecting a result opens the existing bar-detail lightbox without navigating', async ({
    page,
  }) => {
    await openSearch(page);
    await searchBox(page).fill('Attaboy');
    const urlBefore = page.url();
    await page
      .getByTestId('search-results')
      .getByRole('button', { name: /^Attaboy/ })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Attaboy' })).toBeVisible();
    // NEGATIVE: detail is a dialog, not a navigation.
    expect(page.url()).toBe(urlBefore);
    // Escape closes it and search state survives.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(searchBox(page)).toHaveValue('Attaboy');
  });

  test('catalog swap landing while the lightbox is open steals neither focus nor scroll lock', async ({
    page,
  }) => {
    // Regression test for the round-3 BarLightbox fix: the async catalog
    // swap replaces every Bar's object identity (ids survive), and the
    // dialog-lifecycle effect keyed on the OBJECT re-ran on open dialogs,
    // yanking focus back to ✕ mid-interaction. Deterministic reproduction:
    // hold the bars fetch, open the lightbox from the static catalog, focus
    // an inner control, then release the fetch and let the swap land.
    let releaseBars: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseBars = resolve;
    });
    await page.route('**/rest/v1/bars*', async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search bars' })).toBeVisible();
    // This test cannot use openSearch (its marker wait would deadlock on the
    // gated fetch), so the fill races hydration — React resets the
    // controlled input if we type too early (same race lists-flow
    // documents). Re-filling until results render is the deterministic
    // recovery: once hydration is done, one fill sticks.
    await expect(async () => {
      await searchBox(page).fill('Attaboy');
      await expect(
        page.getByTestId('search-results').getByRole('button', { name: /^Attaboy/ }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await page
      .getByTestId('search-results')
      .getByRole('button', { name: /^Attaboy/ })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const toggle = dialog.getByRole('button', { name: /Attaboy .*Want to go/ });
    // preventScroll is load-bearing twice over: (a) a plain focus() scrolls
    // the toggle into view, and ANY scrolled element makes deferUntilSafe
    // hold the swap until an unscrolled moment — the deferral would mask
    // the very regression under test; (b) it emulates the reachable real
    // case (viewport where the dialog fits, focus moves without scroll).
    await toggle.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
    await expect(toggle).toBeFocused();

    releaseBars();
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.dataset.catalogSwapped),
        { timeout: 20_000 },
      )
      .toBe('1');

    // NEGATIVE: the swap must not move focus, close the dialog, or unlock
    // background scroll.
    await expect(toggle).toBeFocused();
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  });
});

test.describe('/search saves to Want to Go', () => {
  test('row toggle saves; lightbox toggle reflects it immediately (mounted-consumer sync)', async ({
    page,
  }) => {
    await openSearch(page);
    await clearWantToGo(page);
    await searchBox(page).fill('Attaboy');

    const save = page.getByRole('button', { name: 'Save Attaboy to Want to go' });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(
      page.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Open the detail lightbox — its own (separately mounted) toggle must
    // already show saved, via the shared storage-event sync.
    await page
      .getByTestId('search-results')
      .getByRole('button', { name: /^Attaboy/ })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Unsave INSIDE the lightbox; the row toggle behind it must flip too.
    await dialog.getByRole('button', { name: 'Remove Attaboy from Want to go' }).click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Save Attaboy to Want to go' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('a save persists across reload and appears on the /rankings Want-to-go tab', async ({
    page,
  }) => {
    await openSearch(page);
    await clearWantToGo(page);
    await searchBox(page).fill('Attaboy');
    await page.getByRole('button', { name: 'Save Attaboy to Want to go' }).click();

    // Persistence across reload on /search itself.
    await page.reload();
    // Same 45s readiness margin as openSearch — see the comment there.
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.dataset.catalogSwapped),
        { timeout: 45_000 },
      )
      .toBe('1');
    await searchBox(page).fill('Attaboy');
    await expect(
      page.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // The saved bar is on the Rankings → Want to go tab.
    await page.goto('/rankings');
    await page.getByRole('button', { name: /Lists — showing/ }).click();
    await page.getByRole('button', { name: 'Want to go', exact: true }).click();
    const list = page.getByTestId('want-to-go-list');
    await expect(list.getByRole('heading', { name: 'Attaboy' })).toBeVisible();

    // Removing THERE is reflected back on /search after revisit.
    await page.getByRole('button', { name: 'Remove Attaboy from Want to go' }).click();
    await expect(page.getByTestId('want-to-go-empty')).toBeVisible();
    // openSearch, not a bare goto: filling before hydration lets React
    // reset the controlled input (same race lists-flow documents).
    await openSearch(page);
    await searchBox(page).fill('Attaboy');
    await expect(
      page.getByRole('button', { name: 'Save Attaboy to Want to go' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('corrupt legacy Want-to-Go storage does not break search or saving', async ({
    page,
  }) => {
    await openSearch(page);
    await page.evaluate((key) => {
      window.localStorage.setItem(key, '{not json[');
    }, WANT_KEY);
    await page.reload();
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.dataset.catalogSwapped),
        { timeout: 20_000 },
      )
      .toBe('1');
    await searchBox(page).fill('Attaboy');
    const save = page.getByRole('button', { name: 'Save Attaboy to Want to go' });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(
      page.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Want-to-go empty state links to /search', async ({ page }) => {
    await page.goto('/rankings');
    await page.evaluate((key) => window.localStorage.removeItem(key), WANT_KEY);
    await page.reload();
    await page.getByRole('button', { name: /Lists — showing/ }).click();
    await page.getByRole('button', { name: 'Want to go', exact: true }).click();
    await page.getByRole('link', { name: /Find bars to add/ }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole('heading', { name: 'Search bars' })).toBeVisible();
  });

  // ("/rankings header links to /search" was removed with the header link
  // itself — /rankings now hosts its OWN inline search-to-rank bar, and
  // /search stays reachable via the Want-to-go empty state above.)

  test('save is reflected on /rankings via client-side nav — no reload needed', async ({
    page,
  }) => {
    await openSearch(page);
    await clearWantToGo(page);
    await searchBox(page).fill('Attaboy');
    await page.getByRole('button', { name: 'Save Attaboy to Want to go' }).click();
    // Storage holds exactly ONE entry — dedup pinned at the storage level
    // (santa: Codex/GLM). Reads the lists store, where saves now live.
    const wantIds = await readWantIds(page);
    expect(wantIds.filter((id) => id === 'attaboy')).toHaveLength(1);
    // Client-side tab switch (no reload) — the freshly mounted consumer
    // must see the save immediately.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Rankings' }).click();
    // URL barrier BEFORE touching any control: getByRole name-matching is
    // SUBSTRING by default, and during the route transition the /search
    // row toggle ("Remove Attaboy from Want to go") is still mounted and
    // matches { name: 'Want to go' } — activating it was PROVEN (storage
    // mutation trace) to delete the very save under test. exact: true +
    // the barrier makes mis-targeting impossible.
    await expect(page).toHaveURL(/\/rankings$/);
    // The Lists switcher replaced the chip row (g-ac3a291c): open it, pick
    // Want to go, and confirm via the switcher's own label. Retry: right
    // after a client-side navigation the page can remount (dev
    // double-mount) and drop the first activation.
    await expect(async () => {
      await page.getByRole('button', { name: /Lists — showing/ }).click();
      await page
        .getByRole('button', { name: 'Want to go', exact: true })
        .click({ timeout: 1_500 });
      await expect(
        page.getByRole('button', { name: 'Lists — showing Want to go' }),
      ).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    // Split diagnosis: storage must STILL hold the save at this point —
    // separates "persistence lost" from "render lookup failed".
    const wantIdsAfterNav = await readWantIds(page);
    expect(
      wantIdsAfterNav.includes('attaboy'),
      'save vanished from storage after client-side nav',
    ).toBe(true);
    await expect(
      page.getByTestId('want-to-go-list').getByRole('heading', { name: 'Attaboy' }),
    ).toBeVisible();
  });
});

test.describe('/search quality gates', () => {
  test('typing and searching makes NO remote requests and never touches geolocation', async ({
    page,
  }) => {
    // Spy geolocation before any app code runs.
    await page.addInitScript(() => {
      (window as unknown as { __geoCalls: number }).__geoCalls = 0;
      const bump = () => {
        (window as unknown as { __geoCalls: number }).__geoCalls += 1;
      };
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition = bump;
        navigator.geolocation.watchPosition = (() => {
          bump();
          return 0;
        }) as typeof navigator.geolocation.watchPosition;
      }
    });
    await openSearch(page);
    // Count every request that leaves localhost from now on.
    const remote: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        remote.push(req.url());
      }
    });
    await searchBox(page).pressSequentially('attaboy', { delay: 40 });
    await expect(
      page.getByTestId('search-results').getByRole('button', { name: /^Attaboy/ }),
    ).toBeVisible();
    expect(remote, `remote requests during search: ${remote.join(', ')}`).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls),
    ).toBe(0);
  });

  test('device-only sync limitation is disclosed on the surface', async ({ page }) => {
    await page.goto('/search');
    await expect(
      page.getByText(/Saves stay on this device — cross-device sync isn't available yet/),
    ).toBeVisible();
  });

  test('keyboard-only: Enter activates the save toggle, Escape returns focus to the opener row', async ({
    page,
  }) => {
    await openSearch(page);
    await clearWantToGo(page);
    await searchBox(page).fill('Attaboy');
    const save = page.getByRole('button', { name: 'Save Attaboy to Want to go' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Remove Attaboy from Want to go' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Open the detail WITH THE KEYBOARD (this is the keyboard-only test:
    // WebKit doesn't focus buttons on mouse click, so a click-opened
    // dialog legitimately restores focus elsewhere). Focus + Enter makes
    // the row the captured opener in every engine.
    const row = page
      .getByTestId('search-results')
      .getByRole('button', { name: /^Attaboy/ });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(row).toBeFocused();
  });

  test('results and controls clear the fixed BottomNav — tappable, not painted over', async ({
    page,
  }) => {
    await openSearch(page);
    // 'bar' matches broadly → guarantees a full 30-row list, the worst case
    // for the last row vs the fixed nav.
    await searchBox(page).fill('bar');
    const rows = page.getByTestId('search-results').getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const navBox = (await nav.boundingBox())!;

    const lastToggle = rows.last().getByRole('button', { name: /Want to go$/ });
    await lastToggle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350); // smooth-scroll settle (html scroll-behavior)
    const box = (await lastToggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const disjoint =
      box.y + box.height <= navBox.y ||
      box.y >= navBox.y + navBox.height ||
      box.x + box.width <= navBox.x ||
      box.x >= navBox.x + navBox.width;
    expect(disjoint, 'last save toggle rect intersects BottomNav').toBe(true);
    const tappable = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-testid="search-results"] li');
      const last = els[els.length - 1];
      const btn = last?.querySelector('button[aria-pressed]');
      if (!(btn instanceof HTMLElement)) return false;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return btn === hit || btn.contains(hit);
    });
    expect(tappable, 'last save toggle not tappable (painted over)').toBe(true);
  });
});
