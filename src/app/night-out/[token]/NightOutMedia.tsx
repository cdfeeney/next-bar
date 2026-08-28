'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import {
  describeNightOutMediaWindow,
  isNightOutMediaLive,
  type NightOutMediaItem,
} from '@/lib/nightOutMedia';
import {
  addNightOutMedia,
  archiveNightOut,
  fetchNightOutMedia,
} from '@/lib/nightOutMedia/server';

/**
 * The Night Out recap's photos, and the two things the contract says you may do
 * with them (V8-R-NO-008, V8-R-NO-009).
 *
 * THE WINDOW IS THE SERVER'S. `get_night_out_media` stops returning rows 24
 * hours after the night's scheduled start, and `add_night_out_media` refuses a
 * write past it. Nothing here gates on the device clock: V8-R-NO-008's failure
 * clause is "a skewed device clock must not hide media the server still serves",
 * and the mirror of it — that a skewed clock must not SHOW media the server has
 * stopped serving — only holds if the server is the one filtering. The local
 * check below decides which SENTENCE to render, never which photos.
 *
 * THE WINDOW IS ALSO STATED IN WORDS, which V8-R-NO-008 requires under
 * accessibility. A time limit nobody is told about is a deletion.
 *
 * ARCHIVING IS PRIVATE AND PER-ACCOUNT (V8-R-NO-009). Each participant archives
 * to THEIR OWN Saved Nights Out; there is no shared album and no link. A failed
 * archive says so rather than reporting a save — "a failed archive must not
 * report success, and must not consume the window."
 */
export default function NightOutMedia({
  planId,
  night,
  canParticipate,
}: {
  planId: string;
  /** The plan's night key. The window is measured from ITS 4:00 AM start. */
  night: string;
  /**
   * False for a pending, declined or settled plan. A non-participant may not
   * add a photo — offering the control anyway produces "that didn't go
   * through" on a tap that could never have succeeded.
   */
  canParticipate: boolean;
}): JSX.Element {
  const [items, setItems] = useState<NightOutMediaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedNightId, setSavedNightId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const windowOpen = isNightOutMediaLive(night);
  const windowWords = describeNightOutMediaWindow(night);

  const refresh = useCallback(async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      // Unconfigured client is a FAILED read, not an empty night.
      setItems(null);
      setLoading(false);
      return;
    }
    setItems(await fetchNightOutMedia(supabase, planId));
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Upload the bytes, then attach them. Two steps because they are two
   * decisions: `/api/media/upload` re-encodes and registers the object, and
   * `add_night_out_media` decides whether this caller may attach it to this
   * plan right now. Attaching cannot be folded into the upload — the route says
   * so itself, and an object that exists without a destination is exactly the
   * upload-before-publish window the media boundary already handles.
   */
  const addPhoto = useCallback(
    async (file: File): Promise<void> => {
      if (busy) return;
      const supabase = getBrowserSupabase();
      if (supabase === null) {
        setNotice("That didn't save — try again in a moment.");
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setNotice("That didn't save — try again in a moment.");
          return;
        }

        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body,
        });
        const uploaded = response.ok
          ? ((await response.json()) as { ok?: unknown; mediaId?: unknown })
          : null;
        if (!uploaded || uploaded.ok !== true || typeof uploaded.mediaId !== 'string') {
          setNotice("That photo didn't upload — try again in a moment.");
          return;
        }

        // THE ATTACH IS THE STEP THAT CAN BE REFUSED, and its refusal is
        // reported rather than assumed away: the window may have closed between
        // opening this page and picking the file.
        const attached = await addNightOutMedia(supabase, planId, uploaded.mediaId);
        if (attached === null) {
          setNotice(
            "That photo didn't get added — this night's photo window may have closed.",
          );
          return;
        }
        await refresh();
      } catch {
        setNotice("That photo didn't upload — try again in a moment.");
      } finally {
        setBusy(false);
        // Let the same file be picked again after a failure.
        if (fileRef.current !== null) fileRef.current.value = '';
      }
    },
    [busy, planId, refresh],
  );

  const archive = useCallback(async (): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setNotice("That didn't save — try again in a moment.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await archiveNightOut(supabase, planId);
    if (result === null) {
      // NEVER REPORT A SAVE THAT DID NOT HAPPEN.
      setNotice("That didn't save to your archive — try again in a moment.");
    } else if (result.photoCount === 0) {
      // A REAL ARCHIVE WITH NOTHING IN IT is a different answer from a failure,
      // and saying "saved" here would be a claim about photos that are gone.
      setSavedNightId(result.savedNightId);
      setNotice(
        'There were no photos left to save — this night is in your archive with none.',
      );
    } else {
      setSavedNightId(result.savedNightId);
      setNotice(
        `Saved ${result.photoCount} ${result.photoCount === 1 ? 'photo' : 'photos'} to your Saved Nights Out.`,
      );
    }
    setBusy(false);
  }, [busy, planId]);

  return (
    <section className="mt-8" data-testid="night-out-media">
      <h2 className="font-semibold">Photos</h2>

      {/* The window, in words, whichever side of it we are on. */}
      {windowWords !== null ? (
        <p className="mt-1 text-xs opacity-60" data-testid="night-out-media-window">
          {windowOpen
            ? windowWords
            : 'This night’s photo window has closed. Saved nights keep theirs.'}
        </p>
      ) : null}

      <MediaList loading={loading} items={items} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canParticipate && windowOpen ? (
          <>
            {/* The platform's own picker. `capture` asks a phone for the
                camera and is ignored elsewhere, so one control serves both
                without a second code path. */}
            <input
              ref={fileRef}
              id="night-out-add-photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addPhoto(file);
              }}
              className="sr-only"
            />
            <label
              htmlFor="night-out-add-photo"
              data-testid="night-out-add-photo"
              className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-5 text-sm touch-manipulation"
            >
              {busy ? 'Working…' : 'Add a photo'}
            </label>
          </>
        ) : null}

        {/* ARCHIVING STAYS AVAILABLE FOR AS LONG AS THERE IS SOMETHING TO
            ARCHIVE. V8-R-NO-009 says a participant may archive "before its
            24-hour window closes", so the control goes with the window rather
            than with the plan being open — a settled plan's photos are still
            worth keeping. */}
        {windowOpen && (items?.length ?? 0) > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void archive()}
            data-testid="night-out-archive"
            className="inline-flex min-h-[44px] items-center rounded-full border px-5 text-sm touch-manipulation disabled:opacity-60"
          >
            Save to my Saved Nights Out
          </button>
        ) : null}
      </div>

      {notice !== null ? (
        <p className="mt-2 text-sm opacity-70" role="status" data-testid="night-out-media-notice">
          {notice}
        </p>
      ) : null}

      {/* THE PRIVATE DESTINATION IS NAMED IN WORDS AND REACHABLE. V8-R-NO-009
          requires the destination be named; a name with no way to get there is
          half a promise. */}
      {savedNightId !== null ? (
        <Link
          href={`/nights/${savedNightId}`}
          data-testid="night-out-open-archive"
          className="mt-2 inline-flex min-h-[44px] items-center text-sm underline underline-offset-4 touch-manipulation"
        >
          Open it in Saved Nights Out
        </Link>
      ) : null}
    </section>
  );
}

/**
 * The three states, in one place so no caller can render "no photos yet" for a
 * read that failed.
 */
function MediaList({
  loading,
  items,
}: {
  loading: boolean;
  items: NightOutMediaItem[] | null;
}): JSX.Element {
  if (loading) {
    return (
      <p className="mt-3 text-sm opacity-60" role="status">
        Loading photos…
      </p>
    );
  }

  if (items === null) {
    return (
      <p
        className="mt-3 text-sm opacity-60"
        role="status"
        data-testid="night-out-media-error"
      >
        Couldn&apos;t load this night&apos;s photos. Try again in a moment.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="mt-3 text-sm opacity-60" data-testid="night-out-media-empty">
        No photos yet.
      </p>
    );
  }

  return (
    <ul className="mt-3 grid grid-cols-3 gap-2" data-testid="night-out-media-list">
      {items.map((item) => (
        <li key={item.destinationId}>
          <MediaThumb
            mediaId={item.mediaId}
            alt=""
            className="aspect-square w-full rounded-lg"
          />
        </li>
      ))}
    </ul>
  );
}
