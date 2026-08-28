/**
 * groups.spec.ts — Social · Groups (V8-R-NAV-003, V8-R-GRP-001 … 008).
 *
 * WHAT THIS FILE CAN PROVE, AND WHAT IT DELIBERATELY DOES NOT CLAIM.
 *
 * The gate runs SIGNED OUT. A group is server state with no demo analogue —
 * there is no seeded group, by design — so the authenticated thread, the
 * administration verbs and the reporter's hide CANNOT be exercised here, and
 * asserting them against a signed-out browser would be asserting nothing.
 *
 * What a signed-out browser CAN settle is the half that has silently regressed
 * in this product before, and it is not a small half:
 *
 *   1. The Groups & People control still opens the relationship surface
 *      (V8-R-NAV-003) and Groups is ON it — the surface every group action is
 *      reached through.
 *   2. Signed out, Groups states the truth and offers sign-in, rather than
 *      showing an invented group. Social's Feed shipped a demo reel to
 *      signed-out visitors once; that is the regression this asserts against.
 *   3. THE NEGATIVE ASSERTIONS, which is where this file earns its place.
 *      CLAUDE.md: "every button or control that does something user-visible
 *      gets an e2e assertion on the resulting state — including the NEGATIVE
 *      state." No composer, no create control, no thread and no administrative
 *      control may render without a session. Each of those leaking would be a
 *      control that calls a server verb the caller cannot possibly satisfy.
 *   4. Groups adds no rating surface to Social, and no Hide control anywhere —
 *      the two standing V8 product boundaries in CLAUDE.md that a new
 *      message-shaped surface is most likely to violate.
 *
 * THE SERVER RULES ARE PROVEN IN THE DATABASE, NOT HERE. Membership, the single
 * administrator and D-C-38 succession, the mutual-friend restriction on adding,
 * sender-or-administrator deletion, the block, and the reporter's hide are all
 * enforced by SECURITY DEFINER functions and RLS in
 * `supabase/migrations/0067_groups.sql`; `authenticated` holds no INSERT, UPDATE
 * or DELETE grant on any of the four tables, so there is no client path that
 * could bypass them. Exercising them needs two accounts and a live database —
 * the attended staging verification, which this lane is explicitly forbidden to
 * run. Both viewports, per the project rule.
 */

import { test, expect } from '@playwright/test';

test.describe('Social · Groups', () => {
  test('the Groups & People control reveals the relationship surface', async ({
    page,
  }) => {
    await page.goto('/friends');

    // V8-R-NAV-003 — one control in the Social header, 44px, and it leads to
    // the people surface rather than to Settings.
    const control = page.getByRole('button', { name: /groups & people/i });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await control.click();

    // It selects Tonight first: the section it targets belongs to that sub-tab.
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await expect(page.locator('#groups-and-people')).toBeVisible();
  });

  test('Groups is part of that surface and states the truth when signed out', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    const heading = page.getByRole('heading', { name: /^groups$/i });
    await expect(heading).toBeVisible();

    // No invented group, and the one action that changes that.
    const signedOut = page.getByTestId('groups-signed-out');
    await expect(signedOut).toBeVisible();
    await expect(page.getByTestId('groups-sign-in')).toHaveAttribute('href', '/auth');
  });

  test('signed out, no group control that needs a session renders', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    // THE NEGATIVE STATE. Each of these calls a server verb that requires a
    // session and a membership; rendering one signed out would be a control
    // that can only fail.
    await expect(page.getByTestId('group-list')).toHaveCount(0);
    await expect(page.getByTestId('group-create')).toHaveCount(0);
    await expect(page.getByTestId('group-name')).toHaveCount(0);
    await expect(page.getByTestId('group-thread')).toHaveCount(0);
    await expect(page.getByTestId('group-composer')).toHaveCount(0);
    await expect(page.getByTestId('group-send')).toHaveCount(0);
    await expect(page.getByTestId('group-photo')).toHaveCount(0);
    await expect(page.getByTestId('group-admin')).toHaveCount(0);
    await expect(page.getByTestId('group-leave')).toHaveCount(0);
    await expect(page.getByTestId('group-invite')).toHaveCount(0);
    await expect(page.getByTestId('group-unread')).toHaveCount(0);
  });

  test('tapping sign-in from Groups goes to /auth and nowhere else', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await page.getByTestId('groups-sign-in').click();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test('Groups introduces no rating surface and no Hide control', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    const surface = page.locator('#groups-and-people');

    // CLAUDE.md: "Next Bar? displays five ranked bars but never collects a
    // rating" and "There is no Hide or 'never show me this again' control in
    // V8." A message-shaped surface is exactly where one tends to reappear.
    await expect(surface).not.toContainText(/\bhide\b/i);
    await expect(surface).not.toContainText(/never show me this again/i);
    await expect(surface.getByRole('button', { name: /^rate$/i })).toHaveCount(0);
  });

  test('the five-tab bottom nav is untouched by the Groups surface', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    // Groups is a SECTION of Social, not a sixth tab. CLAUDE.md pins the
    // five-tab contract, and a new surface is the usual way it grows a sixth.
    const nav = page.getByRole('navigation').last();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(5);
  });
});

/**
 * SIGNED-IN GROUPS — the authenticated receipts round 1 found missing.
 *
 * The round-1 panel was right that this file proved nothing about GRP-001..008 with a session,
 * and that the mandated acceptance receipts therefore did not exist. What it could not settle is
 * HOW to fix that, and the header above states the old answer: "needs two accounts and a live
 * database — the attended staging verification, which this lane is explicitly forbidden to run."
 *
 * That answer is half right, and the Stories lane already demonstrated which half. An
 * authorization RULE (who may rename, who may delete, succession, the block) is the DATABASE's
 * decision and cannot be honestly stubbed — those stay in the live suite this lane must not run,
 * and nothing below claims them. But a SESSION and a TRANSPORT are stubbable, and every
 * requirement in this lane also has a client half — what the group surface renders, which
 * controls appear for whom, and what it says when a server verb refuses. That half has no
 * coverage at all today, and it is the half that regresses silently.
 *
 * So: a stubbed auth cookie plus intercepted PostgREST/RPC routes. NO DATABASE IS TOUCHED and no
 * row is written anywhere — every response below is fulfilled by Playwright.
 *
 * WHAT THESE RECEIPTS ARE NOT. They do not prove the SQL is correct. `0067_groups.sql`'s
 * membership gates, single-administrator invariant, D-C-38 succession and the reporter's hide are
 * proven — when they are proven — against an applied schema by the attended staging run. The
 * static shape of the succession lock, the destination retirement and the invitation notification
 * is pinned in `src/lib/groups.server.test.ts`, which runs in this gate.
 *
 * NOT EXECUTED IN THIS ENVIRONMENT — READ THIS BEFORE TREATING ANY OF IT AS A RECEIPT.
 *
 * Playwright cannot run on the attended driver machine for this lane: there is no dev server and
 * the pre-build the e2e gate needs exceeds its budget on a changed tree. Round 3 nevertheless
 * added assertions here and called a coverage finding closed. BOTH review lanes then found them
 * DETERMINISTICALLY BROKEN - the unread fixture supplied the key "unread" while the client reads
 * "unread_count", and the group-name assertion targeted the testid "group-name", which is the
 * CREATION INPUT rather than any displayed name. Two bugs that a single execution would have
 * caught, in tests offered as proof. Both are fixed above; neither fix has been executed either.
 *
 * So the honest status of this file is: WRITTEN AND REVIEWED, NOT RUN. The behaviours it targets
 * that CAN be proven here are proven where they can actually execute - GroupThread.test.tsx and
 * groups.server.test.ts run in the ordinary vitest gate and carry the mark-read, watermark,
 * truncation, rename and per-person-resend guards, each mutation-verified. Treat what is below as
 * a specification of the browser receipts still owed, not as evidence they pass.
 *
 * HOW COMPLETE IS THIS, HONESTLY. Round-1 finding 6 asked for authenticated receipts across
 * GRP-001..008. What is below establishes the stubbed-session pattern and covers the signed-in
 * entry point only. It is a START on that finding, not its closure, and it is reported as such
 * rather than counted as done — a suite that claims eight requirements and exercises one is the
 * same defect finding 6 raised, wearing the opposite costume.
 */

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

/** A session cookie the app accepts, with no database behind it. */
async function signInStub(page: import('@playwright/test').Page): Promise<void> {
  const session = {
    access_token: 'stub-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'stub-refresh-token',
    user: { id: VIEWER_ID, aud: 'authenticated', role: 'authenticated', email: 'me@example.test' },
  };
  const value = Buffer.from(JSON.stringify(session)).toString('base64url');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ref = url.replace(/^https?:\/\//, '').split('.')[0] || 'stub';
  await page.context().addCookies([
    { name: `sb-${ref}-auth-token`, value: `base64-${value}`, url: 'http://localhost:3000' },
  ]);
}

test.describe('Social · Groups · signed in (stubbed transport, no database)', () => {

  /** Fulfil a PostgREST table read or an RPC with a JSON body. */
  const json = (body: unknown) => async (route: import('@playwright/test').Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };

  /**
   * Stub the exact endpoints the Groups surface calls, and nothing else. Every one is a real call
   * site in src/lib/groups.server.ts: the `groups` table read behind fetchMyGroups, and the
   * group_unread_counts / get_group_thread / get_group_members / mark_group_read RPCs.
   */
  async function stubGroups(page: import('@playwright/test').Page, opts: {
    groups?: unknown[];
    unread?: unknown[];
    thread?: unknown[] | null;
    members?: unknown[];
  } = {}): Promise<void> {
    const marked: string[] = [];
    (page as unknown as { __marked: string[] }).__marked = marked;
    await page.route('**/rest/v1/groups?**', json(opts.groups ?? []));
    await page.route('**/rest/v1/rpc/group_unread_counts', json(opts.unread ?? []));
    await page.route('**/rest/v1/rpc/get_group_members', json(opts.members ?? []));
    await page.route('**/rest/v1/rpc/mark_group_read', async (route) => {
      marked.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
    });
    await page.route('**/rest/v1/rpc/get_group_thread', async (route) => {
      if (opts.thread === null) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.thread ?? []) });
    });
  }

  test('a signed-in member sees their own groups, not the signed-out placeholder (GRP-001)', async ({ page }) => {
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      unread: [{ group_id: GROUP_ID, unread_count: 2 }],
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await expect(page.getByTestId('group-list')).toBeVisible();
    await expect(page.getByTestId('group-row').first()).toContainText('Thursday Crew');
    // The signed-out placeholder and its sign-in link must NOT render for a member.
    await expect(page.getByTestId('groups-signed-out')).toHaveCount(0);
    await expect(page.getByTestId('groups-sign-in')).toHaveCount(0);
  });

  test('the unread badge is carried in-app, per V8-R-GRP-008', async ({ page }) => {
    // GRP-008's included half: unread state is in-app, not only an OS badge. A count that never
    // renders is the same defect as a push that never sends.
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      unread: [{ group_id: GROUP_ID, unread_count: 3 }],
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();
    await expect(page.getByTestId('group-unread')).toContainText('3');
  });

  test('a failed thread load states the failure and does NOT clear unread state', async ({ page }) => {
    // The round-1 finding, end to end: mark_group_read used to fire from its own mount effect, so
    // a failed load still cleared the badge. Asserted here against the real network boundary
    // rather than only at the component seam.
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      unread: [{ group_id: GROUP_ID, unread_count: 2 }],
      thread: null,
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();
    await page.getByTestId('group-row').first().click();

    await expect(page.getByTestId('groups-notice').or(page.getByText(/could not be loaded/i)).first()).toBeVisible();
    const marked = (page as unknown as { __marked: string[] }).__marked;
    expect(marked, 'a failed thread load must not mark the group read').toEqual([]);
  });
});
