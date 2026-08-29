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
 * A second past the boundary, so the server has unambiguously crossed it by its
 * own clock when we ask; the floor for a boundary this device thinks is ALREADY
 * BEHIND IT, which is what such a boundary waits instead of never arming at
 * all; and the longest single wait before the timer re-arms.
 */
const BOUNDARY_GRACE_MS = 1_000;
const MIN_RECHECK_MS = 60_000;
const MAX_REARM_MS = 6 * 60 * 60 * 1_000;
/**
 * How much CLOCK SKEW the approach tolerates — and, therefore, how long before
 * a boundary this device believes is still ahead we start asking every minute.
 *
 * Waiting an "ahead" boundary exactly is only right if the two clocks agree. On
 * a device running ten minutes SLOW the server crosses first, starts serving
 * media and accepting the writes, and this recap goes on hiding both controls
 * for the whole skew because its own timer is not due yet (round-10 round 7,
 * Codex). The behind case already had a floor for the disagreement; this is the
 * same tolerance on the other side.
 *
 * IT IS A WINDOW, NOT A CAP (round-10 round 8, both lanes). Round 7 wrote
 * `Math.min(delay, 60_000)`, which does not mean "notice the boundary a minute
 * late" — it means "ask again every minute, forever". The media window can be
 * open for 24 hours and a future plan sits days ahead, so a left-open recap
 * re-ran both its RPCs 1,440 times a day and the plan page re-ran five, while
 * the comment right here claimed at most one extra read per approach. That
 * sentence was false and the cost was real.
 *
 * A skew tolerance has to be a stated number rather than an unbounded one, so
 * here it is: ten minutes, the figure round 7's own trigger named. Inside the
 * window we ask every minute.
 *
 * OUTSIDE IT WE HALVE, RATHER THAN SLEEP THROUGH (round-10 round 9, Codex).
 * Round 8 waited the whole way to the window's edge in one go, which made the
 * tolerance a CONSTANT: a device thirty minutes slow was told the window was
 * still twenty-one minutes off, slept, and hid media the server had already
 * begun serving for twenty of those minutes. V8-R-NO-008's failure clause — "a
 * skewed device clock must not hide media the server still serves" — is written
 * with no bound at all, and nothing of bounded cost can satisfy it literally,
 * because only a poll notices an arbitrarily wrong clock arbitrarily fast.
 *
 * What halving buys is the right SHAPE: the lag at the true crossing is at most
 * half the remaining wait, so it scales with the error instead of ignoring it,
 * and it costs a logarithmic number of reads. A 24-hour window is about fifteen
 * reads rather than 1,440; a ten-minute skew is caught inside the window at a
 * minute; a thirty-minute skew is caught in roughly fifteen. The residual gap —
 * a very large skew is still noticed late, not immediately — is REPORTED to the
 * operator rather than closed here, because closing it means either restoring
 * the poll round 8 filed as a defect or having the server return its own clock,
 * and choosing between those is a product decision, not a reviewer's.
 */
const SKEW_TOLERANCE_MS = 10 * 60_000;

/**
 * When to ask the server again about a boundary only the server owns.
 *
 * THE FLOOR IS FOR THE DISAGREEMENT CASE ONLY (round-9 panel). It used to be
 * `Math.max(delay, MIN_RECHECK_MS)`, which reads as "never poll faster than
 * once a minute" and behaves as "never notice a boundary sooner than a minute":
 * a window opening or expiring five seconds from now was re-read after sixty,
 * so Add-a-photo and Archive stayed on the wrong side of the server's own
 * instant for about fifty-four seconds. A boundary still AHEAD is waited for
 * exactly. A boundary already behind cannot change its answer until the
 * server's clock catches up, so there the floor is right.
 *
 * AND A BOUNDARY AHEAD IS NOT WAITED INDEFINITELY EITHER (round-10 round 7,
 * Codex). "Waited exactly" is correct only when the clocks agree; on a slow
 * device the server crosses first and this surface stays on the wrong side for
 * the whole skew. The approach therefore opens `SKEW_TOLERANCE_MS` before the
 * boundary and asks every minute inside it, which makes the tolerance
 * symmetric without turning the timer into a permanent poll (round-10 round 8 —
 * see that constant; the previous shape polled for the entire ahead period).
 *
 * The plan page carries the same rule for its voting deadline. One shared
 * module would be better and is not available: `src/lib/` outside
 * `nightOutMedia/` is another lane's write scope, and round 8 fixing one copy
 * while leaving the other is exactly what a shared module would have
 * prevented. Recorded rather than silently duplicated.
 */
function clampRecheck(delayMs: number): number {
  if (delayMs <= 0) return MIN_RECHECK_MS;
  const wait =
    delayMs > SKEW_TOLERANCE_MS
      ? // Outside the approach window: HALVE the remaining wait rather than
        // sleeping through it. See `SKEW_TOLERANCE_MS` — this is what makes the
        // detection lag proportional to the skew instead of capped at a
        // constant, and it costs a logarithmic number of reads rather than one
        // a minute.
        Math.min(delayMs - SKEW_TOLERANCE_MS, Math.ceil(delayMs / 2))
      : // Inside it: a minute, or the exact remaining time when that is sooner,
        // so a boundary five seconds away is still not re-read after sixty.
        Math.min(delayMs, MIN_RECHECK_MS);
  return Math.min(wait, MAX_REARM_MS);
}

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
  // Bumped by the boundary timer itself, so the next one is armed whether or
  // not the answer that came back was different. See the effect below.
  const [boundaryTick, setBoundaryTick] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Null = we could not read the window. Deliberately NOT folded into a boolean:
  // "closed", "not yet" and "unknown" render differently and gate differently.
  const windowOpen = mediaWindow?.isOpen === true;
  /**
   * ARCHIVING OUTLIVES A CANCELLATION, ATTACHING DOES NOT.
   *
   * `add_night_out_media` refuses a cancelled plan; `archive_night_out` does
   * not, and deliberately so — the night happened, its photos are still inside
   * their window, and keeping them is the one thing a cancellation must not
   * take away. `isOpen` now carries the cancellation (round-5 panel, Claude
   * gate), so the two controls read different things rather than sharing one
   * flag that is wrong for one of them.
   */
  const canArchiveWindow =
    mediaWindow?.state === 'open' || mediaWindow?.state === 'cancelled';
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
  /**
   * WHICH READ IS NEWER — the epoch cannot say, and now something must.
   *
   * Round-10 round 8, Codex. The epoch only separates PLANS; two reads of the
   * SAME plan share it, so the later one wins on screen only if it also lands
   * later. The boundary timer makes that ordinary rather than exotic: it issues
   * a read as the window closes while an earlier one is still stalled, the new
   * `closed` paints, then the old `open` lands and passes the epoch guard —
   * putting Add-a-photo and Archive back after expiry, where every tap is
   * refused by the server. Reads are numbered on issue and a response older
   * than the newest one already painted is dropped.
   */
  const readSeq = useRef(0);
  const paintedSeq = useRef(0);
  /**
   * Has this plan's window EVER been read successfully?
   *
   * It separates "we have never known which side we are on" from "we knew, and
   * then a read failed" — states the `null` window collapses into one. Only the
   * second is a regression worth re-asking about; see the boundary effect.
   */
  const hadWindow = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    const startedAt = epoch.current;
    readSeq.current += 1;
    const seq = readSeq.current;
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
    if (startedAt !== epoch.current || seq <= paintedSeq.current) return;
    paintedSeq.current = seq;
    if (nextWindow !== null) hadWindow.current = true;
    setItems(nextItems);
    setMediaWindow(nextWindow);
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    // Synchronously, before `refresh` captures it: any read still in flight
    // belongs to the plan that is leaving.
    epoch.current += 1;
    // The new plan's window has never been read, whatever we knew about the
    // previous one — so a null here is "not yet", not "we lost it".
    hadWindow.current = false;
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
   * THE WINDOW RE-ASKS ITSELF WHEN IT TURNS (round-6 panel, Codex, MEDIUM).
   *
   * The window was read once per plan and once per successful attach, so a page
   * left open across a boundary kept whichever side it had loaded on: opened at
   * 8:59 PM it stayed 'before' past the 9 PM start and never offered Add-a-photo
   * or Archive until a reload, and one left open past the expiry went on
   * offering both for a write the server would refuse.
   *
   * THE DEVICE CLOCK ONLY DECIDES WHEN TO ASK AGAIN. It never decides which
   * side we are on — that is still `night_out_media_window`'s answer, which is
   * the whole point of reading a window instead of a deadline (V8-R-NO-008).
   *
   * A BOUNDARY ALREADY BEHIND THIS DEVICE STILL ARMS (round-7 panel, both
   * lanes). Round 7 returned without a timer whenever `at <= Date.now()`, on
   * the reasoning that a skew costs "at most one early round trip". It does
   * not: nothing else re-reads the window while the recap sits on the 'before'
   * side, because both controls are hidden there and there is no action to
   * refresh from. A clock running fast — or merely a response that arrives
   * after its own boundary, which needs no skew at all, just latency — left the
   * recap stranded on the stale side for the whole session, hiding Add-a-photo,
   * Archive and every photo the server was serving. That is the exact harm
   * V8-R-NO-008's failure clause names.
   *
   * So a boundary always arms, and `MIN_RECHECK_MS` is the floor FOR THAT CASE
   * ONLY. The cost of disagreement is one read a minute WHILE the server and
   * this device disagree, which ends the moment the server crosses: the next
   * answer names a different side, and its boundary is hours away.
   *
   * A BOUNDARY STILL AHEAD IS WAITED FOR EXACTLY (round-9 panel). The floor was
   * applied to every delay, so a window opening or expiring five seconds from
   * now was re-read after sixty — leaving Add-a-photo and Archive unavailable,
   * or still offered, for the best part of a minute past the server's own
   * boundary. See `clampRecheck` above for why the same rule is spelled out
   * again on the plan page rather than shared.
   *
   * A CANCELLED PLAN HAS A BOUNDARY TOO (round-7 panel, Codex). Only 'before'
   * and 'open' armed, so a cancelled plan — whose archive control deliberately
   * stays live until the window closes — went on offering "this can still be
   * saved" past `expiresAt`, for an archive the server refuses. Past that
   * instant the server reports 'closed', so asking again is all it takes.
   *
   * Far-future boundaries are re-armed in six-hour steps rather than handed to
   * `setTimeout` whole, which silently fires immediately past ~24.8 days.
   */
  useEffect(() => {
    if (mediaWindow === null) {
      // A WINDOW WE COULD NOT READ IS NOT A WINDOW THAT DOES NOT EXIST
      // (round-10 round 9, Codex). This returned, on the reasoning that an
      // unreadable window has no instant to arm from — true of the FIRST read,
      // and false of every one after it. A single transport blip on a boundary
      // refresh replaced a known window with null, disarmed the timer, and
      // nothing re-read it again: both controls and every photo the server was
      // about to serve stayed gone until a reload. That is the same
      // stranded-on-the-stale-side harm V8-R-NO-008's failure clause names,
      // reached through a failed read rather than a skewed clock.
      //
      // There is no instant to wait for, so it asks again on the floor — the
      // disagreement rate — until an answer arrives. An answer that names a
      // side arms its own boundary and this branch stops running.
      // Only once a side has actually been known. A window that was null on
      // the FIRST read is the case this branch used to be written for and it
      // stays as it was: nothing has ever named an instant, so there is nothing
      // to recover to and no reason to poll.
      if (!hadWindow.current) return;
      const timer = setTimeout(() => {
        setBoundaryTick((n) => n + 1);
        void refresh();
      }, MIN_RECHECK_MS);
      return () => clearTimeout(timer);
    }
    const boundary =
      mediaWindow.state === 'before'
        ? mediaWindow.opensAt
        : mediaWindow.state === 'open' || mediaWindow.state === 'cancelled'
          ? mediaWindow.expiresAt
          : null;
    // 'closed' is settled: there is no later instant that changes the answer.
    if (boundary === null) return;
    const at = Date.parse(boundary);
    if (!Number.isFinite(at)) return;
    const timer = setTimeout(() => {
      // THE RE-ARM IS EXPLICIT, not a side effect of the answer changing. This
      // effect used to depend on `mediaWindow` alone, so a second read that
      // returned the SAME window — which is the whole disagreement case, where
      // the server has not crossed yet — produced no new state, no re-render,
      // and no next timer. One retry, then silence, in exactly the situation
      // that needs to keep asking.
      setBoundaryTick((n) => n + 1);
      void refresh();
    }, clampRecheck(at - Date.now() + BOUNDARY_GRACE_MS));
    return () => clearTimeout(timer);
  }, [mediaWindow, boundaryTick, refresh]);

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
        {canArchiveWindow && (items?.length ?? 0) > 0 ? (
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
    case 'cancelled':
      // The reason matters: blaming the clock for a cancellation tells the
      // member to wait for a window that is not coming back.
      return 'This night out was cancelled, so no more photos can be added. What’s here can still be saved.';
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
