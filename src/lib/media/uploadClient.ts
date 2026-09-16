'use client';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * S-06c — upload one image through the media boundary, from the browser.
 *
 * `POST /api/media/upload` is the ONLY way bytes reach the media bucket: it
 * re-encodes, registers the object under the caller's prefix and returns the
 * registry id. This is the same call NightOutMedia and GroupThread make inline;
 * the cover picker is the third caller, so the shape lives here once.
 *
 * ponytail: the two older inline copies can adopt this when they are next touched.
 */
export type UploadResult =
  | { kind: 'ok'; mediaId: string }
  | { kind: 'too_large' }
  | { kind: 'failed' };

export async function uploadImageThroughBoundary(
  supabase: SupabaseClient,
  file: File,
): Promise<UploadResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: 'failed' };
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (response.status === 413) return { kind: 'too_large' };
    if (!response.ok) return { kind: 'failed' };
    const json = (await response.json().catch(() => null)) as
      | { ok?: unknown; mediaId?: unknown }
      | null;
    if (!json || json.ok !== true || typeof json.mediaId !== 'string') return { kind: 'failed' };
    return { kind: 'ok', mediaId: json.mediaId };
  } catch {
    return { kind: 'failed' };
  }
}
