import { NextResponse } from 'next/server';

import { resolveMediaWindow, type DestinationWindow } from '@/lib/media/mediaWindow';
import {
  adminClient,
  bearerToken,
  callerClient,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';
import { mintSignedMediaUrl } from '@/lib/media/signedUrl';

/**
 * GET /api/media/:mediaId/url — mint a signed URL with a SERVER-DECIDED
 * lifetime (V8-R-STO-015).
 *
 * The hole this closes, as stories.server.ts states it: "the mint itself is a
 * client call, and a client may pass any `expiresIn` it likes". Note what this
 * route does NOT accept: there is no `expiresIn` query parameter, and adding
 * one would reintroduce the defect. The lifetime is derived from the media's
 * own window, read from the database inside this handler.
 *
 * AUTHORIZATION stays with the database. The mint runs on the CALLER'S client,
 * so 0065's bucket SELECT policies decide who may read the object — including
 * the rule that an expired or deleted story can no longer be signed by anyone,
 * its author included. Service role would mint for anyone who reached the URL.
 */
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { mediaId: string } },
): Promise<NextResponse> {
  const env = readMediaEnv();
  if (env === null) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const token = bearerToken(request);
  if (token === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = adminClient(env);
  const userId = await verifiedUserId(admin, token);
  if (userId === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { data: media, error: mediaError } = await admin
      .from('media_objects')
      .select('storage_path, bytes_removed_at')
      .eq('id', params.mediaId)
      .maybeSingle();

    if (mediaError) {
      console.error('[media/url] registry read failed:', mediaError.message);
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!media || media.bytes_removed_at !== null) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // The window comes from the LIVE destinations. Read with service role so it
    // is the true set: a caller-scoped read would return only the references
    // that caller can see, and a shorter window computed from a partial set
    // would expire a URL early for a legitimate viewer.
    //
    // This read decides only the LIFETIME. It grants nothing: the mint below
    // still has to pass the caller's own storage policy.
    const { data: destinations, error: destError } = await admin
      .from('media_destinations')
      .select('kind, ref_id')
      .eq('media_id', params.mediaId)
      .is('removed_at', null);

    if (destError) {
      console.error('[media/url] destination read failed:', destError.message);
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    const rows = (destinations ?? []) as { kind: string; ref_id: string }[];

    // Story destinations carry their expiry on the story row. Other kinds have
    // no expiry of their own today; when a lane adds one, it joins here.
    const storyRefs = rows.filter((r) => r.kind === 'story').map((r) => r.ref_id);
    const storyExpiry = new Map<string, string>();
    if (storyRefs.length > 0) {
      const { data: stories, error: storyError } = await admin
        .from('stories')
        .select('id, expires_at')
        .in('id', storyRefs)
        .is('deleted_at', null);

      if (storyError) {
        console.error('[media/url] story window read failed:', storyError.message);
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      for (const row of (stories ?? []) as { id: string; expires_at: string }[]) {
        storyExpiry.set(row.id, row.expires_at);
      }
    }

    const windows: DestinationWindow[] = rows.flatMap((row): DestinationWindow[] => {
      if (row.kind !== 'story') return [{ kind: row.kind, expiresAt: null }];
      const expiresAt = storyExpiry.get(row.ref_id);
      // A story destination whose story is deleted contributes no window. It is
      // dropped rather than treated as unbounded.
      return expiresAt === undefined ? [] : [{ kind: row.kind, expiresAt }];
    });

    const window = resolveMediaWindow(windows);
    if (!window.readable) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const signed = await mintSignedMediaUrl(
      callerClient(env, token),
      media.storage_path as string,
      window.expiresAt,
    );

    if (!signed.ok) {
      // 'denied' covers both "the policy refused this caller" and "no grantable
      // lifetime remains". Neither distinguishes itself to the client, and
      // neither renders a decorative placeholder.
      const status = signed.reason === 'unavailable' ? 503 : 404;
      return NextResponse.json({ ok: false, error: 'not_found' }, { status });
    }

    return NextResponse.json({
      ok: true,
      url: signed.value.url,
      expiresInSeconds: signed.value.expiresInSeconds,
    });
  } catch (error) {
    console.error(
      '[media/url] unexpected failure:',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
