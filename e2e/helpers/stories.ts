import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';

/**
 * Signed-in Stories, driven through the production UI against a stubbed
 * Supabase — the same cookie + route-stub pattern `friends-real.spec.ts` and
 * `claim-handle.spec.ts` already use. No real accounts and no database rows.
 *
 * WHY THIS EXISTS. Migration 0065 made Stories server-backed, and the browser
 * specs were cut back to signed-OUT assertions on the reasoning that driving
 * the viewer, the queue, the pause rules, the tagged-people sheet and the whole
 * Add-Story branch "needs two real accounts and a database". That conflated two
 * different things:
 *
 *   - WHO MAY READ A STORY is an authorization question. It lives in RLS and in
 *     SECURITY DEFINER functions, it cannot be proven in a browser, and it
 *     belongs in `src/lib/storiesRls.live.test.ts` against a real database.
 *   - WHAT THE UI DOES WITH THE ROWS IT IS GIVEN is a browser question, and
 *     stubbing the transport answers it perfectly well. Progress counts,
 *     person-to-person handoff, exhaustion, pause rules, the consent sheet, the
 *     five-screen Add-Story branch, the capture modes, the receipt and Undo are
 *     all UI behaviour. They regressed invisibly for a full cycle because the
 *     only tests that covered them were deleted rather than re-pointed.
 *
 * So: authorization stays in the live suite, and everything else is asserted
 * here, in a real browser, on both engines.
 */

export const YOU_ID = '11111111-2222-3333-4444-555555555555';
export const YOU_EMAIL = 'connor@example.com';
export const CLAIRE_ID = '99999999-8888-7777-6666-555555555555';
export const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A 1x1 transparent PNG — real bytes, so a rendered story frame is a real image. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export function readSupabaseUrl(): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

export const SUPABASE_URL = readSupabaseUrl();

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** The @supabase/ssr auth cookie for a fake signed-in session. */
function sessionCookie(supabaseUrl: string): { name: string; value: string } {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ sub: YOU_ID, role: 'authenticated', exp: expiresAt })),
    'e2e-fake-signature',
  ].join('.');
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-fake-refresh',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    user: {
      id: YOU_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: YOU_EMAIL,
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

export async function signIn(page: Page): Promise<void> {
  const cookie = sessionCookie(SUPABASE_URL as string);
  // Cookies are keyed by domain, not by port, so the fixed URL here is correct
  // whatever port this run pinned.
  await page.context().addCookies([{ ...cookie, url: 'http://localhost:3000' }]);
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

export type ProfileRow = { id: string; handle: string; display_name: string | null };

export type StoryRow = {
  id: string;
  author_id: string;
  bar_id: string | null;
  caption: string | null;
  media_path: string;
  inset_path: string | null;
  media_kind: 'single' | 'dual';
  audience: 'friends' | 'custom';
  created_at: string;
  expires_at: string;
};

export type TagRow = { story_id: string; profile_id: string };

export const CLAIRE: ProfileRow = { id: CLAIRE_ID, handle: 'claire_w', display_name: 'Claire W.' };
export const DEV: ProfileRow = { id: DEV_ID, handle: 'dev_p', display_name: 'Dev P.' };

/** Minutes ago / from now, as the ISO strings the rows carry. */
export function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
export function fromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function story(overrides: Partial<StoryRow> & { id: string; author_id: string }): StoryRow {
  return {
    bar_id: null,
    caption: null,
    media_path: `${overrides.author_id}/${overrides.id}/main`,
    inset_path: null,
    media_kind: 'single',
    audience: 'friends',
    created_at: ago(10),
    expires_at: fromNow(60),
    ...overrides,
  };
}

export type StoriesStub = {
  /** Rows the next /rest/v1/stories read returns. Mutate to model a refresh. */
  stories: StoryRow[];
  tags: TagRow[];
  /** Everything the browser actually uploaded, by object key. */
  uploads: string[];
  /** Object keys the client asked Storage to delete. */
  removed: string[];
  /** publish_story call arguments, in order. */
  published: Record<string, unknown>[];
  /** Set to fail the next publish_story with this PostgREST error. */
  publishError: { code?: string; message: string } | null;
  /** Set to fail delete_story (the receipt's Undo). */
  deleteError: { code?: string; message: string } | null;
  /** What remove_my_story_tag answers. false = "you are not tagged". */
  untagResult: boolean | 'error';
};

/**
 * Stub every Supabase surface the signed-in Social page touches.
 *
 * Playwright matches routes newest-first, so the broad catch-alls are
 * registered FIRST and the specific endpoints registered after them win.
 */
export async function stubStories(
  page: Page,
  opts: {
    following?: ProfileRow[];
    followers?: ProfileRow[];
    stories?: StoryRow[];
    tags?: TagRow[];
  } = {},
): Promise<StoriesStub> {
  const state: StoriesStub = {
    stories: opts.stories ?? [],
    tags: opts.tags ?? [],
    uploads: [],
    removed: [],
    published: [],
    publishError: null,
    deleteError: null,
    untagResult: true,
  };

  await page.route('**/rest/v1/**', fulfillJson(200, []));
  await page.route('**/auth/v1/**', fulfillJson(200, {}));

  // The circle. mutuals = following ∩ followers, which is what "friends" means
  // everywhere on this surface, so a one-way follow must be given as one.
  await page.route('**/rest/v1/rpc/get_following**', (route) =>
    fulfillJson(200, opts.following ?? [])(route),
  );
  await page.route('**/rest/v1/rpc/get_followers**', (route) =>
    fulfillJson(200, opts.followers ?? opts.following ?? [])(route),
  );

  // The story rows, read fresh every time: `refresh()` after a publish or a
  // delete re-reads, and a stub that answered with a frozen list would be
  // telling the app the write did not happen.
  await page.route('**/rest/v1/stories**', (route) =>
    fulfillJson(200, state.stories)(route),
  );
  await page.route('**/rest/v1/story_tags**', (route) =>
    fulfillJson(200, state.tags)(route),
  );

  await page.route('**/rest/v1/rpc/publish_story**', async (route) => {
    if (state.publishError !== null) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(state.publishError),
      });
      return;
    }
    const args = route.request().postDataJSON() as Record<string, unknown>;
    state.published.push(args);
    const row = story({
      id: `published-${state.published.length}`,
      author_id: YOU_ID,
      media_path: String(args.p_media_path),
      inset_path: (args.p_inset_path as string | null) ?? null,
      media_kind: (args.p_media_kind as 'single' | 'dual') ?? 'single',
      audience: (args.p_audience as 'friends' | 'custom') ?? 'friends',
      bar_id: (args.p_bar_id as string | null) ?? null,
      created_at: ago(0),
    });
    // What the server would do: the row is live from this moment, so the next
    // read returns it. Tags likewise.
    state.stories = [row, ...state.stories];
    for (const id of (args.p_tag_ids as string[] | undefined) ?? []) {
      state.tags = [...state.tags, { story_id: row.id, profile_id: id }];
    }
    await fulfillJson(200, row)(route);
  });

  await page.route('**/rest/v1/rpc/delete_story**', async (route) => {
    if (state.deleteError !== null) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(state.deleteError),
      });
      return;
    }
    const args = route.request().postDataJSON() as { p_story_id: string };
    const target = state.stories.find((row) => row.id === args.p_story_id);
    state.stories = state.stories.filter((row) => row.id !== args.p_story_id);
    await fulfillJson(
      200,
      target === undefined
        ? []
        : [{ media_path: target.media_path, inset_path: target.inset_path }],
    )(route);
  });

  await page.route('**/rest/v1/rpc/remove_my_story_tag**', async (route) => {
    if (state.untagResult === 'error') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'tag removal failed' }),
      });
      return;
    }
    if (state.untagResult) {
      const args = route.request().postDataJSON() as { p_story_id: string };
      state.tags = state.tags.filter(
        (tag) => !(tag.story_id === args.p_story_id && tag.profile_id === YOU_ID),
      );
    }
    await fulfillJson(200, state.untagResult)(route);
  });

  // THE MEDIA BOUNDARY, not Storage.
  //
  // These used to stub `**/storage/v1/object/story-media**` directly, because
  // that is what `stories.server.ts` called. 0071 revoked the bucket policies
  // that path depends on, and the module now goes through `/api/media/*` — so a
  // stub aimed at Storage answers a request the app no longer makes, while the
  // real route handler (which needs a service-role key the worktree env does not
  // carry) answers 503. Stubbing the boundary is what keeps this suite testing
  // the app's actual contract rather than a retired one.
  //
  // `state.uploads` still records the OBJECT KEY, because that is what the
  // assertions are about — but the key is now the one the ROUTE mints and
  // returns (`${owner}/${mediaId}`), which is exactly the value the app then
  // hands to publish_story.
  // ONE handler for the whole boundary, branching internally. Three separate
  // page.route globs do NOT work here: Playwright matches newest-first, so a
  // `**/api/media/*` registered last shadows `**/api/media/upload`, and the
  // upload arrives at the removal branch. Matching once and branching on the
  // path is the version that cannot be broken by registration order.
  let mediaSeq = 0;
  await page.route('**/api/media/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith('/api/media/upload')) {
      mediaSeq += 1;
      const mediaId = `e2e-media-${mediaSeq}`;
      const storagePath = `${YOU_ID}/${mediaId}`;
      state.uploads.push(storagePath);
      await fulfillJson(200, {
        ok: true, mediaId, storagePath,
        contentType: 'image/png', width: 1, height: 1, alsoReclaimed: 0,
      })(route);
      return;
    }

    // Mint. The route decides the lifetime, so there is no expiresIn to
    // honour — it hands back a URL, and the authenticated-object fetch below
    // answers that with real PNG bytes.
    if (path.endsWith('/url')) {
      await fulfillJson(200, {
        ok: true, url: '/object/authenticated/story-media/signed.png?token=e2e',
      })(route);
      return;
    }

    if (request.method() === 'DELETE') {
      state.removed.push(path.split('/').pop() ?? '');
      await fulfillJson(200, { ok: true })(route);
      return;
    }

    await fulfillJson(404, { ok: false, error: 'not_found' })(route);
  });
  await page.route('**/storage/v1/object/authenticated/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  return state;
}
