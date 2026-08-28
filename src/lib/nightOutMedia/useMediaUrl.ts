'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

/**
 * Resolve one media id to a signed URL, THROUGH THE BOUNDARY ROUTE.
 *
 * `/api/media/:mediaId/url` is the path that asks `media_read_window` — the one
 * function that knows a Night Out membership and a Saved Nights Out archive hold
 * are grounds to read (migration 0068, section 7). Signing straight off Storage
 * the way `stories.server.ts` still does would lean on the legacy bucket SELECT
 * policies, which know only about stories: a participant would be refused their
 * own Night Out's photos, and an archived photo whose author later deleted it
 * everywhere would stop loading even though its retention hold is exactly what
 * keeps the bytes alive.
 *
 * IT ALSO MEANS THE LIFETIME IS THE SERVER'S. The route accepts no `expiresIn`
 * and caps the signed URL at whatever the media itself has left, so a Night Out
 * URL cannot outlive its 24-hour window (V8-R-NO-008) however long the page
 * stays open.
 *
 * THREE STATES, kept apart on purpose: 'loading' is not 'gone'. A surface that
 * renders the missing-photo state while the request is still in flight flickers
 * a deletion at the viewer on every mount.
 */
export type MediaUrlState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'gone' };

export function useMediaUrl(mediaId: string | null): MediaUrlState {
  const [state, setState] = useState<MediaUrlState>({ status: 'loading' });

  useEffect(() => {
    if (mediaId === null) {
      setState({ status: 'gone' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      const url = await signedUrlFor(mediaId);
      if (cancelled) return;
      setState(url === null ? { status: 'gone' } : { status: 'ready', url });
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  return state;
}

/**
 * Null on ANY failure — no session, an outage, a refusal, a malformed body.
 *
 * Deliberately undifferentiated. Whether a given media id exists is itself
 * audience information, which is why the route answers 404 for a refusal too;
 * repeating that decision here rather than surfacing the distinction keeps the
 * client from leaking what the server took care not to say.
 */
async function signedUrlFor(mediaId: string): Promise<string | null> {
  const supabase = getBrowserSupabase();
  if (supabase === null) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;

    const response = await fetch(
      `/api/media/${encodeURIComponent(mediaId)}/url`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; url?: unknown };
    if (body?.ok !== true || typeof body.url !== 'string') return null;
    return body.url;
  } catch {
    return null;
  }
}
