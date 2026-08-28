'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import {
  describeNightOutMediaOpening,
  describeNightOutMediaWindow,
  type NightOutMediaItem,
  type NightOutMediaWindow,
} from '@/lib/nightOutMedia';
import {
  addNightOutMedia,
  archiveNightOut,
  fetchNightOutMedia,
  fetchNightOutMediaWindow,
} from '@/lib/nightOutMedia/server';

/**
 * The Night Out recap's photos, and the two things the contract says you may do
 * with them (V8-R-NO-008, V8-R-NO-009).
 *
 * THE WINDOW IS THE SERVER'S, INCLUDING THE ANSWER TO "IS IT OPEN?".
 * `get_night_out_media` stops returning rows 24 hours after the plan's
 * scheduled start and `add_night_out_media` refuses a write past it — but rows
 * alone cannot tell "no photos yet" from "the window has closed", so this
 * component used to recompute the boundary from the DEVICE clock to decide
 * which sentence to show and whether to offer its two controls.
 *
 * That is what V8-R-NO-008's failure clause forbids: "a skewed device clock must
 * not hide media the server still serves". A phone running fast hid Add-a-photo
 * and Archive while the server would still have honoured both. Round 2 replaces
 * the local arithmetic with `night_out_media_window`, which answers from the
 * DATABASE's clock. Nothing here compares instants any more.
 *
 * A WINDOW WE COULD NOT READ IS NOT A CLOSED ONE. When the window read fails
 * the controls stay hidden and the surface says it could not check — it never
 * offers an action it cannot stand behind, and never asserts the window closed.
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
  canAddPhoto,
}: {
  planId: string;
  /**
   * Whether this viewer is an ACCEPTED member — the only thing
   * `add_night_out_media` and `archive_night_out` check besides the window.
   *
   * NOT the plan's own open/settled state (round 2, Codex gate). This used to
   * receive the page's `canParticipate`, which also requires the plan to be
   * draft or open because suggesting and voting close when a bar is decided.
   * Photos do not: a locked plan is a night that is ABOUT to happen, and the
   * server authorizes its members throughout the media window. Reusing the
   * suggestion predicate hid Add-a-photo from every accepted member the moment
   * the plan was decided.
   */
  canAddPhoto: boolean;
}): JSX.Element {
  const [items, setItems] = useState<NightOutMediaItem[] | null>(null);
  const [mediaWindow, setMediaWindow] = useState<NightOutMediaWindow | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedNightId, setSavedNightId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Null = we could not read the window. Deliberately NOT folded into a boolean:
  // "closed", "not yet" and "unknown" render differently and gate differently.
  const windowOpen = mediaWindow?.isOpen === true;
  const windowWords = describeWindow(mediaWindow);

  /**
   * WHICH PLAN'S READS MAY PAINT (round-4 panel, Claude gate).
   *
   * This component is mounted unkeyed, and Next reuses it across
   * `/night-out/A` → `/night-out/B` without remounting — the same reuse the
   * page's `viewEpoch` and InvitePreview's `epoch` were added for. `refresh`
   * painted unconditionally after its awaits, so A's photos and A's window
   * state landed under B and stayed there: a stale 'open' offers Add-a-photo
   * and Archive the server will refuse, and a stale 'closed' hides controls it
   * would have honoured.
   */
  const epoch = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const startedAt = epoch.current;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      // Unconfigured client is a FAILED read, not an empty night.
      setItems(null);
      setMediaWindow(null);
      setLoading(false);
      return;
    }
    // One round trip each, in parallel: the window decides what may be DONE,
    // the rows decide what is SHOWN, and neither derives the other.
    const [nextItems, nextWindow] = await Promise.all([
      fetchNightOutMedia(supabase, planId),
      fetchNightOutMediaWindow(supabase, planId),
    ]);
    if (startedAt !== epoch.current) return;
    setItems(nextItems);
    setMediaWindow(nextWindow);
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    // Synchronously, before `refresh` captures it: any read still in flight
    // belongs to the plan that is leaving.
    epoch.current += 1;
    // ...and so does what is on screen. Back to loading rather than to another
    // plan's photos.
    setItems(null);
    setMediaWindow(null);
    setLoading(true);
    setNotice(null);
    setSavedNightId(null);
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

      {/* The window, in words, on whichever side of it the SERVER says we are.
          A window we could not read says exactly that — it does not guess a
          side, because both guesses are claims we have no evidence for. */}
      {loading ? null : mediaWindow === null ? (
        <p
          className="mt-1 text-xs opacity-60"
          role="status"
          data-testid="night-out-media-window-unknown"
        >
          Couldn&apos;t check this night&apos;s photo window.
        </p>
      ) : (
        <p className="mt-1 text-xs opacity-60" data-testid="night-out-media-window">
          {windowWords}
        </p>
      )}

      <MediaList loading={loading} items={items} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canAddPhoto && windowOpen ? (
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
 * The window in words, on whichever of the SERVER's three sides we are on.
 *
 * Round 3 (Codex gate): the window now has a lower bound, so a closed one and
 * one that has not opened yet are different answers and get different sentences.
 * The side is `mediaWindow.state` — decided by the database — and never a
 * comparison made here; that is the whole point of reading a window instead of a
 * deadline. A sentence we cannot build (an unparseable instant) falls back to
 * the state's own plain wording rather than to a blank line.
 */
function describeWindow(mediaWindow: NightOutMediaWindow | null): string | null {
  if (mediaWindow === null) return null;
  switch (mediaWindow.state) {
    case 'before':
      return (
        describeNightOutMediaOpening(mediaWindow.opensAt) ??
        'Photos open when this night starts.'
      );
    case 'open':
      return (
        describeNightOutMediaWindow(mediaWindow.expiresAt) ??
        'Photos from this night are open now.'
      );
    case 'closed':
      return 'This night’s photo window has closed. Saved nights keep theirs.';
    default: {
      const exhaustive: never = mediaWindow.state;
      return exhaustive;
    }
  }
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
