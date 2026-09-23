'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MAX_LOAD_MS,
  WIDGET_LOAD_TIMEOUT_MS,
  isPlacesUiKitConfigured,
  isRuntimeGoogleMediaEnabled,
  loadPlacesUiKit,
  markRequested,
} from '@/lib/placesUiKit';

/**
 * The compliant photo surface: Google's own Places UI Kit web component renders
 * the photo, so we never receive, store or re-host the bytes.
 *
 * This is the replacement for `public/bar-photos/` — 3,435 photo files
 * downloaded from Google, re-encoded and served from our domain, which Google's
 * Places policy does not permit (only `place_id` is exempt from its caching
 * restrictions). See docs/UI-KIT-BUILD-PLAN.md.
 *
 * COST. Each component request is one billable event ($1.00/1,000, first 10,000
 * per month free) regardless of how much content it renders, so the only lever
 * is issuing fewer requests. Two behaviours here do that work:
 *
 *   - Lazy mount. The widget is not created until the card scrolls into view, so
 *     a long result list bills for what the user actually reaches, not for
 *     everything rendered.
 *   - Keep mounted. Once created it is never torn down on scroll. A destroyed
 *     widget has nothing to show, so remounting necessarily refetches and
 *     rebills — re-mount amplification is what turns a ~$140/month bill into
 *     ~$590 at the same traffic.
 *
 * ⚠️ CONSTRAINT ON THE CALLER, and this component cannot enforce it (santa-loop
 * round 2): "keep mounted" only holds if the PARENT keeps it mounted. A
 * virtualized or windowed list that unmounts off-screen cards defeats it
 * entirely and re-bills on every scroll pass. Before wiring this into a list
 * surface, confirm that surface does not recycle rows — and if it must, hide
 * with CSS (`content-visibility`) rather than unmounting.
 *
 * The elements are built imperatively rather than in JSX. They are custom
 * elements with no React typings, and more importantly this keeps the moment of
 * creation — the billable moment — explicit and in one place.
 */

type GooglePlacePhotoProps = {
  /** Google place_id. The only Google value we are permitted to retain. */
  placeId: string;
  /**
   * False on surfaces criterion 12 excludes (pickers, saved lists, recaps,
   * dense maps, markers). Defence in depth: those surfaces should not render
   * this component at all, so the SDK never reaches their bundle.
   */
  allowed?: boolean;
  className?: string;
  /**
   * Rendered whenever a photo cannot be shown. Never a broken tile.
   *
   * ⚠️ MUST NOT be a legacy Google photo. The natural-looking choice — "fall
   * back to the copy already on our server" — would serve a re-hosted Google
   * file on every widget failure, so the compliance migration would only LOOK
   * complete: the non-compliant path would have moved into the failure branch.
   * Derive this from `resolveFallbackMedia()` in mediaPolicy.ts, which forces
   * both Google tiers off and can only return owned media or the glyph.
   * (Flagged by GLM during /review-routed.)
   */
  fallback: ReactNode;
  /** Fires once when a billable request is actually issued. For the meter. */
  onBillableRequest?: (placeId: string) => void;
  /**
   * Which surface is billing ('result-card', 'bar-lightbox'). Spend without a
   * surface breakdown cannot say which migration step caused a bill spike.
   */
  surface?: string;
  /** Lightbox only: also ask the widget for its open-now line (same one request). */
  openNowStatus?: boolean;
};

/**
 * 'late' = a load deadline passed while the SDK or widget was still on its
 * way. The fallback shows, but the host STAYS MOUNTED (hidden) and the
 * pending load keeps running: on a phone the first band's cards routinely
 * outlast MAX_LOAD_MS while the Maps SDK downloads behind the catalog and
 * travel fetches, and giving up for good there is exactly why the owner saw
 * no photos on Walkable and photos on the band tapped ten seconds later
 * (staging, 2026-09-18, reproduced throttled at 750 kbps). 'unavailable' is
 * the hard no: no key, flag off, empty placeId, SDK refused.
 */
type Status = 'pending' | 'ready' | 'unavailable' | 'late';

export default function GooglePlacePhoto({
  placeId,
  allowed = true,
  className,
  fallback,
  onBillableRequest,
  surface,
  openNowStatus = false,
}: GooglePlacePhotoProps) {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const builtRef = useRef(false);
  /**
   * Identity inputs of the attempt currently represented by `builtRef`.
   *
   * Compared FIELD BY FIELD, deliberately. A delimiter-joined string
   * normalized `surface: undefined` and `surface: ''` to the same key while
   * the dependency array below treats them as different — so that pair could
   * re-run the effect (cleanup cancelling the in-flight build) without
   * resetting `builtRef`, and the new run would return at the `builtRef`
   * guard, leaving neither a widget nor a fallback. Matching the dependency
   * array's own equality removes the mismatch. (santa: Codex round 3.)
   */
  const inputsRef = useRef<{
    placeId: string;
    allowed: boolean;
    surface: string | undefined;
    openNowStatus: boolean;
  } | null>(null);
  const [status, setStatus] = useState<Status>('pending');

  /**
   * The billing callback is held in a ref and deliberately NOT an effect
   * dependency.
   *
   * It was a dependency until Codex review of 0f614b8 found this: callers pass
   * an inline arrow, so its identity changes every render, which re-ran the
   * effect. Cleanup set `cancelled` and cleared the timeout, the re-run bailed
   * immediately on `builtRef`, and every in-flight async path then no-opped — so
   * nothing ever moved `status` off 'pending' and the user was left staring at
   * an empty reserved box with neither a photo nor the fallback. Stabilising the
   * dependency list removes the trigger entirely.
   */
  const onBillableRequestRef = useRef(onBillableRequest);
  useEffect(() => {
    onBillableRequestRef.current = onBillableRequest;
  });

  useEffect(() => {
    /**
     * Reset ONLY when the identity inputs actually changed.
     *
     * `hostEl` is an effect dependency (see the bottom of this effect), so
     * this body also re-runs purely because the host div attached or
     * detached. Resetting `builtRef` on those runs would let the SAME card
     * build a second widget — a duplicated billable event.
     */
    const prev = inputsRef.current;
    if (
      prev === null ||
      prev.placeId !== placeId ||
      prev.allowed !== allowed ||
      prev.surface !== surface ||
      prev.openNowStatus !== openNowStatus
    ) {
      inputsRef.current = { placeId, allowed, surface, openNowStatus };
      builtRef.current = false;
      setStatus('pending');
      hostEl?.replaceChildren();
    }

    if (!allowed || !placeId || !isPlacesUiKitConfigured()) {
      setStatus('unavailable');
      return;
    }

    /**
     * The host is tracked in STATE, not just a ref, so this effect re-runs
     * when the div actually attaches.
     *
     * With a plain ref this was a permanent dead end (santa: Codex, High):
     * once an attempt hit 'unavailable', the fallback rendered and the host
     * unmounted (a 'late' attempt now keeps its host — see Status above).
     * A later `placeId` change — which happens if a parent ever reconciles
     * cards by position rather than identity; ResultsView.tsx:387 currently
     * keys by `bar.id`, so this path is defensive today — re-ran this effect
     * while `hostRef.current` was still null, so it returned before
     * installing an observer, a timer, or a build. `setStatus('pending')`
     * then mounted the host on the NEXT render, but the dependencies had not
     * changed again, so nothing ever ran: an empty pending box with no
     * widget, no fallback, no name and no Maps link, forever. Depending on
     * the node makes the attach itself the trigger.
     */
    const host = hostEl;
    if (!host) return;

    // Already built for these inputs — an attach/detach re-run must not
    // start a second attempt.
    if (builtRef.current) return;

    let cancelled = false;
    /**
     * There is deliberately no "gave up" latch any more. A deadline flips the
     * card to 'late' (fallback visible, host kept mounted and hidden) and the
     * attempt carries on: a late SDK still builds the widget, a late
     * `gmp-load` still reveals it. The old latch turned every slow first
     * paint into a permanent glyph, and the host stayed attached the whole
     * time, so a late widget now lands in a real box, never a detached node.
     * `cancelled` (effect cleanup) is still the only abandonment.
     */
    let timer: number | undefined;
    const late = () => {
      if (!cancelled) setStatus((s) => (s === 'ready' ? s : 'late'));
    };

    const build = async () => {
      // StrictMode double-invokes effects in development. Without this guard
      // that is a duplicated billable request per card, every render.
      if (builtRef.current || cancelled) return;
      builtRef.current = true;

      // Arm the safety timer BEFORE awaiting the loader.
      //
      // It used to be armed only after the await, so if loadPlacesUiKit() never
      // settled nothing downstream ran and the card sat on 'pending' forever —
      // an empty box with neither photo nor fallback. The loader is bounded now
      // too, but a component must not depend on a collaborator's internal
      // timing for its own liveness: whatever happens below, this guarantees the
      // user sees something. (santa-loop round 3.)
      timer = window.setTimeout(late, MAX_LOAD_MS);

      // Server permission gate — consulted per widget CREATION, before the
      // SDK is even loaded. Fail-closed: unreachable flags mean no request.
      // Note the gate's VALUE is per-deployment on Vercel (env changes need
      // a new deployment); the immediate spend stop is the Google-side
      // quota cap, not this flag. See docs/GOOGLE-MEDIA-RUNBOOK.md.
      const runtimeOk = await isRuntimeGoogleMediaEnabled();
      if (cancelled) return;
      if (!runtimeOk) {
        window.clearTimeout(timer);
        setStatus('unavailable');
        return;
      }

      const ok = await loadPlacesUiKit();
      if (cancelled) return;
      if (!ok) {
        window.clearTimeout(timer);
        setStatus('unavailable');
        return;
      }

      // COMPACT, not the full element. Live Staging measurement at 390x844
      // (2026-08-06): the full <gmp-place-details> laid out at 340x365 inside
      // a 145.7px host, so everything below Google's header — the media AND
      // the attribution — was clipped away. Clipping Google's attribution is
      // a policy violation, not a cosmetic bug. The compact variant is sized
      // for a card and renders photo + attribution + one Maps action in the
      // space a result card actually has.
      const details = document.createElement('gmp-place-details-compact');

      const request = document.createElement('gmp-place-details-place-request');
      request.setAttribute('place', placeId);

      const config = document.createElement('gmp-place-content-config');

      const media = document.createElement('gmp-place-media');
      media.setAttribute('lightbox-preferred', '');

      // Attribution lives HERE, not in each consumer. Google treats missing
      // attribution as a policy violation, and making every surface remember it
      // is how one eventually forgets.
      const attribution = document.createElement('gmp-place-attribution');
      attribution.setAttribute('light-scheme-color', 'gray');
      attribution.setAttribute('dark-scheme-color', 'white');

      if (openNowStatus) {
        config.append(document.createElement('gmp-place-open-now-status'));
      }
      config.append(media, attribution);
      details.append(request, config);

      details.addEventListener('gmp-load', () => {
        // A late load is still a load: the widget has content, so it replaces
        // the fallback whenever it lands.
        if (cancelled) return;
        window.clearTimeout(timer);
        setStatus('ready');
      });

      // Hand the budget over from the load phase to the widget phase: the
      // pre-await timer above has done its job once we get here.
      window.clearTimeout(timer);
      timer = window.setTimeout(late, WIDGET_LOAD_TIMEOUT_MS);

      // Appending is the billable moment — record it here and nowhere else.
      //
      // Fires on EVERY creation, not only the first sighting of a place_id.
      // Google bills per widget created, so two cards sharing one googlePlaceId
      // (the Fleming's/Dominie's collision 0028 resolves) bill twice;
      // de-duplicating the callback would silently undercount real spend.
      // Belt and braces before the billable moment. Today no `await` sits
      // between the last guard and this line, so a timer cannot interleave
      // and this can never be true — but the append and the two meter calls
      // below are the one place money is spent, and a future refactor that
      // introduces an await above would silently start billing for widgets
      // that were already abandoned. (santa: DeepSeek round 3, Q3.)
      if (cancelled) return;

      host.appendChild(details);
      markRequested(placeId, surface);
      onBillableRequestRef.current?.(placeId);
    };

    // Lazy mount. IntersectionObserver is absent in some test environments;
    // fall back to building immediately rather than never showing a photo.
    if (typeof IntersectionObserver === 'undefined') {
      // Deferred by a microtask so StrictMode's synchronous double-invoke
      // cannot strand the card. Calling build() inline let run 1 claim
      // `builtRef` before its first await; cleanup then cancelled that build,
      // and run 2 — whose inputs had not changed, so `builtRef` was never
      // reset — returned at the `builtRef` guard. Nothing built and nothing
      // set 'unavailable': an empty pending box. Deferring lets the cleanup
      // land first, so the cancelled attempt returns without claiming the
      // guard. (santa: Claude/FABLE round 3.)
      queueMicrotask(() => void build());
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void build();
        }
      },
      // Start slightly before the card is visible so the photo is there by the
      // time the user reaches it, without prefetching the whole list.
      { rootMargin: '200px' },
    );
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // Only the identity inputs (placeId, allowed, surface, openNowStatus) and
    // the host node. Re-running this effect can issue a
    // billable request, so it must never be triggered by unrelated prop churn
    // — see the stuck-'pending' bug documented on onBillableRequestRef above.
    // `surface` is static per callsite; if it ever genuinely changed, the
    // widget belongs to a different billing context and SHOULD rebuild.
  }, [placeId, allowed, surface, openNowStatus, hostEl]);

  if (status === 'unavailable') return <>{fallback}</>;

  // 'late': the fallback is what the user sees, but the host stays in the
  // tree (hidden) so the attempt in flight has somewhere real to land.
  return (
    <>
    {status === 'late' ? fallback : null}
    <div
      ref={setHostEl}
      data-testid="google-place-photo"
      data-status={status}
      hidden={status === 'late'}
      // NEVER clip, and never impose a fixed height on a loaded widget.
      //
      // This used to be `aspect-[16/9] overflow-hidden`, which reserved a
      // tidy box and then CUT OFF everything Google rendered past it —
      // including the attribution (measured live: 365px of content in a
      // 145.7px box). A reservation that truncates the provider's required
      // credit is worse than a little layout shift.
      //
      // So: while PENDING, reserve the SAME 16/9 strip the fallback and the
      // loaded card use; once the widget is READY, the container takes its
      // natural height and the content decides.
      //
      // The reservation used to be `min-h-[146px]` — a number that matched
      // nothing. The fallback renders `aspect-[16/9]`, which is ~153px at a
      // 358px card and ~170px at 398px, so every degradation moved the card
      // by a different amount at every width. Reserving the ratio instead of
      // a magic height makes pending and fallback identical at ALL widths,
      // which is what "the aspect ratio holds and does not collapse or jump
      // during load" actually requires (g-65ba768e criterion 4).
      //
      // `aspect-[16/9]` sets height from width without capping it: once the
      // status flips to 'ready' the class is dropped entirely, so a tall
      // widget still expands freely and nothing is clipped (the 145.7-vs-365
      // regression google-photo-layout.spec.ts pins).
      // COMPOSED, not replaced. `className` used to override this outright,
      // so any future caller passing so much as a margin utility would have
      // silently dropped BOTH guarantees above — the pending reservation
      // (criterion 4) and the no-clip/no-fixed-height ready state that keeps
      // Google's attribution visible. No caller passes it today, which is
      // exactly why the footgun would have gone unnoticed until it fired.
      // (santa: Claude/FABLE M-2.)
      className={[
        'w-full',
        status === 'pending' ? 'aspect-[16/9]' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
    </>
  );
}
