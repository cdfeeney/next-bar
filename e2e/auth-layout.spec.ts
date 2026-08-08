/**
 * auth-layout.spec.ts — Item 5 (g-4e72a0c5): compact /auth layout, VISUAL ONLY.
 *
 * The defect, as MEASURED (an earlier draft of this header asserted a
 * different one and was wrong — see the correction below): `/auth` needed
 * 772px of document height in a 390x664 iPhone 13 viewport, so the sign-in
 * form scrolled on the smallest configured phone, and it asked for its
 * full-height box in `100vh`, which is the LARGE viewport under collapsing
 * mobile browser chrome.
 *
 * CORRECTION, kept deliberately. The first draft blamed a ~64px strip of dead
 * scroll from the `body`'s unconditional
 * `pb-[calc(64px+env(safe-area-inset-bottom))]` nav reserve, and asserted that
 * gap was 64px pre-fix. Direct measurement refuted it: the gap between the
 * bottom of `<main>` and the end of the document was 0.5px BEFORE the change
 * and ~0px after. `<main>` overflows the `body`'s `height:100%` border box
 * rather than stacking after its padding, so that reserve never becomes
 * scrollable space on this route. The assertion built on that story could not
 * fail, and has been removed rather than left as coverage theater.
 * (santa: caught independently by Codex and by the Claude/FABLE lane.)
 *
 * WHAT IS MEASURABLE HERE, AND WHAT IS NOT — stated plainly so nobody reads
 * more assurance out of this file than it contains:
 *
 *   - MEASURABLE (the load-bearing tests): the height the content actually
 *     needs vs the viewport, that nothing is clipped to achieve that fit,
 *     horizontal overflow, that scrolling still works when content genuinely
 *     exceeds the viewport, and that no auth behaviour, copy, or URL moved.
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
  /** True when the form card is taller than the box it was given — i.e. the
   *  page "fits" only because content was clipped. Without this, a card with a
   *  constrained height and hidden overflow would satisfy every other
   *  assertion here while hiding controls. (santa: Codex.) */
  cardClipped: boolean;
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
    return {
      cardClipped: (card as HTMLElement).scrollHeight > (card as HTMLElement).clientHeight + 1,
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

/** Applies to every state, including the ones that legitimately scroll: the
 *  form card must never be taller than the box it renders into. */
function expectNoClipping(g: Geometry): void {
  expect(g.cardClipped, why(g)).toBe(false);
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

test.describe('/auth layout — one-screen fit, no clipping, no horizontal overflow', () => {
  test('signin state fits one screen unclipped', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const g = await geometry(page);
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    // The whole point of the item: the default auth surface is one screen.
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('signup state fits one screen unclipped', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: /create an account/i }).click();
    await expect(
      page.getByRole('heading', { name: /create your account/i }),
    ).toBeVisible();

    const g = await geometry(page);
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('forgot-password state fits one screen unclipped', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: /forgot your password/i }).click();
    await expect(
      page.getByRole('heading', { name: /reset your password/i }),
    ).toBeVisible();

    const g = await geometry(page);
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('reset-sent inbox state fits one screen and keeps its copy', async ({ page }) => {
    await page.route('**/auth/v1/recover**', fulfillJson(200, {}));
    await page.goto('/auth');

    await page.getByRole('button', { name: /forgot your password/i }).click();
    await typeInto(page.getByRole('textbox', { name: /email/i }), 'connor@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
    await expect(page.getByText(/We sent a reset link/i)).toBeVisible();

    const g = await geometry(page);
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    expectFitsOneScreen(g);
    await expectAuthSurfaceIntact(page);
  });

  test('callback-error banner state stays unclipped and scrollable', async ({ page }) => {
    await page.goto('/auth?error=server_error');

    const banner = page.locator('div[role="alert"]').filter({ hasText: /\S/ });
    await expect(banner).toContainText(/didn't complete/i);

    const g = await geometry(page);
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    await expectAuthSurfaceIntact(page);
  });

  test('PKCE-mismatch banner state stays unclipped and keeps its exact guidance', async ({ page }) => {
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
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    await expectAuthSurfaceIntact(page);
  });

  test('short viewport keeps every control reachable by scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const g = await geometry(page);
    expectNoClipping(g);
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
    expectNoClipping(g);
    expectNoHorizontalOverflow(g);
    await expectVerticallyScrollable(page);

    const submit = page.getByRole('button', { name: /^Sign in →$/ });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await expectAuthSurfaceIntact(page);
  });
});

test.describe('/auth layout — declaration pins for what emulation cannot show', () => {
  test('main asks for dvh behind an @supports gate, over a vh fallback', async ({ page }) => {
    await page.goto('/auth');

    // Read DECLARED values out of the CSSOM, and record whether each one sits
    // inside an @supports block. A computed read would return px and could not
    // tell 100dvh from 100vh under emulation; ignoring the @supports nesting
    // would let a bare `min-h-screen min-h-dvh` pair pass, and that pair is
    // exactly what we rejected — it depends on Tailwind's emitted order.
    const declared = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) throw new Error('no <main>');
      const out: { value: string; supports: string | null }[] = [];

      const walk = (rules: CSSRuleList, supports: string | null): void => {
        for (const rule of Array.from(rules)) {
          const supportsRule = rule as CSSSupportsRule;
          if (supportsRule.conditionText !== undefined && supportsRule.cssRules) {
            walk(supportsRule.cssRules, supportsRule.conditionText);
            continue;
          }
          const styleRule = rule as CSSStyleRule;
          if (!styleRule.selectorText || !styleRule.style) continue;
          const value = styleRule.style.getPropertyValue('min-height');
          if (!value) continue;
          try {
            if (main.matches(styleRule.selectorText)) out.push({ value, supports });
          } catch {
            /* unsupported selector text */
          }
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, null);
        } catch {
          continue; // cross-origin sheet
        }
      }
      return out;
    });

    const detail = JSON.stringify(declared);
    // The dvh override exists AND is condition-gated, so its win does not
    // depend on stylesheet order.
    const gatedDvh = declared.filter((d) => d.value.includes('dvh') && d.supports);
    expect(gatedDvh.length, detail).toBeGreaterThan(0);
    expect(gatedDvh.some((d) => d.supports!.includes('dvh')), detail).toBe(true);
    // And an ungated fallback still covers engines that drop `dvh` entirely.
    expect(
      declared.some((d) => !d.supports && /\b100vh\b/.test(d.value)),
      detail,
    ).toBe(true);
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

  test('desktop keeps the pre-compaction spacing at the md breakpoint', async ({ page }) => {
    // The compaction is scoped to phones, so every tightened utility carries an
    // `md:` restoration. Both configured device projects are mobile, so without
    // this test the entire desktop path is implemented and unverified — a
    // regression in any `md:` value would be invisible. (santa: GLM.)
    // Asserted as padding and font-size values rather than element heights,
    // because heights move with the fallback font the network fence forces.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const desktop = await page.evaluate(() => {
      const section = document.querySelector('main section');
      const heading = document.querySelector('main h1');
      const email = document.querySelector('main input[type="email"]');
      const submit = document.querySelector('main button[type="submit"]');
      const px = (el: Element | null, prop: string) =>
        el ? parseFloat(getComputedStyle(el).getPropertyValue(prop)) : NaN;
      return {
        sectionPaddingTop: px(section, 'padding-top'),
        sectionPaddingBottom: px(section, 'padding-bottom'),
        headingFontSize: px(heading, 'font-size'),
        emailPaddingTop: px(email, 'padding-top'),
        submitPaddingTop: px(submit, 'padding-top'),
      };
    });

    // The original pre-item values: py-12, text-5xl, py-4, py-4.
    expect(desktop.sectionPaddingTop).toBe(48);
    expect(desktop.sectionPaddingBottom).toBe(48);
    expect(desktop.headingFontSize).toBe(48);
    expect(desktop.emailPaddingTop).toBe(16);
    expect(desktop.submitPaddingTop).toBe(16);

    // ...and the desktop path must still RESERVE the bottom inset. A flat
    // `md:py-12` computes to the same 48px under emulation (insets are 0) while
    // silently dropping the safe-area term, so the computed value above cannot
    // catch it — only the declaration can. (santa: Kimi.)
    const declaredBottom = await page.evaluate(() => {
      const section = document.querySelector('main section');
      if (!section) throw new Error('no section');
      const out: string[] = [];
      const walk = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
          const grouping = rule as CSSMediaRule;
          if (grouping.cssRules && grouping.conditionText !== undefined) {
            walk(grouping.cssRules);
            continue;
          }
          const styleRule = rule as CSSStyleRule;
          if (!styleRule.selectorText || !styleRule.style) continue;
          const value = styleRule.style.getPropertyValue('padding-bottom');
          if (!value) continue;
          try {
            if (section.matches(styleRule.selectorText)) out.push(value);
          } catch {
            /* unsupported selector text */
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          continue;
        }
      }
      return out;
    });

    const withInset = declaredBottom.filter((v) => v.includes('safe-area-inset-bottom'));
    // Both the mobile base and the md: override must carry the inset.
    expect(withInset.length, JSON.stringify(declaredBottom)).toBeGreaterThanOrEqual(2);
  });

  test('the card stays vertically centred when it has room to be', async ({ page }) => {
    // `m-auto` replaced `items-center`; nothing else asserts that it still
    // CENTRES rather than top-aligns. If the section ever stopped filling
    // main's min-height, the card would silently jump to the top with every
    // other assertion here still green. (santa: GLM.)
    await page.goto('/auth');
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();

    const gaps = await page.evaluate(() => {
      const section = document.querySelector('main section') as HTMLElement;
      const card = section.firstElementChild as HTMLElement;
      const s = section.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const style = getComputedStyle(section);
      return {
        above: c.top - s.top - parseFloat(style.paddingTop),
        below: s.bottom - c.bottom - parseFloat(style.paddingBottom),
      };
    });

    // Genuinely centred: real space on both sides, and symmetric within 2px.
    expect(gaps.above, JSON.stringify(gaps)).toBeGreaterThan(0);
    expect(Math.abs(gaps.above - gaps.below), JSON.stringify(gaps)).toBeLessThanOrEqual(2);
  });

  test('compaction did not summon a bottom nav onto /auth', async ({ page }) => {
    // BottomNav.tsx returns null on /auth precisely because the raised centre
    // pill overlaps the form on phone viewports. A tighter layout must not
    // change that. The `body` bottom reserve it leaves behind never becomes
    // scrollable space on this route — see the CORRECTION in the file header;
    // the assertion that once claimed to cover that was vacuous and is gone,
    // so nothing here should be read as guarding it.
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
    expectNoClipping(g);
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
