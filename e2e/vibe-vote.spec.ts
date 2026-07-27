/**
 * vibe-vote.spec.ts
 *
 * UX-E "Tonight's vibe" poll on /friends/consensus (migration 0017 —
 * AUTHORED, unapplied in prod; the stubs here simulate the applied
 * state, plus the dark state). Same stubbed-Supabase pattern as
 * suggestions.spec.ts; the vote stub is STATEFUL (cast upserts, DELETE
 * rescinds) because the hook refetches after every write.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const FRIEND = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  handle: 'claire',
  display_name: 'Claire',
};

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
    base64Url(
      JSON.stringify({ sub: USER_ID, role: 'authenticated', exp: expiresAt }),
    ),
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

type VoteRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  tag: string;
  created_at: string;
};

type StubOptions = {
  /** Initial vote rows; mutated by cast/rescind. */
  voteRows?: VoteRow[];
  /** Simulate the UNAPPLIED migration: the vote RPCs don't exist. */
  voteRpcMissing?: boolean;
  friendRatings?: Array<{
    user_id: string;
    bar_id: string;
    tier: string;
    rated_at: string;
  }>;
  youRatings?: Array<{ bar_id: string; tier: string; rated_at: string }>;
};

const NIGHT_BODY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function stubSupabase(page: Page, opts: StubOptions): Promise<void> {
  const votes: VoteRow[] = opts.voteRows ?? [];

  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));
  if (opts.youRatings) {
    await page.route('**/rest/v1/ratings**', fulfillJson(200, opts.youRatings));
  }
  await page.route('**/rest/v1/rpc/get_following**', fulfillJson(200, [FRIEND]));
  await page.route(
    '**/rest/v1/rpc/get_friend_ratings**',
    fulfillJson(200, opts.friendRatings ?? []),
  );
  await page.route('**/rest/v1/rpc/get_circle_suggestions**', fulfillJson(200, []));
  await page.route('**/rest/v1/rpc/get_circle_rsvps**', fulfillJson(200, []));

  if (opts.voteRpcMissing) {
    // PostgREST's shape for a missing function — what prod returns until
    // 0017 is applied. The catch-all above would return [] (an array!),
    // which would wrongly read as "live, no votes".
    await page.route(
      '**/rest/v1/rpc/get_circle_vibe_votes**',
      fulfillJson(404, { message: 'function public.get_circle_vibe_votes(p_night) does not exist' }),
    );
    await page.route(
      '**/rest/v1/rpc/cast_vibe_vote**',
      fulfillJson(404, { message: 'function does not exist' }),
    );
    return;
  }

  await page.route('**/rest/v1/rpc/get_circle_vibe_votes**', async (route) => {
    await fulfillJson(200, votes)(route);
  });
  await page.route('**/rest/v1/rpc/cast_vibe_vote**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      p_night?: string;
      p_tag?: string;
    };
    if (typeof body.p_night !== 'string' || !NIGHT_BODY_RE.test(body.p_night)) {
      await route.fulfill({ status: 500, body: 'missing/malformed night scope' });
      return;
    }
    if (!body.p_tag) {
      await fulfillJson(200, false)(route);
      return;
    }
    // Upsert MOVE — one row per user (mirrors the 0017 PK). Same-tag
    // re-cast is a NO-OP that keeps created_at (stub fidelity with the
    // migration's `where ... is distinct from excluded.tag` — review MED:
    // the tie-break anchor must not reset on a repeat tap).
    const mine = votes.findIndex((v) => v.user_id === USER_ID);
    if (mine !== -1 && votes[mine].tag === body.p_tag) {
      await fulfillJson(200, true)(route);
      return;
    }
    const row: VoteRow = {
      user_id: USER_ID,
      handle: 'connor_f',
      display_name: 'Conor F',
      tag: body.p_tag,
      created_at: new Date().toISOString(),
    };
    if (mine === -1) votes.push(row);
    else votes[mine] = row;
    await fulfillJson(200, true)(route);
  });
  await page.route('**/rest/v1/vibe_votes**', async (route) => {
    if (route.request().method() === 'DELETE') {
      const idx = votes.findIndex((v) => v.user_id === USER_ID);
      if (idx !== -1) votes.splice(idx, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await fulfillJson(200, [])(route);
  });
}

async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
  await page.addInitScript(() => {
    window.sessionStorage.setItem('next-bar:onboarding-prompted:v1', '1');
  });
}

test.describe('UX-E — tonight\'s vibe poll', () => {
  test.skip(!SUPABASE_URL, 'needs NEXT_PUBLIC_SUPABASE_URL in .env.local');

  test('DARK until 0017 applies: missing RPC → the poll never renders', async ({
    page,
  }) => {
    await signIn(page);
    await stubSupabase(page, { voteRpcMissing: true });
    await page.goto('/friends/consensus');

    await expect(
      page.getByRole('heading', { name: /Plan Night Out/i }),
    ).toBeVisible();
    // The board works; the poll is invisible — no half-rendered feature.
    await expect(page.getByTestId('vibe-vote-poll')).toHaveCount(0);
  });

  test('cast → move → rescind: one vote that follows your last tap', async ({
    page,
  }) => {
    await signIn(page);
    await stubSupabase(page, { voteRows: [] });
    await page.goto('/friends/consensus');

    const poll = page.getByTestId('vibe-vote-poll');
    await expect(poll).toBeVisible();

    // Cast: Dancing lights up with your vote counted.
    const dancing = poll.getByRole('button', { name: /Dancing/ });
    await dancing.click();
    await expect(dancing).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('vibe-count-dance')).toHaveText('1');

    // Move: one vote per night — Chill takes it, Dancing empties.
    const chill = poll.getByRole('button', { name: /Chill/ });
    await chill.click();
    await expect(chill).toHaveAttribute('aria-pressed', 'true');
    await expect(dancing).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('vibe-count-chill')).toHaveText('1');
    await expect(page.getByTestId('vibe-count-dance')).toHaveCount(0);

    // Rescind: tapping your own choice again clears it.
    await chill.click();
    await expect(chill).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('vibe-count-chill')).toHaveCount(0);
  });

  test('the winning vibe seeds Group Favorites: dance winner floats the dance bar', async ({
    page,
  }) => {
    await signIn(page);
    await stubSupabase(page, {
      voteRows: [
        {
          user_id: FRIEND.id,
          handle: FRIEND.handle,
          display_name: FRIEND.display_name,
          tag: 'dance',
          created_at: '2026-07-27T01:00:00.000Z',
        },
      ],
      // Both of you loved BOTH bars → both are Group Favorites; the vibe
      // winner decides which leads.
      friendRatings: [
        { user_id: FRIEND.id, bar_id: 'attaboy', tier: 'loved', rated_at: '2026-07-01T00:00:00Z' },
        { user_id: FRIEND.id, bar_id: 'mood-ring', tier: 'loved', rated_at: '2026-07-01T00:00:00Z' },
      ],
      youRatings: [
        { bar_id: 'attaboy', tier: 'loved', rated_at: '2026-07-02T00:00:00Z' },
        { bar_id: 'mood-ring', tier: 'loved', rated_at: '2026-07-02T00:00:00Z' },
      ],
    });
    await page.goto('/friends/consensus');

    // Winner chip on the Group Favorites heading; the dance-tagged bar
    // (Mood Ring) leads — the top pick carries the share moment.
    await expect(page.getByTestId('winning-vibe-chip')).toHaveText(
      /Tonight: Dancing/,
    );
    await expect(
      page.getByRole('button', { name: 'Share the pick: Mood Ring' }),
    ).toBeVisible();
  });

  test('a speakeasy winner floats the speakeasy bar instead (boost is vibe-driven, not baseline order)', async ({
    page,
  }) => {
    await signIn(page);
    await stubSupabase(page, {
      voteRows: [
        {
          user_id: FRIEND.id,
          handle: FRIEND.handle,
          display_name: FRIEND.display_name,
          tag: 'speakeasy',
          created_at: '2026-07-27T01:00:00.000Z',
        },
      ],
      friendRatings: [
        { user_id: FRIEND.id, bar_id: 'attaboy', tier: 'loved', rated_at: '2026-07-01T00:00:00Z' },
        { user_id: FRIEND.id, bar_id: 'mood-ring', tier: 'loved', rated_at: '2026-07-01T00:00:00Z' },
      ],
      youRatings: [
        { bar_id: 'attaboy', tier: 'loved', rated_at: '2026-07-02T00:00:00Z' },
        { bar_id: 'mood-ring', tier: 'loved', rated_at: '2026-07-02T00:00:00Z' },
      ],
    });
    await page.goto('/friends/consensus');

    await expect(page.getByTestId('winning-vibe-chip')).toHaveText(
      /Tonight: Speakeasy/,
    );
    await expect(
      page.getByRole('button', { name: 'Share the pick: Attaboy' }),
    ).toBeVisible();
  });
});
