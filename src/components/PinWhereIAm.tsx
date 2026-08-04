'use client';

/**
 * PinWhereIAm — explicit venue check-in ("Pin where I am", g-31f36bf8).
 *
 * NOT background tracking (criterion 16): presence exists ONLY when the
 * user explicitly pins a bar, and it expires at 6:00 AM America/New_York
 * (the canonical social-night end — src/lib/socialNight.ts).
 *
 * PRIVACY (criteria 4–5): on-device geolocation may RANK the nearby
 * list below, but coordinates never leave the device — the only thing
 * written to the server is a catalog bar id + night key (pins.server.ts
 * pins that contract at the RPC-argument level). Audience is MUTUAL
 * friends only, enforced server-side by get_friend_pins (draft 0038);
 * this component renders whatever that definer returns and adds no
 * client-side audience logic of its own.
 *
 * Server-mode + signed-in only: pins are a shared surface; local mode
 * has no server to share through, so the component renders nothing.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import BarPicker from '@/components/BarPicker';
import PinConfirmDialog from '@/components/PinConfirmDialog';
import { useAuth } from '@/hooks/useAuth';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { setSessionPinnedBarId } from '@/lib/pinSignal';
import { useGeolocation } from '@/hooks/useGeolocation';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBarById, getBarsSnapshot } from '@/lib/catalog';
import { haversineMiles } from '@/lib/distance';
import { useNightRefresh } from '@/hooks/useIntent';
import {
  SOCIAL_NIGHT_END_LABEL,
  relativeTimeLabel,
  socialNightKey,
} from '@/lib/socialNight';
import {
  fetchFriendPins,
  pinVenue,
  unpinVenue,
  type FriendPin,
} from '@/lib/pins.server';
import type { Bar, Coords } from '@/types';

const NEARBY_COUNT = 5;

/** On-device only: rank catalog bars by distance to the device fix. */
function nearbyBars(coords: Coords, count: number): Bar[] {
  return [...getBarsSnapshot()]
    .sort(
      (a, b) => haversineMiles(coords, a) - haversineMiles(coords, b),
    )
    .slice(0, count);
}

export default function PinWhereIAm(): JSX.Element | null {
  const auth = useAuth();
  const geo = useGeolocation();
  // Rows are stored WITH their owning account (round-3 scoped review,
  // Fable + Codex lanes, converged): on a direct A→B account switch the
  // clear-effect runs a render too late, so every consumer must gate on
  // the owner at READ time — one account's presence can never render or
  // sync under another.
  const [pins, setPins] = useState<{
    owner: string;
    rows: FriendPin[];
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmBar, setConfirmBar] = useState<Bar | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [night, setNight] = useState(() => socialNightKey());
  useNightRefresh(() => setNight(socialNightKey()));

  const signedIn = auth.status === 'signed-in';
  const userId = signedIn ? auth.user.id : null;
  // Monotonic per-mount token: a slow older refresh must never land on
  // top of a newer one (round-3 review, Codex lane) — the cache epoch
  // alone can't order two fetches from the same session.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const seq = refreshSeq.current + 1;
    refreshSeq.current = seq;
    const rows = await fetchFriendPins(supabase, night);
    if (getCacheEpoch() !== epoch || refreshSeq.current !== seq) return;
    // A stale closure fetching for a night that has since rolled over
    // must not land (round-3 scoped review): its rows belong to an
    // ended night, and the new-night refresh owns the state now.
    if (socialNightKey() !== night) return;
    if (rows === null) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    if (userId === null) return;
    setPins({ owner: userId, rows });
  }, [signedIn, userId, night]);

  // Account transitions drop the rows outright as well (belt and
  // braces with the render-time owner check).
  useEffect(() => {
    setPins(null);
    setLoadFailed(false);
  }, [userId]);

  // Server truth → shared session pin state, so every ImHereButton on
  // other surfaces agrees with what the definer actually returned.
  // OWNER-GATED (round-3 scoped review HIGH): this is a writer into the
  // shared store, and a same-flush stale closure pairing account A's
  // rows with account B's userId must never produce a phantom write.
  useEffect(() => {
    if (pins === null || userId === null || pins.owner !== userId) return;
    setSessionPinnedBarId(
      pins.rows.find((p) => p.userId === userId)?.barId ?? null,
    );
  }, [pins, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!signedIn || getBrowserSupabase() === null) return null;

  // READ-time owner gate: rows fetched for a different account render
  // as "not loaded", never as data.
  const ownedRows =
    pins !== null && pins.owner === userId ? pins.rows : null;
  const yourPin = ownedRows?.find((p) => p.userId === userId) ?? null;
  const yourPinBar = yourPin ? getBarById(yourPin.barId) : undefined;
  const friendPins = (ownedRows ?? []).filter(
    (p) => p.userId !== userId && getBarById(p.barId) !== undefined,
  );

  const failNotice = (): void => {
    setNotice(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? "You look offline — your pin wasn't saved. Try again when you're back."
        : "Couldn't update your pin — try again in a moment.",
    );
  };

  const handleConfirmPin = async (bar: Bar): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await pinVenue(supabase, bar.id, night);
      // Close the overlays on BOTH outcomes: the failure notice renders
      // in the section, and leaving a fullscreen picker above it would
      // hide the only explanation of what went wrong (e2e caught this).
      setConfirmBar(null);
      setPickerOpen(false);
      if (!ok) {
        failNotice();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleUnpin = async (): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await unpinVenue(supabase, night);
      if (!ok) {
        failNotice();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const nearby =
    pickerOpen && geo.coords !== null ? nearbyBars(geo.coords, NEARBY_COUNT) : [];

  return (
    <div className="mt-4" data-testid="pin-where-i-am">
      {/* YOUR pin state — one card, or the entry button. */}
      {yourPin && yourPinBar ? (
        <div className="bg-surface border border-border rounded-3xl p-4">
          <p className="text-sm">
            You&apos;re at{' '}
            <span className="font-display text-accent">{yourPinBar.name}</span>{' '}
            <span className="text-muted text-xs">
              until {SOCIAL_NIGHT_END_LABEL}
            </span>
          </p>
          <div className="flex items-center gap-4 mt-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              className="text-accent text-xs font-display underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => void handleUnpin()}
              disabled={busy}
              className="text-muted text-xs font-display underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-50"
            >
              Unpin
            </button>
          </div>
        </div>
      ) : loadFailed ? (
        <p className="text-muted text-xs leading-relaxed">
          Couldn&apos;t load pins — try again in a moment.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy || ownedRows === null}
          className="w-full bg-surface border border-border rounded-3xl px-4 py-3 min-h-[44px] touch-manipulation text-accent font-display text-sm hover:border-accent transition-colors disabled:opacity-50"
        >
          📍 Pin where I am
        </button>
      )}

      {/* FRIENDS' presence — whatever the mutual-only definer returned. */}
      {friendPins.length > 0 ? (
        <ul aria-label="Friends out tonight" className="space-y-2 mt-3">
          {friendPins.map((p) => {
            const bar = getBarById(p.barId);
            if (!bar) return null;
            const who = p.displayName ?? (p.handle ? `@${p.handle}` : 'A friend');
            return (
              <li
                key={p.userId}
                className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl px-4 py-3"
              >
                <span className="text-sm truncate min-w-0">
                  <span className="font-display">{who}</span>{' '}
                  <span className="text-muted">is at</span>{' '}
                  <span className="font-display text-accent">{bar.name}</span>
                </span>
                <span className="text-muted text-xs shrink-0">
                  {relativeTimeLabel(p.pinnedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {notice ? (
        <p className="text-accent text-xs mt-3" role="status">
          {notice}
        </p>
      ) : null}

      {/* Bar picker overlay (TonightSuggestions dialog pattern). */}
      {pickerOpen ? (
        <PickerShell
          onClose={() => {
            setPickerOpen(false);
            setConfirmBar(null);
          }}
        >
            <header className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-2xl leading-tight">
                Pin where I am
              </h2>
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setConfirmBar(null);
                }}
                className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
              >
                Close
              </button>
            </header>

            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Nearby — ranked ON-DEVICE; coordinates never leave the
                  browser. Optional: skipping location entirely still
                  works via search below. */}
              {geo.coords === null ? (
                <button
                  type="button"
                  onClick={geo.request}
                  disabled={geo.state.status === 'requesting'}
                  className="w-full mb-4 bg-surface border border-border rounded-2xl px-4 py-3 min-h-[44px] touch-manipulation text-sm text-muted hover:border-accent transition-colors disabled:opacity-50"
                >
                  {geo.state.status === 'requesting'
                    ? 'Finding nearby bars…'
                    : geo.state.status === 'denied' ||
                        geo.permissionState === 'denied'
                      ? 'Location is off — search below instead'
                      : 'Show nearby bars (location stays on your phone)'}
                </button>
              ) : nearby.length > 0 ? (
                <div className="mb-5">
                  <h3 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-2">
                    Nearby
                  </h3>
                  <ul className="space-y-2" aria-label="Nearby bars">
                    {nearby.map((bar) => (
                      <li key={bar.id}>
                        <button
                          type="button"
                          onClick={() => setConfirmBar(bar)}
                          className="w-full text-left bg-surface border border-border rounded-2xl px-4 py-3 min-h-[44px] touch-manipulation hover:border-accent transition-colors"
                        >
                          <span className="font-display text-sm">{bar.name}</span>
                          <span className="text-muted text-xs block">
                            {bar.neighborhood}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <BarPicker onPick={(bar) => setConfirmBar(bar)} />
            </div>

          {/* Confirmation — names bar, audience, and expiration
              (criterion 6). Rendered above the picker; the dialog
              stack in useDialogA11y makes Escape close ONLY this. */}
          {confirmBar ? (
            <PinConfirmDialog
              bar={confirmBar}
              busy={busy}
              onConfirm={() => void handleConfirmPin(confirmBar)}
              onCancel={() => setConfirmBar(null)}
            />
          ) : null}
        </PickerShell>
      ) : null}
    </div>
  );
}

/**
 * The fullscreen picker sheet, carrying the house dialog contract
 * (useDialogA11y: focus steal, Escape close, Tab trap, scroll lock,
 * opener restore — round-1 review HIGH, Fable lane). Bottom padding
 * respects the home-indicator safe area.
 */
function PickerShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dialogRef, onClose);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Pin where I am"
      className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
    >
      <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] min-h-0">
        {children}
      </div>
    </div>
  );
}
