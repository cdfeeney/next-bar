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
 * FOUR STATES, kept apart on purpose.
 *
 * 'loading' is not 'gone': a surface that renders the missing-photo state while
 * the request is still in flight flickers a deletion at the viewer on every
 * mount.
 *
 * AND 'unavailable' IS NOT 'gone' EITHER (round-4 panel, Codex). Every failure
 * used to collapse into 'gone', so a dropped connection or a 503 told the owner
 * of a SAVED night that their photo no longer exists — about bytes a retention
 * hold is deliberately keeping alive (V8-R-NO-009), with no way to retry. The
 * server's 404 is the only authoritative "you cannot read this", and it stays
 * undifferentiated on purpose: the route answers 404 for a refusal too, so that
 * whether a given media id exists is not leaked. Everything else is the network
 * having a bad moment, and says so.
 */
export type MediaUrlState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  /** The server said no — deleted, or not ours to read. Terminal. */
  | { status: 'gone' }
  /** We could not ask. Temporary, and retryable. */
  | { status: 'unavailable'; retry: () => void };

export function useMediaUrl(mediaId: string | null): MediaUrlState {
  const [state, setState] = useState<MediaUrlState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mediaId === null) {
      setState({ status: 'gone' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      const result = await signedUrlFor(mediaId);
      if (cancelled) return;
      if (result.kind === 'ok') {
        setState({ status: 'ready', url: result.url });
      } else if (result.kind === 'gone') {
        setState({ status: 'gone' });
      } else {
        setState({
          status: 'unavailable',
          retry: () => setAttempt((n) => n + 1),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `attempt` is the retry trigger: bumping it re-runs this effect.
  }, [mediaId, attempt]);

  return state;
}

/**
 * THE SERVER'S ANSWER, or the absence of one.
 *
 * 'gone' is reserved for a 404 — the route's own undifferentiated "no", which
 * covers both a deleted object and one this caller may not read, and which is
 * deliberately the same answer so the client cannot tell them apart. A missing
 * session is 'gone' too: an unauthenticated caller has no grounds to read
 * anything and retrying changes nothing until they sign in.
 *
 * Everything else — a thrown fetch, a 5xx, a 401 from an expired token, a body
 * we cannot parse — is 'unreachable': we did not get an answer, so we must not
 * report one.
 */
type SignedUrlResult =
  | { kind: 'ok'; url: string }
  | { kind: 'gone' }
  | { kind: 'unreachable' };

async function signedUrlFor(mediaId: string): Promise<SignedUrlResult> {
  const supabase = getBrowserSupabase();
  if (supabase === null) return { kind: 'unreachable' };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: 'gone' };

    const response = await fetch(
      `/api/media/${encodeURIComponent(mediaId)}/url`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) return { kind: 'gone' };
    if (!response.ok) return { kind: 'unreachable' };
    const body = (await response.json()) as { ok?: unknown; url?: unknown };
    if (body?.ok !== true || typeof body.url !== 'string') {
      return { kind: 'unreachable' };
    }
    return { kind: 'ok', url: body.url };
  } catch {
    return { kind: 'unreachable' };
  }
}
