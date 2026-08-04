/**
 * pin-where-i-am.spec.ts — "Pin where I am" (g-31f36bf8, draft 0038).
 *
 * Explicit venue check-in on /friends → Tonight plus the "I'm here"
 * entry on result cards. The tests pin the CLIENT half of the T0
 * contract:
 *
 *   - the outbound payload is a bar id + night key and NOTHING else —
 *     no coordinate/accuracy key ever crosses the wire, even with
 *     geolocation granted (the server-side audience matrix lives in the
 *     draft-0038 SQL and its static guards in migration0038.test.ts);
 *   - pin / move / unpin / reload / failure behavior;
 *   - friends' presence renders name + bar + freshness from whatever
 *     the mutual-only definer returned;
 *   - DENY surfaces never even ask: signed-out /friends, the public
 *     profile page, and the bearer-link share page fire ZERO
 *     get_friend_pins requests and render no pin UI.
 *
 * Same stubbed-Supabase pattern as suggestions.spec.ts — stateful pin
 * stub because the component refetches after every write.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

const USER_ID = '11111111-2222-3333-4444-555555555555';

function readSupabaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
const SUPABASE_URL = readSupabaseUrl();

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sessionCookie(supabaseUrl: string): { name: string; value: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: expiresAt })),
    'e2e-fake-signature',
  ].join('.');
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-fake-refresh',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'connor@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${base64Url(JSON.stringify(session))}`,
  };
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

type PinRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  bar_id: string;
  pinned_at: string;
  /** Stub-side night scoping — the real table is night-keyed too. */
  night: string;
};

const NIGHT_BODY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The client's own night key (NYC 6am rollover), replicated for stub
 * fixtures so rows land on the night the app will actually request. */
function nycNight(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const utcDay = Date.UTC(get('year'), get('month') - 1, get('day'));
  const night = new Date(
    get('hour') % 24 < 6 ? utcDay - 24 * 60 * 60 * 1000 : utcDay,
  );
  return `${night.getUTCFullYear()}-${String(night.getUTCMonth() + 1).padStart(2, '0')}-${String(night.getUTCDate()).padStart(2, '0')}`;
}

/** Keys allowed to cross the wire per write RPC — the payload proof. */
const PIN_ALLOWED_KEYS = ['bar', 'night'];
const UNPIN_ALLOWED_KEYS = ['night'];
const COORD_WORDS = /lat|lng|lon|accuracy|coord|position|geo/i;

type StubOptions = {
  /** Initial pin rows; mutated by pin/unpin. */
  pinRows?: PinRow[];
  /** Force pin_venue to refuse (server-side decline path). */
  pinDeclines?: boolean;
  /** Abort pin_venue at the network layer (offline path). */
  pinAborts?: boolean;
};

type StubHandle = {
  /** Every raw pin_venue / unpin_venue request body, in order. */
  writeBodies: string[];
};

async function stubSupabase(page: Page, opts: StubOptions): Promise<StubHandle> {
  const rows: PinRow[] = opts.pinRows ?? [];
  const writeBodies: string[] = [];

  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  await page.route('**/rest/v1/rpc/get_following**', fulfillJson(200, []));
  await page.route('**/rest/v1/rpc/get_friend_ratings**', fulfillJson(200, []));
  await page.route('**/rest/v1/rpc/get_circle_suggestions**', fulfillJson(200, []));
  await page.route('**/rest/v1/rpc/get_circle_rsvps**', fulfillJson(200, []));

  await page.route('**/rest/v1/rpc/get_friend_pins**', async (route) => {
    // Night-scoped like the real definer: rows from another night are
    // NEVER returned (that's the server-side 6am expiry).
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      night?: string;
    };
    await fulfillJson(
      200,
      rows.filter((r) => r.night === body.night),
    )(route);
  });

  await page.route('**/rest/v1/rpc/pin_venue**', async (route) => {
    const raw = route.request().postData() ?? '{}';
    writeBodies.push(raw);
    if (opts.pinAborts) {
      await route.abort('internetdisconnected');
      return;
    }
    const body = JSON.parse(raw) as { bar?: string; night?: string };
    if (typeof body.night !== 'string' || !NIGHT_BODY_RE.test(body.night)) {
      await route.fulfill({ status: 500, body: 'missing/malformed night scope' });
      return;
    }
    if (opts.pinDeclines) {
      await fulfillJson(200, false)(route);
      return;
    }
    // MOVE semantics: one pin per user/night — replace, never add.
    // Night-scoped like the real (user_id, night) PK: another night's
    // row is untouched (round-3 scoped review, Codex lane).
    const idx = rows.findIndex(
      (r) => r.user_id === USER_ID && r.night === body.night,
    );
    const next: PinRow = {
      user_id: USER_ID,
      handle: 'connor_f',
      display_name: 'Conor F',
      bar_id: body.bar ?? '',
      pinned_at: new Date().toISOString(),
      night: body.night ?? '',
    };
    if (idx !== -1) rows.splice(idx, 1, next);
    else rows.push(next);
    await fulfillJson(200, true)(route);
  });

  await page.route('**/rest/v1/rpc/unpin_venue**', async (route) => {
    const raw = route.request().postData() ?? '{}';
    writeBodies.push(raw);
    const body = JSON.parse(raw) as { night?: string };
    if (typeof body.night !== 'string' || !NIGHT_BODY_RE.test(body.night)) {
      await route.fulfill({ status: 500, body: 'missing/malformed night scope' });
      return;
    }
    const idx = rows.findIndex(
      (r) => r.user_id === USER_ID && r.night === body.night,
    );
    if (idx !== -1) rows.splice(idx, 1);
    await fulfillJson(200, true)(route);
  });

  // The draft-0038 table has NO client grants — any direct table access
  // is a regression; fail it loudly.
  await page.route('**/rest/v1/venue_pins**', async (route) => {
    await route.fulfill({
      status: 500,
      body: 'direct venue_pins table access (all access must use the RPCs)',
    });
  });

  return { writeBodies };
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
  await page.addInitScript(() => {
    window.sessionStorage.setItem('next-bar:onboarding-prompted:v1', '1');
  });
}

const FRIEND_PIN: PinRow = {
  user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  handle: 'claire',
  display_name: 'Claire',
  bar_id: 'attaboy',
  // 25 minutes ago, computed at stub time.
  pinned_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  night: nycNight(),
};

const pinSection = (page: Page) => page.getByTestId('pin-where-i-am');

test.describe('Pin where I am — /friends → Tonight', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
    await signIn(page);
  });

  test('pin flow: picker → confirm names bar/audience/expiry → pinned card; payload is bar id + night ONLY', async ({
    page,
    context,
  }) => {
    // Geolocation GRANTED — the strongest version of the payload proof:
    // coordinates exist on-device, and still never cross the wire.
    await grantGeolocation(context, { latitude: 40.7194, longitude: -73.9902 });
    const stub = await stubSupabase(page, {});
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await expect(sheet).toBeVisible();

    // With permission granted the on-device nearby ranking renders.
    await expect(sheet.getByRole('list', { name: /nearby bars/i })).toBeVisible();

    // Deterministic pick via search (WebKit: click + pressSequentially).
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();

    // Criterion 6: the confirmation names the BAR, the AUDIENCE, and
    // the EXPIRATION.
    const confirm = page.getByRole('alertdialog', { name: /confirm pin/i });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(/share that you're at attaboy/i);
    await expect(confirm).toContainText(/until 6:00 AM/i);
    await expect(confirm).toContainText(/follow each other back/i);
    await confirm.getByRole('button', { name: /pin it/i }).click();

    await expect(pinSection(page)).toContainText(/you're at attaboy/i);
    await expect(pinSection(page)).toContainText(/until 6:00 AM/i);
    // Negative assertion: pinning never navigates.
    await expect(page).toHaveURL(/\/friends$/);

    // THE PAYLOAD PROOF (criterion: outbound contains bar ID, never
    // coordinates). Exact-key check + coordinate-word scan on the raw
    // body, with geolocation granted and a live device fix available.
    expect(stub.writeBodies.length).toBeGreaterThan(0);
    for (const raw of stub.writeBodies) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(PIN_ALLOWED_KEYS);
      expect(parsed.bar).toBe('attaboy');
      expect(raw).not.toMatch(COORD_WORDS);
    }
  });

  test('location denied still works: picker offers search, no nearby list, pin succeeds', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/location is off — search below/i)).toBeVisible();
    await expect(sheet.getByRole('list', { name: /nearby bars/i })).toHaveCount(0);

    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();
    await expect(pinSection(page)).toContainText(/you're at attaboy/i);
  });

  test('MOVE: changing the pin replaces it — one active pin, never two', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await stubSupabase(page, {
      pinRows: [
        {
          user_id: USER_ID,
          handle: 'connor_f',
          display_name: 'Conor F',
          bar_id: 'attaboy',
          pinned_at: new Date().toISOString(),
          night: nycNight(),
        },
      ],
    });
    await page.goto('/friends');

    await expect(pinSection(page)).toContainText(/you're at attaboy/i);
    await pinSection(page).getByRole('button', { name: /^change$/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Death');
    await sheet.getByRole('button', { name: /^Death & Co/ }).first().click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();

    await expect(pinSection(page)).toContainText(/you're at death & co/i);
    // The old pin is GONE (move, not add) — the section shows one card.
    await expect(pinSection(page)).not.toContainText(/you're at attaboy/i);
  });

  test('unpin returns to the entry state; reload shows a stored pin (persistence)', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await stubSupabase(page, {
      pinRows: [
        {
          user_id: USER_ID,
          handle: 'connor_f',
          display_name: 'Conor F',
          bar_id: 'attaboy',
          pinned_at: new Date().toISOString(),
          night: nycNight(),
        },
      ],
    });
    await page.goto('/friends');

    // Reload path: the card is rebuilt from the server read.
    await expect(pinSection(page)).toContainText(/you're at attaboy/i);

    await pinSection(page).getByRole('button', { name: /^unpin$/i }).click();
    await expect(
      pinSection(page).getByRole('button', { name: /pin where i am/i }),
    ).toBeVisible();
    await expect(pinSection(page)).not.toContainText(/you're at/i);
  });

  test('server decline surfaces the failure notice and keeps state honest', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await stubSupabase(page, { pinDeclines: true });
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();

    await expect(page.getByRole('status')).toContainText(/couldn't update your pin/i);
    await expect(pinSection(page)).not.toContainText(/you're at/i);
  });

  test('offline: aborted write shows the offline notice (reduced-motion honored)', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // navigator.onLine=false drives the offline copy branch.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });
    await stubSupabase(page, { pinAborts: true });
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();

    await expect(page.getByRole('status')).toContainText(/you look offline/i);
    await expect(pinSection(page)).not.toContainText(/you're at/i);
  });

  test('keyboard: Escape closes ONLY the top dialog (confirm first, then picker); focus lands on Cancel', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();

    const confirm = page.getByRole('alertdialog', { name: /confirm pin/i });
    await expect(confirm).toBeVisible();
    // House contract: focus lands on the non-destructive action.
    await expect(confirm.getByRole('button', { name: /cancel/i })).toBeFocused();

    // Escape pops the STACK — confirm closes, picker survives…
    await page.keyboard.press('Escape');
    await expect(confirm).not.toBeVisible();
    await expect(sheet).toBeVisible();
    // …and a second Escape closes the picker.
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  test('keyboard: the confirm dialog activates via Enter', async ({ page, context }) => {
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.goto('/friends');

    await pinSection(page).getByRole('button', { name: /pin where i am/i }).click();
    const sheet = page.getByRole('dialog', { name: /pin where i am/i });
    await sheet.getByPlaceholder(/search/i).click();
    await sheet.getByPlaceholder(/search/i).pressSequentially('Attaboy');
    await sheet.getByRole('button', { name: /^Attaboy/ }).first().click();

    const pinIt = page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i });
    await pinIt.focus();
    await page.keyboard.press('Enter');
    await expect(pinSection(page)).toContainText(/you're at attaboy/i);
  });

  test("a friend's pin renders name + bar + freshness", async ({ page, context }) => {
    await denyGeolocation(context);
    await stubSupabase(page, { pinRows: [FRIEND_PIN] });
    await page.goto('/friends');

    const list = page.getByRole('list', { name: /friends out tonight/i });
    await expect(list).toBeVisible();
    const row = list.getByRole('listitem').filter({ hasText: 'Claire' });
    await expect(row).toContainText(/is at/i);
    await expect(row).toContainText('Attaboy');
    await expect(row).toContainText(/\d+ min ago/);
  });
});

test.describe("I'm here — the result-card entry", () => {
  const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00'); // Fri 11pm — bars open

  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  });

  test('signed in: I\'m here → confirm → "Pinned"; payload proof holds; URL unchanged', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await denyGeolocation(context);
    const stub = await stubSupabase(page, {});
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    const imHere = page.getByRole('button', { name: /i'm here at/i }).first();
    await expect(imHere).toBeVisible();
    await imHere.click();

    const confirm = page.getByRole('alertdialog', { name: /confirm pin/i });
    await expect(confirm).toContainText(/until 6:00 AM/i);
    await expect(confirm).toContainText(/follow each other back/i);
    await confirm.getByRole('button', { name: /pin it/i }).click();

    await expect(
      page.getByRole('button', { name: /i'm here at/i }).first(),
    ).toContainText(/pinned/i);
    // Negative: pinning from a result card never navigates.
    await expect(page).toHaveURL(/\/$/);

    expect(stub.writeBodies.length).toBeGreaterThan(0);
    for (const raw of stub.writeBodies) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(PIN_ALLOWED_KEYS);
      expect(raw).not.toMatch(COORD_WORDS);
    }
  });

  test('two cards never both read "Pinned" — the second pin MOVES the first (shared session state)', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    const buttons = page.getByRole('button', { name: /i'm here at/i });
    await expect(buttons.first()).toBeVisible();
    const total = await buttons.count();
    expect(total).toBeGreaterThan(1);

    // Pin card 1.
    await buttons.nth(0).click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();
    await expect(buttons.nth(0)).toContainText(/pinned/i);

    // Pin card 2 — card 1 must revert (one pin per night, moved).
    await buttons.nth(1).click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();
    await expect(buttons.nth(1)).toContainText(/pinned/i);
    await expect(buttons.nth(0)).not.toContainText(/pinned/i);
    // Exactly ONE card reads Pinned.
    await expect(page.getByRole('button', { name: /i'm here at/i }).filter({ hasText: /pinned/i })).toHaveCount(1);
  });

  test('decline from a result card: confirm closes and the failure notice is VISIBLE', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await denyGeolocation(context);
    await stubSupabase(page, { pinDeclines: true });
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    await page.getByRole('button', { name: /i'm here at/i }).first().click();
    const confirm = page.getByRole('alertdialog', { name: /confirm pin/i });
    await confirm.getByRole('button', { name: /pin it/i }).click();

    // The dialog must NOT stay open on failure — it would cover the
    // only explanation of what went wrong.
    await expect(confirm).not.toBeVisible();
    await expect(page.getByText(/couldn't pin — try again/i).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /i'm here at/i }).first(),
    ).not.toContainText(/pinned/i);
  });

  test('an existing pin renders "Pinned" on / WITHOUT visiting /friends first (session seed)', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    // Pin a real rendered card (the stateful stub records the row, as
    // the server would).
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const firstButton = page.getByRole('button', { name: /i'm here at/i }).first();
    const pinnedLabel = await firstButton.getAttribute('aria-label');
    await firstButton.click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();
    await expect(firstButton).toContainText(/pinned/i);

    // RELOAD: fresh JS session, empty in-memory store. The session seed
    // must restore "Pinned" from server truth with NO /friends visit.
    // (Fixed clock + same seed bar → the same deterministic result set.)
    await page.reload();
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    const pinnedButtons = page
      .getByRole('button', { name: /i'm here at/i })
      .filter({ hasText: /pinned/i });
    await expect(pinnedButtons).toHaveCount(1);
    await expect(pinnedButtons.first()).toHaveAttribute(
      'aria-label',
      pinnedLabel ?? '',
    );
  });

  test('the "Pinned" badge clears at the 6:00 AM rollover WITHOUT a reload', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await denyGeolocation(context);
    await stubSupabase(page, {});
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const firstButton = page
      .getByRole('button', { name: /i'm here at/i })
      .first();
    await firstButton.click();
    await page
      .getByRole('alertdialog', { name: /confirm pin/i })
      .getByRole('button', { name: /pin it/i })
      .click();
    await expect(firstButton).toContainText(/pinned/i);

    // Cross 6am NYC: move the fixed clock past the rollover and fire
    // the shared "clock moved" signal (visibilitychange) that
    // useNightRefresh listens to. The confirm promised "until 6:00 AM"
    // — the badge must clear with NO navigation and NO reload.
    await page.clock.setFixedTime(new Date('2026-07-25T06:05:00'));
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(firstButton).not.toContainText(/pinned/i);
    await expect(firstButton).toContainText(/i'm here/i);
  });

  test('signed out: result cards carry NO "I\'m here" control', async ({
    page,
    context,
  }) => {
    await denyGeolocation(context);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /i'm here/i })).toHaveCount(0);
  });
});

test.describe('Pin where I am — deny surfaces never even ask', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(SUPABASE_URL === null, 'NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  });

  for (const [label, path_] of [
    ['signed-out /friends', '/friends'],
    ['public profile /u/[handle]', '/u/claire'],
    ['bearer share link /share/[barId]', '/share/attaboy'],
  ] as const) {
    test(`${label}: zero pin requests, zero pin UI`, async ({ page }) => {
      const pinRequests: string[] = [];
      page.on('request', (req) => {
        if (/get_friend_pins|pin_venue|unpin_venue|venue_pins/.test(req.url())) {
          pinRequests.push(req.url());
        }
      });
      // Benign generic stubs, signed OUT (no auth cookie).
      await page.route('**/rest/v1/**', fulfillJson(200, []));
      await page.route('**/auth/v1/**', fulfillJson(200, {}));

      await page.goto(path_);
      // Let the page settle enough that any eager fetch would have fired.
      await page.waitForLoadState('networkidle');

      expect(pinRequests).toEqual([]);
      await expect(page.getByTestId('pin-where-i-am')).toHaveCount(0);
      await expect(page.getByText(/pin where i am/i)).toHaveCount(0);
    });
  }
});
