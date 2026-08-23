'use client';

/**
 * Social → Tonight, per `docs/design-reference/approved/next-bar-social-v2-core.png`
 * (screen 1B, "friend-status-first").
 *
 * The approved read of this block, in the canvas's own words: "Tonight =
 * current awareness. Every status is manual and attributed to a person, never
 * to a device. Presence leads with the bar itself and carries Pinned on the
 * timestamp line." So the list is PERSON-first — avatar, name, the bar they
 * backed — and `Pin my spot` is the screen's single accent fill.
 *
 * The data is the one that already exists: `get_circle_suggestions` (migration
 * 0011), the same night-scoped rows the People's Choice board reads. Nothing
 * here is stubbed and no second store was invented for it.
 *
 * NOT built here, deliberately: the STORIES rail above the list. It belongs to
 * the story/capture lane (`g-f1e128da`), which owns `src/components/story/**`
 * and inherits this route afterwards. Drawing a rail with no story pipeline
 * behind it would be the stub this goal's criterion 11 forbids.
 */

import { useCallback, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import { SuggestBarDialog } from '@/components/TonightSuggestions';
import { useAuth } from '@/hooks/useAuth';
import { useIntent, useNightRefresh } from '@/hooks/useIntent';
import { getBarById } from '@/lib/catalog';
import { nycNightKey } from '@/lib/nightKey';
import { announcePresenceChanged } from './usePinnedHandles';
import { useBars } from '@/lib/useBars';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import {
  fetchCircleSuggestions,
  suggestBar,
  unsuggestBar,
  type CircleSuggestion,
} from '@/lib/suggestions.server';
import type { Bar } from '@/types';

/** How many bars one account may back in a night (migration 0011's cap). */
const NIGHTLY_PIN_CAP = 3;

type PresenceRow = {
  key: string;
  userId: string;
  name: string;
  initials: string;
  bar: Bar;
  isYou: boolean;
};

function initialsFor(name: string): string {
  return name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function nameFor(row: CircleSuggestion): string {
  return row.displayName ?? (row.handle !== null ? `@${row.handle}` : 'Someone');
}

/**
 * Suggestion rows → presence rows. Unknown/retired catalog ids are dropped
 * rather than rendered as a blank line (the People's Choice board's rule).
 */
function toPresenceRows(
  rows: readonly CircleSuggestion[],
  youId: string | null,
): PresenceRow[] {
  const presence: PresenceRow[] = [];
  for (const row of rows) {
    const bar = getBarById(row.barId);
    if (!bar) continue;
    const isYou = youId !== null && row.userId === youId;
    const name = isYou ? 'You' : nameFor(row);
    presence.push({
      key: `${row.userId}-${row.barId}`,
      userId: row.userId,
      name,
      initials: initialsFor(name),
      bar,
      isYou,
    });
  }
  // Your own pin leads — it is the row the CTA below acts on.
  return presence.sort((a, b) => Number(b.isYou) - Number(a.isYou));
}

export default function TonightPresence(): JSX.Element {
  // 0019 swap-day rule: the presence rows are getBarById lookups — subscribe
  // so a live server-catalog swap re-renders them (checklist in catalog.ts).
  useBars();
  const auth = useAuth();
  const isSignedIn = auth.status === 'signed-in';
  const youId = isSignedIn ? auth.user.id : null;

  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));

  const [suggestions, setSuggestions] = useState<CircleSuggestion[] | null>(
    null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setSuggestions(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const rows = await fetchCircleSuggestions(supabase, night);
    // An account switch mid-flight must not land another account's circle.
    if (getCacheEpoch() !== epoch) return;
    if (rows === null) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setSuggestions(rows);
  }, [isSignedIn, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = toPresenceRows(suggestions ?? [], youId);
  const yourPins = rows.filter((row) => row.isYou);

  /**
   * `aria-disabled`, not `disabled`, while a write is in flight: a disabled
   * button loses focus to <body>, and the picker hands focus back to its
   * opener on close. The guard below is what actually prevents a double
   * write. (Same treatment the lightbox's want-to-go action carries.)
   */
  const handlePick = async (bar: Bar): Promise<void> => {
    setPickerOpen(false);
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await suggestBar(supabase, bar.id, night);
      if (!ok) {
        setNotice(
          yourPins.length >= NIGHTLY_PIN_CAP
            ? `You can pin ${NIGHTLY_PIN_CAP} spots a night — unpin one to switch.`
            : "Couldn't pin that spot — try again in a moment.",
        );
        return;
      }
      await refresh();
      // The Stories rail reads the same rows through its own hook. Only a
      // CONFIRMED write announces, so a refused pin never moves a badge.
      announcePresenceChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleUnpin = async (barId: string): Promise<void> => {
    if (busy || youId === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await unsuggestBar(supabase, youId, barId, night);
      if (!ok) {
        setNotice("Couldn't unpin that — try again in a moment.");
        return;
      }
      await refresh();
      announcePresenceChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="friends-tonight" aria-labelledby="tonight-heading">
      <h2
        id="tonight-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Out tonight
      </h2>

      {!isSignedIn ? (
        <p className="text-muted text-sm leading-relaxed">
          Sign in to see who&apos;s out and pin your own spot.
        </p>
      ) : loadFailed ? (
        <p className="text-muted text-sm leading-relaxed" role="status">
          Couldn&apos;t load tonight — try again in a moment.
        </p>
      ) : suggestions === null ? (
        <p className="text-muted text-sm" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted text-sm leading-relaxed">
          Nobody&apos;s pinned a spot yet.
        </p>
      ) : (
        <ul className="bg-surface border border-border rounded-3xl overflow-hidden divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-3">
              <Avatar initials={row.initials} seed={row.userId} size="md" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-base truncate">{row.name}</p>
                <p className="text-sm truncate text-text">▲ {row.bar.name}</p>
                {/* The state is spelled out, never carried by the accent
                    alone (locked contract: no state by color alone). */}
                <p className="text-[11px] uppercase tracking-widest text-accent">
                  Pinned
                </p>
              </div>
              {row.isYou ? (
                <button
                  type="button"
                  onClick={() => void handleUnpin(row.bar.id)}
                  aria-disabled={busy}
                  aria-label={`Unpin ${row.bar.name}`}
                  className="shrink-0 min-h-[44px] touch-manipulation px-4 rounded-full border border-border text-muted font-display text-sm hover:text-text transition-colors aria-disabled:opacity-50"
                >
                  Unpin
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {isSignedIn ? (
        <>
          {/* The screen's ONE accent fill (the canvas is explicit that the
              reassurance line under it is deleted and the button stands
              alone). */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-disabled={busy}
            className="mt-4 w-full bg-accent text-bg rounded-2xl px-5 py-4 font-display text-lg touch-manipulation min-h-[44px] hover:bg-accentDim transition-colors aria-disabled:opacity-50"
          >
            Pin my spot
          </button>
          <SuggestBarDialog
            open={pickerOpen}
            busy={busy}
            onClose={() => setPickerOpen(false)}
            onPick={(bar) => void handlePick(bar)}
          />
        </>
      ) : null}

      {notice ? (
        <p className="text-accent text-xs mt-3" role="status">
          {notice}
        </p>
      ) : null}

      <YourStatus />
    </section>
  );
}

/**
 * Your going-out status: one tap sets, tapping the lit pill clears.
 *
 * The approved Tonight screen draws friends' statuses but no control for your
 * own — because in the canvas a pin IS the status. This control stays: intent
 * is a live local data flow (`useIntent`, night-scoped, F5 rollover) and
 * criterion 11 preserves the Tonight flows rather than dropping them. It sits
 * BELOW the accent CTA so the canvas's one-primary-action rule still reads.
 */
function YourStatus(): JSX.Element {
  const { intent, toggleIntent } = useIntent();
  const pill = (
    status: 'going' | 'maybe' | 'not-going',
    label: string,
  ): JSX.Element => {
    const active = intent?.status === status;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => toggleIntent(status)}
        className={[
          'min-h-[44px] touch-manipulation px-5 rounded-full font-display text-sm border transition-colors',
          active
            ? 'bg-transparent border-accent text-accent'
            : 'bg-transparent border-border text-muted hover:text-text',
        ].join(' ')}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      className="flex items-center gap-2 mt-4"
      role="group"
      aria-label="Your status tonight"
    >
      {pill('going', 'Going out')}
      {pill('maybe', 'Maybe')}
      {pill('not-going', 'Not tonight')}
    </div>
  );
}
