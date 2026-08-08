/**
 * auth-layout.spec.ts — Item 5 (g-4e72a0c5): compact /auth layout, VISUAL ONLY.
 *
 * The defect: `/auth` renders `<main class="min-h-screen">` (100vh) inside a
 * `<body>` that unconditionally reserves `64px + env(safe-area-inset-bottom)`
 * for the fixed BottomNav — a nav that `BottomNav.tsx` explicitly returns
 * `null` for on `/auth`. So every auth state carried a ~64px strip of empty,
 * un-navigable scroll below the form, on top of a `100vh` box that is the
 * wrong unit under mobile browser chrome.
 *
 * WHAT IS MEASURABLE HERE, AND WHAT IS NOT — stated plainly so nobody reads
 * more assurance out of this file than it contains:
 *
 *   - MEASURABLE (the load-bearing tests): the dead tail below <main>, total
 *     document height vs viewport, horizontal overflow, that scrolling still
 *     works when content genuinely exceeds the viewport, and that no auth
 *     behaviour, copy, or URL moved.
 *   - NOT MEASURABLE IN PLAYWRIGHT: `100dvh` differs from `100vh` only while
 *     mobile browser chrome is collapsing, and `env(safe-area-inset-*)`
 *     resolves to 0 on every configured project because Playwright emulates
 *     neither. Those two criteria are therefore pinned as CSSOM *declaration*
 *     assertions — they prove the stylesheet asks for the right thing, not
 *     that a notch was observed. An attended device check still owes the
 *     visual confirmation.
 *
 * Every Supabase call is stubbed at `**​/auth/v1/**`; the repo-wide network
 * fence (playwright.config.ts) refuses non-loopback traffic on top of that.
 */

import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

/** Copy constants mirrored from src/lib/authErrors.ts — asserted verbatim so a
 *  layout edit that quietly reworded an auth message fails here. */
const AUTH_COPY = {
  invalidCredentials:
    'Wrong email or password. No password yet? Use "Forgot your password?" below.',
  rateLimitedEmail:
    "Too many emails requested — you've hit the rate limit. Wait about a minute and try again.",
  emailExists: 'That email already has an account — sign in instead.',
} as const;

/** WebKit controlled-input note — see the header of auth-page.spec.ts. */
async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

function fulfillJson(status: number, body: unknown) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  };
}

type Geometry = {
  /** Empty, un-navigable space between the bottom of <main> and the end of
   *  the scrollable document. */
  deadTail: number;
  /**
   * Height the layout actually NEEDS: header + the form card + the section's
   * own gutters. Measured separately from `scrollHeight` on purpose —
   * `min-h-dvh` floors the document at exactly one viewport, so scrollHeight
   * reads 664 on a 664px screen whether the content needs 400px or 664px and
   * cannot, by itself, show how much room is left.
   */
  contentHeight: number;
  scrollHeight: number;
  innerHeight: number;
  scrollWidth: number;
  clientWidth: number;
  scrollX: number;
};

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) throw new Error('no <main> on /auth');
    const header = main.querySelector('header');
    const section = main.querySelector('section');
    const card = section?.firstElementChild;
    if (!header || !section || !card) throw new Error('unexpected /auth structure');

    const sectionStyle = getComputedStyle(section);
    const contentHeight =
      (header as HTMLElement).offsetHeight +
      (card as HTMLElement).offsetHeight +
      parseFloat(sectionStyle.paddingTop) +
      parseFloat(sectionStyle.paddingBottom);

    const doc = document.documentElement;
    const mainBottom = main.getBoundingClientRect().bottom + window.scrollY;
    return {
      deadTail: doc.scrollHeight - mainBottom,
      contentHeight,
      scrollHeight: doc.scrollHeight,
      innerHeight: window.innerHeight,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      scrollX: window.scrollX,
    };
  });
}

/** Every geometry assertion carries the full measurement, so a failure reads
 *  as a diagnosis rather than one orphaned number. */
function why(g: Geometry): string {
  return `geometry: ${JSON.stringify(g)}`;
}

/** Criterion 18, applied to every state. */
function expectNoHorizontalOverflow(g: Geometry): void {
  expect(g.scrollWidth, why(g)).toBe(g.clientWidth);
  expect(g.scrollX, why(g)).toBe(0);
}

/** Criterion 3 — the default form states must not need scrolling at all.
 *  The measurement is annotated on success too: "it fit" is worth far less to
 *  the next reader than "it fit with 32px to spare". */
function expectFitsOneScreen(g: Geometry): void {
  test.info().annotations.push({
    type: 'fits-one-screen',
    description: `content ${Math.round(g.contentHeight)}px in a ${g.innerHeight}px viewport (headroom ${Math.round(g.innerHeight - g.contentHeight)}px)`,
  });
  // Both halves matter: the document must not scroll, AND the reason must be
  // that the content genuinely fits rather than that something clipped it.
  expect(g.scrollHeight, why(g)).toBeLessThanOrEqual(g.innerHeight + 1);
  expect(g.contentHeight, why(g)).toBeLessThanOrEqual(g.innerHeight);
}

/**
 * Criterion 3, stated as an invariant rather than a magic pixel budget: the
 * document may be taller than the viewport when the CONTENT is taller, but it
 * may never end in empty space. Sub-pixel layout rounding gets 2px.
 *
 * Pre-fix this is 64px on both projects (`env(safe-area-inset-bottom)` is 0
 * under emulation), which is what makes this assertion RED before the change.
 */
function expectNoDeadTail(g: Geometry): void {
  expect(g.deadTail, why(g)).toBeLessThanOrEqual(2);
}

/** Criteria 15+17 — the layout work moved neither the URL nor the copy.
 *
 *  The URL check gets a longer settle window than the 10s project default,
 *  and the reason is worth stating so nobody later reads it as slack: the
 *  `?error=` states reach `/auth` only after the client-side
 *  `router.replace('/auth')` in AuthPage's effect completes, and on a cold
 *  dev server shared with other worktrees that client navigation has been
 *  observed to take over 10s. The ASSERTION is unchanged — the URL must still
 *  end at `/auth`; only the patience is longer. */
async function expectAuthSurfaceIntact(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/auth$/, { timeout: 25_000 });
  // "Load failed" is WebKit's raw TypeError text — the exact string the
  // app-owned error module exists to keep off screen.
  await expect(page.getByText(/load failed|failed to fetch/i)).toHaveCount(0);
}

/** Criterion 4 — the page scrolls when content genuinely exceeds the viewport. */
async function expectVerticallyScrollable(page: Page): Promise<void> {
  const before = await geometry(page);
  expect(before.scrollHeight).toBeGreaterThan(before.innerHeight);

  const overflow = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overflowY,
    body: getComputedStyle(document.body).overflowY,
  }));
  expect(overflow.html).not.toBe('hidden');
  expect(overflow.body).not.toBe('hidden');

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => page.evaluate(() => Math.round(window.scrollY)))
    .toBeGreaterThan(0);
}

test.describe('/auth layout — no dead height, no horizontal overflow', () => {
  test('signin state fits one screen with no empty tail', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    // The whole point of the item: the default auth surface is one screen.
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('signup state fits one screen with no empty tail', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();
    await expect(
      page.getByRole('heading', { name: /create your account/i }),
    ).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('forgot-password state fits one screen with no empty tail', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: /forgot your password/i }).click();
    await expect(
      page.getByRole('heading', { name: /reset your password/i }),
    ).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('reset-sent inbox state has no empty tail and keeps its copy', async ({ page }) => {
    await page.route('**/auth/v1/recover**', fulfillJson(200, {}));
    await page.goto('/auth');

    await page.getByRole('button', { name: /forgot your password/i }).click();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText(/We sent a reset link/i)).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('callback-error banner state has no empty tail and stays scrollable', async ({ page }) => {
    await page.goto('/auth?error=server_error');

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toContainText(/didn't complete/i);

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    await expectAuthSurfaceIntact(page);
  });

  test('PKCE-mismatch banner state has no empty tail and keeps its exact guidance', async ({ page }) => {
    await page.goto('/auth?error=pkce_code_verifier_not_found');

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    // The P0 distinction: same-device guidance, NOT "expired".
    await expect(banner).toContainText(
      /Finish on the same device and browser you started from/i,
    );
    await expect(banner).not.toContainText(/expired or was already used/i);
    await expect(
      banner.getByRole('button', { name: /send a new link/i }),
    ).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    await expectAuthSurfaceIntact(page);
  });

  test('short viewport keeps every control reachable by scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    await expectVerticallyScrollable(page);

    // The lowest control must actually be reachable, not merely present.
    const footerNote = page.getByText(/Signed in, your ratings sync across devices/i);
    await footerNote.scrollIntoViewIfNeeded();
    await expect(footerNote).toBeInViewport();
    await expectAuthSurfaceIntact(page);
  });

  test('keyboard-shrunk viewport keeps submit reachable and does not lock scroll', async ({ page }) => {
    await page.goto('/auth');
    // A software keyboard shrinks the visual viewport; Playwright has no
    // keyboard, so shrink the viewport to the same effect while a field is
    // focused. This is the state where a `height:100vh; overflow:hidden`
    // layout traps the submit button off screen.
    await page.getByRole('textbox', { name: /email/i }).click();
    await page.setViewportSize({ width: 390, height: 340 });

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
    await expectVerticallyScrollable(page);

    const submit = page.getByRole('button', { name: /^Sign in →$/ });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await expectAuthSurfaceIntact(page);
  });
});

test.describe('/auth layout — declaration pins for what emulation cannot show', () => {
  test('main asks for dvh, never vh, for its full-height box', async ({ page }) => {
    await page.goto('/auth');

    // Read the DECLARED value out of the CSSOM. A computed read would return
    // px and could not tell 100dvh from 100vh under emulation.
    const declared = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) throw new Error('no <main>');
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRule[];
        try {
          rules = Array.from(sheet.cssRules);
        } catch {
          continue; // cross-origin sheet
        }
        for (const rule of rules) {
          const styleRule = rule as CSSStyleRule;
          if (!styleRule.selectorText || !styleRule.style) continue;
          const value =
            styleRule.style.getPropertyValue('min-height') ||
            styleRule.style.getPropertyValue('height');
          if (!value) continue;
          try {
            if (main.matches(styleRule.selectorText)) out.push(value);
          } catch {
            /* unsupported selector text */
          }
        }
      }
      return out;
    });

    expect(declared.length).toBeGreaterThan(0);
    expect(declared.some((v) => v.includes('dvh'))).toBe(true);
    expect(declared.some((v) => /\b100vh\b/.test(v))).toBe(false);
  });

  test('the auth header reserves the top safe-area inset', async ({ page }) => {
    await page.goto('/auth');

    const declared = await page.evaluate(() => {
      const header = document.querySelector('main header');
      if (!header) throw new Error('no <header> inside <main>');
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRule[];
        try {
          rules = Array.from(sheet.cssRules);
        } catch {
          continue;
        }
        for (const rule of rules) {
          const styleRule = rule as CSSStyleRule;
          if (!styleRule.selectorText || !styleRule.style) continue;
          const value = styleRule.style.getPropertyValue('padding-top');
          if (!value) continue;
          try {
            if (header.matches(styleRule.selectorText)) out.push(value);
          } catch {
            /* unsupported selector text */
          }
        }
      }
      return out;
    });

    expect(declared.some((v) => v.includes('safe-area-inset-top'))).toBe(true);
    // Emulation reports the inset as 0, so the notch-less floor must still be
    // a real gap — a bare `env()` would collapse the header to the text edge.
    const paddingTop = await page.evaluate(() => {
      const header = document.querySelector('main header');
      return parseFloat(getComputedStyle(header as Element).paddingTop);
    });
    expect(paddingTop).toBeGreaterThanOrEqual(8);
  });

  test('compaction did not summon a bottom nav onto /auth', async ({ page }) => {
    // BottomNav.tsx returns null on /auth precisely because the raised centre
    // pill overlaps the form on phone viewports. A tighter layout must not
    // change that, and the `body` bottom reserve it leaves behind must not
    // reappear as scrollable dead space (already covered by expectNoDeadTail).
    await page.goto('/auth');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });
});

test.describe('/auth layout — behaviour is untouched (negative assertions)', () => {
  test('wrong password still renders app-owned copy and does not navigate', async ({ page }) => {
    await page.route(
      '**/auth/v1/token**',
      fulfillJson(400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      }),
    );
    await page.goto('/auth');

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await typeInto(page.getByPlaceholder('Password'), 'wrongpass');
    await page.getByRole('button', { name: /^Sign in →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(AUTH_COPY.invalidCredentials);
    await expectAuthSurfaceIntact(page);

    const g = await geometry(page);
    expectNoDeadTail(g);
    expectNoHorizontalOverflow(g);
  });

  test('rate-limited reset still renders app-owned copy and stays on the form', async ({ page }) => {
    await page.route(
      '**/auth/v1/recover**',
      fulfillJson(429, {
        error: 'over_email_send_rate_limit',
        error_description: 'Rate limit exceeded',
      }),
    );
    await page.goto('/auth');

    await page.getByRole('button', { name: /forgot your password/i }).click();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(AUTH_COPY.rateLimitedEmail);
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
    await expectAuthSurfaceIntact(page);
  });

  test('existing-email signup still flips to sign-in with the owned message', async ({ page }) => {
    await page.route(
      '**/auth/v1/signup**',
      fulfillJson(200, {
        user: { id: 'u1', email: 'taken@example.com', identities: [] },
        session: null,
      }),
    );
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();

    await typeInto(page.getByRole('textbox', { name: /email/i }), 'taken@example.com');
    await typeInto(page.getByPlaceholder(/Choose a password/), 'hunter22');
    await page.getByRole('button', { name: /^Create account →$/ }).click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(AUTH_COPY.emailExists);
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
    await expectAuthSurfaceIntact(page);
  });

  test('tap targets stay at least 44px tall after the compaction', async ({ page }) => {
    await page.goto('/auth');

    const targets = [
      page.getByRole('textbox', { name: /email/i }),
      page.getByPlaceholder('Password'),
      page.getByRole('button', { name: /^Sign in →$/ }),
      page.getByRole('button', { name: /create an account/i }),
      page.getByRole('button', { name: /forgot your password/i }),
    ];

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
