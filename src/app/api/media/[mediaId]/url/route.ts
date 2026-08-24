import { NextResponse } from 'next/server';

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
 * one would reintroduce the defect.
 *
 * AUTHORIZATION STAYS WITH THE DATABASE — but it can no longer be a side effect
 * of who signs. 0066 revokes the authenticated SELECT grant on the bucket,
 * because while it stood any viewer could call `createSignedUrl(path, 86400)`
 * themselves and this route's server-decided lifetime was a suggestion. With the
 * grant gone the caller's own client cannot mint at all, so the mint moves to
 * service role and the read decision is asked EXPLICITLY, first, through
 * `media_read_window` — a definer function that still evaluates as the caller
 * and carries the same audience, expiry and block rules the dropped policies
 * did. Signing with service role WITHOUT that call would hand a URL to anyone
 * who reached the route; the two halves are one change.
 *
 * ONE CALL ANSWERS BOTH QUESTIONS, and that is deliberate. This route used to
 * decide "may you read it?" and "for how long?" from different sources: the
 * lifetime came from every live destination the SERVICE ROLE could see. That
 * set is not the caller's — a viewer authorised through a story with two
 * minutes left could be handed a window borrowed from a destination they cannot
 * read at all. `media_read_window` returns the window of the references that
 * actually authorise THIS caller, so the two can no longer disagree.
 */
export const runtime = 'nodejs';

type ReadWindow = { readable: boolean; expires_at: string | null };

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
    // Service role, because this is only a mediaId -> object-key lookup. It
    // grants nothing: the read decision below is made against the caller.
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

    const storagePath = media.storage_path as string;

    // THE AUTHORIZATION CALL. Asked on the CALLER's client so the definer
    // function sees the real `auth.uid()`, and asked BEFORE anything is minted.
    // A refusal is reported as not_found, not forbidden: whether a given media
    // id exists is itself audience information.
    const window = await readWindow(callerClient(env, token), storagePath);
    if (!window.readable) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const signed = await mintSignedMediaUrl(admin, storagePath, window.expires_at);

    if (!signed.ok) {
      // 'denied' covers "no grantable lifetime remains". Neither it nor an
      // outage distinguishes itself to the client, and neither renders a
      // decorative placeholder.
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

/**
 * May this caller read this object, and until when?
 *
 * FAILS CLOSED. An RPC error, a missing row, or a thrown request all resolve to
 * unreadable. This is the only thing standing between a service-role mint and
 * the whole bucket, so "the lookup broke" must never resolve to "allowed" — the
 * same rule `isBlockedBetween` follows for the same reason.
 */
async function readWindow(
  caller: ReturnType<typeof callerClient>,
  storagePath: string,
): Promise<ReadWindow> {
  const closed: ReadWindow = { readable: false, expires_at: null };
  try {
    const { data, error } = await caller.rpc('media_read_window', {
      p_name: storagePath,
    });
    if (error) {
      console.error('[media/url] read window failed:', error.message);
      return closed;
    }
    // A set-returning function comes back as an array of rows.
    const row = (Array.isArray(data) ? data[0] : data) as ReadWindow | null | undefined;
    if (!row || row.readable !== true) return closed;
    return { readable: true, expires_at: row.expires_at ?? null };
  } catch {
    return closed;
  }
}
