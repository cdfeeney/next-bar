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

import { test, expect } from './helpers/test';

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
    // X5 round 5: the plan PICKER is a new control that reads the viewer's own night out plans.
    // Signed out it must not render at all — it would call an RPC no anonymous caller can satisfy.
    await expect(page.getByTestId('group-invite-plan')).toHaveCount(0);
    await expect(page.getByTestId('group-unread')).toHaveCount(0);
    await expect(page.getByTestId('group-invite-send')).toHaveCount(0);
    // Round 9: the in-app invitation notification reads an auth-scoped RPC, so signed out it is
    // another control that could only fail.
    await expect(page.getByTestId('group-invite-notifications')).toHaveCount(0);
    await expect(page.getByTestId('group-invite-seen')).toHaveCount(0);
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
 * GRP-001..008. Round 5 extends the stubbed-session pattern from the entry point to the two
 * surfaces it changed — the GRP-003 plan picker and GRP-007's departed sender — so the covered
 * set is now: the signed-in group list (GRP-001), the in-app unread badge (GRP-008), a failed
 * thread load not clearing unread (GRP-008), the plan picker and its three load states (GRP-003),
 * and a message outliving its author (GRP-007).
 *
 * STILL NOT COVERED, and named rather than left to be discovered: sending text and photos
 * (GRP-002), the administration verbs — rename, add, remove (GRP-004/005), leaving and D-C-38
 * succession (GRP-006), the reporter's hide (FEED-010), and the block. Those are authorization
 * RULES; a stubbed transport can only prove what the client renders when the server has already
 * decided, so stubbing them would assert the fixture rather than the rule. They belong to the
 * attended staging run against an applied schema.
 *
 * So finding 6 is ADVANCED, not closed. A suite that claimed eight requirements while exercising
 * one would be the same defect finding 6 raised wearing the opposite costume, and so would a
 * suite that claims closure because the count went up.
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
    /** X4: the viewer's invitable plans. `null` fulfils a FAILURE, which is its own state. */
    plans?: unknown[] | null;
    /**
     * Round 9, GRP-008's inclusion half: the viewer's own Night Out invitation notifications.
     * `null` fulfils a FAILURE, because "nobody invited you" and "that could not be loaded" must
     * not render the same.
     */
    invites?: unknown[] | null;
  } = {}): Promise<void> {
    const marked: string[] = [];
    (page as unknown as { __marked: string[] }).__marked = marked;
    await page.route('**/rest/v1/groups?**', json(opts.groups ?? []));
    await page.route('**/rest/v1/rpc/group_unread_counts', json(opts.unread ?? []));
    await page.route('**/rest/v1/rpc/get_group_members', json(opts.members ?? []));
    // X4. The thread mounts a plans read; leaving it unrouted would let a real request escape to
    // the network and turn every signed-in test into an accidental assertion about that failure.
    await page.route('**/rest/v1/rpc/get_my_invitable_night_outs', async (route) => {
      if (opts.plans === null) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.plans ?? []) });
    });
    // Round 9. The Groups surface's own load() now reads this too, so leaving it unrouted would
    // let a real request escape to the network — the same trap the plans read documents above.
    await page.route('**/rest/v1/rpc/get_my_night_out_invitation_notifications', async (route) => {
      if (opts.invites === null) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.invites ?? []) });
    });
    await page.route('**/rest/v1/rpc/mark_night_out_invitation_notification_read', json(true));
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

  test('a night out invitation is DELIVERED IN-APP, not only recorded (GRP-008, round 9)', async ({ page }) => {
    // The round-8 finding: 0067 wrote night_out_invitation_notifications and the read RPC, and
    // nothing in the product displayed either — so an invitee became a plan member and was never
    // told. Push delivery is another lane's file and is still absent by design; this is the
    // in-app half the requirement includes by name, and it is the half this lane owns.
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      invites: [{
        id: 7,
        night_out_id: '44444444-4444-4444-8444-444444444444',
        night: '2026-09-04',
        title: 'Sam-s birthday',
        group_id: GROUP_ID,
        group_name: 'Thursday Crew',
        invited_by: OTHER_ID,
        created_at: '2026-09-01T00:00:00Z',
        read_at: null,
      }],
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    const notice = page.getByTestId('group-invite-notification');
    await expect(notice).toContainText('Sam-s birthday');
    // "via <group>" is what makes it a GROUP invitation rather than an anonymous one.
    await expect(notice).toContainText('Thursday Crew');

    // Seeing it IS the notification, so dismissing writes read_at and the row leaves the surface.
    await page.getByTestId('group-invite-seen').click();
    await expect(page.getByTestId('group-invite-notification')).toHaveCount(0);
  });

  test('an ALREADY-DISMISSED invitation does not come back on the next load (round 10)', async ({ page }) => {
    // ROUND-9 REVIEW, CODEX, MEDIUM. get_my_night_out_invitation_notifications deliberately
    // returns read rows too, so filtering is the caller's job — and round 9 did not do it. Got it
    // wrote read_at, the row left optimistically, and the next load put it straight back. Two
    // fixtures, one read and one not, so this cannot pass by rendering neither.
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      invites: [
        {
          id: 7,
          night_out_id: '44444444-4444-4444-8444-444444444444',
          night: '2026-09-04',
          title: 'already seen',
          group_id: GROUP_ID,
          group_name: 'Thursday Crew',
          invited_by: OTHER_ID,
          created_at: '2026-09-01T00:00:00Z',
          read_at: '2026-09-02T00:00:00Z',
        },
        {
          id: 8,
          night_out_id: '55555555-5555-4555-8555-555555555555',
          night: '2026-09-05',
          title: 'still new',
          group_id: null,
          // The inviter deleted their account: invited_by is nullable with ON DELETE SET NULL, and
          // a null here must render like any other invitation rather than breaking the row.
          group_name: null,
          invited_by: null,
          created_at: '2026-09-03T00:00:00Z',
          read_at: null,
        },
      ],
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await expect(page.getByTestId('group-invite-notification')).toHaveCount(1);
    await expect(page.getByTestId('group-invite-notification')).toContainText('still new');
    await expect(page.getByTestId('group-invite-notifications')).not.toContainText('already seen');
  });

  test('a FAILED invitation read says so rather than saying nobody invited you (round 9)', async ({ page }) => {
    // The same collapse fetchMyGroups and the plan picker each refuse: an empty list and an
    // unreachable backend must never render identically.
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      invites: null,
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await expect(page.getByTestId('group-invites-failed')).toBeVisible();
    await expect(page.getByTestId('group-invite-notification')).toHaveCount(0);
    // The group list itself is unaffected: one failed read does not blank the surface.
    await expect(page.getByTestId('group-row').first()).toContainText('Thursday Crew');
  });

  test('no invitations renders no notification block at all (round 9)', async ({ page }) => {
    await signInStub(page);
    await stubGroups(page, {
      groups: [{ id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' }],
      invites: [],
    });
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();

    await expect(page.getByTestId('group-list')).toBeVisible();
    await expect(page.getByTestId('group-invite-notifications')).toHaveCount(0);
    await expect(page.getByTestId('group-invites-failed')).toHaveCount(0);
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

  /** Open Thursday Crew's thread. Every signed-in thread test starts here. */
  async function openThread(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/friends');
    await page.getByRole('button', { name: /groups & people/i }).click();
    await page.getByTestId('group-row').first().click();
  }

  const GROUP_ROW = { id: GROUP_ID, name: 'Thursday Crew', created_at: '2026-08-01T00:00:00Z' };
  const ROSTER = [
        { profile_id: VIEWER_ID, handle: 'me', display_name: 'Me', is_admin: true, joined_at: '2026-08-01T00:00:00Z' },
        { profile_id: OTHER_ID, handle: 'them', display_name: 'Them', is_admin: false, joined_at: '2026-08-02T00:00:00Z' },
      ];

  test('the night out plan is PICKED from the viewer-s own plans (GRP-003, X4)', async ({ page }) => {
    // Round 5 replaced a "Night out id" text box with a picker. A uuid is not a choice a person
    // can make, and the browser is where that is actually visible.
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      thread: [],
      plans: [
        { night_out_id: '44444444-4444-4444-8444-444444444444', night: '2026-09-04', title: 'Sam-s birthday', status: 'open', my_role: 'owner' },
        { night_out_id: '55555555-5555-4555-8555-555555555555', night: '2026-09-11', title: null, status: 'draft', my_role: 'member' },
      ],
    });
    await openThread(page);

    const picker = page.getByTestId('group-invite-plan');
    await expect(picker).toBeVisible();
    // A select, not a free-text field — the whole point of X4.
    await expect(picker).toHaveJSProperty('tagName', 'SELECT');
    await expect(picker.locator('option')).toContainText(['Sam-s birthday (yours)', '2026-09-11']);
  });

  test('a FAILED plans read is not "you have no plans", and does not blank the thread (X4)', async ({ page }) => {
    // "You have no plans" sends someone off to create a plan they already have. The thread itself
    // loaded fine and must stay on screen — the plans list is secondary content.
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      thread: [],
      plans: null,
    });
    await openThread(page);

    await expect(page.getByTestId('group-invite-plans-failed')).toBeVisible();
    await expect(page.getByTestId('group-invite-plans-empty')).toHaveCount(0);
    await expect(page.getByTestId('group-invite')).toBeVisible();
  });

  test('no invitable plans says so plainly (X4)', async ({ page }) => {
    await signInStub(page);
    await stubGroups(page, { groups: [GROUP_ROW], members: ROSTER, thread: [], plans: [] });
    await openThread(page);

    await expect(page.getByTestId('group-invite-plans-empty')).toBeVisible();
    await expect(page.getByTestId('group-invite-plans-failed')).toHaveCount(0);
  });

  test('a message outlives its author and is attributed to a departed member (GRP-007, X5)', async ({ page }) => {
    // X5: sender_id is `on delete set null`, because V8-R-GRP-007 does not list account deletion
    // among its removal causes. The message survives, the thread stays whole, and the browser is
    // where "A departed member" is actually read by a person.
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      plans: [],
      thread: [
        { id: '66666666-6666-4666-8666-666666666666', sender_id: null, sender_handle: null,
          sender_display_name: null, body: 'still here', media_id: null,
          created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    await openThread(page);

    await expect(page.getByTestId('group-message')).toContainText('A departed member');
    // The history is the thing that survives — the body must still be there.
    await expect(page.getByTestId('group-message')).toContainText('still here');
  });

  test('a message whose photo was removed renders a tombstone, not a blank bubble (round 6)', async ({ page }) => {
    // The round-5 HIGH, from the browser's side. media_id is ON DELETE SET NULL and WP1's media
    // cascades when its owner deletes their account, so a photo-only message that survives its
    // author has no content left. The row is kept (V8-R-GRP-007 does not list "its photo was
    // deleted" among the removal causes), so the thread must SAY the photo is gone. An empty
    // bubble is the "empty row in a thread is a defect no reader can explain" case.
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      plans: [],
      thread: [
        { id: '88888888-8888-4888-8888-888888888888', sender_id: null, sender_handle: null,
          sender_display_name: null, body: null, media_id: null,
          media_removed_at: '2026-09-02T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    await openThread(page);

    await expect(page.getByTestId('group-message-photo-removed')).toBeVisible();
    // Both facts survive together: the author is gone AND the photo is gone.
    await expect(page.getByTestId('group-message')).toContainText('A departed member');
  });

  test('an ordinary text message shows no photo tombstone (round 6)', async ({ page }) => {
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      plans: [],
      thread: [
        { id: '99999999-9999-4999-8999-999999999999', sender_id: OTHER_ID, sender_handle: 'them',
          sender_display_name: 'Them', body: 'hello', media_id: null,
          media_removed_at: null, created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    await openThread(page);

    await expect(page.getByTestId('group-message')).toContainText('hello');
    await expect(page.getByTestId('group-message-photo-removed')).toHaveCount(0);
  });

  test('a present account with no name is Someone, NOT a departed member (X5)', async ({ page }) => {
    // The two cases must not collapse: one account is gone, the other is merely unnamed.
    await signInStub(page);
    await stubGroups(page, {
      groups: [GROUP_ROW],
      members: ROSTER,
      plans: [],
      thread: [
        { id: '77777777-7777-4777-8777-777777777777', sender_id: OTHER_ID, sender_handle: null,
          sender_display_name: null, body: 'present', media_id: null,
          created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    await openThread(page);

    await expect(page.getByTestId('group-message')).toContainText('Someone');
    await expect(page.getByTestId('group-message')).not.toContainText('A departed member');
  });
});
