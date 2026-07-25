'use client';

/**
 * TonightSuggestions — "Where should we go?" nominations (migration 0011).
 *
 * Members of your circle can SUGGEST specific bars for tonight, alongside
 * the algorithmic consensus. Night-scoped (NYC 6am rollover via
 * nycNightKey); suggesters render as the identity pair (name or @handle —
 * never email). Server-mode only: the consensus page mounts this for
 * signed-in users with a real circle.
 *
 * Cap UX: suggest_bar declines past 3/night — surfaced as an inline
 * message, not a silent no-op.
 */

import { useCallback, useEffect, useState } from 'react';
import BarPicker from '@/components/BarPicker';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBarById } from '@/lib/catalog';
import { formatGoingList } from '@/lib/goingList';
import { nycNightKey } from '@/lib/nightKey';
import {
  fetchCircleSuggestions,
  suggestBar,
  unsuggestBar,
  type CircleSuggestion,
} from '@/lib/suggestions.server';
import {
  fetchCircleRsvps,
  rsvpBar,
  unrsvpBar,
  type CircleRsvp,
} from '@/lib/rsvps.server';
import type { Bar } from '@/types';

type Grouped = {
  bar: Bar;
  suggesters: Array<{ userId: string; label: string; isYou: boolean }>;
  /** Who's IN at this bar tonight ("You" first). */
  going: Array<{ userId: string; label: string; isYou: boolean }>;
};

export default function TonightSuggestions(): JSX.Element | null {
  const auth = useAuth();
  const [suggestions, setSuggestions] = useState<CircleSuggestion[] | null>(
    null,
  );
  const [rsvps, setRsvps] = useState<CircleRsvp[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const night = nycNightKey();

  const refresh = useCallback(async () => {
    if (auth.status !== 'signed-in') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const [rows, rsvpRows] = await Promise.all([
      fetchCircleSuggestions(supabase, night),
      fetchCircleRsvps(supabase, night),
    ]);
    if (getCacheEpoch() !== epoch) return;
    if (rows === null) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setSuggestions(rows);
    // RSVP load failure degrades quietly by KEEPING the previous rows
    // (Opus review: overwriting with [] would blank every going-list and
    // falsely flip the user's own "I'm in ✓" — a transient read error
    // must not misreport their commitment).
    setRsvps((prev) => rsvpRows ?? prev);
  }, [auth.status, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (auth.status !== 'signed-in') return null;

  const you = auth.user.id;
  const personLabel = (p: { userId: string; displayName: string | null; handle: string | null }) =>
    p.userId === you ? 'You' : (p.displayName ?? (p.handle ? `@${p.handle}` : 'A friend'));

  const grouped: Grouped[] = [];
  for (const s of suggestions ?? []) {
    const bar = getBarById(s.barId);
    if (!bar) continue; // unknown/retired catalog id — never render
    const existing = grouped.find((g) => g.bar.id === s.barId);
    const suggester = { userId: s.userId, label: personLabel(s), isYou: s.userId === you };
    if (existing) existing.suggesters.push(suggester);
    else grouped.push({ bar, suggesters: [suggester], going: [] });
  }
  for (const r of rsvps) {
    const entry = grouped.find((g) => g.bar.id === r.barId);
    // Friends' RSVPs only render on suggested bars; YOUR own orphaned
    // RSVP gets an escape-hatch row below (Opus review: the toggle is the
    // only un-RSVP affordance — if the suggestion is withdrawn you'd be
    // stuck "in" at a bar with no way out).
    if (!entry) continue;
    entry.going.push({ userId: r.userId, label: personLabel(r), isYou: r.userId === you });
  }
  for (const g of grouped) {
    g.going.sort((a, b) => Number(b.isYou) - Number(a.isYou)); // "You" first
  }
  // Most-IN first, then most-backed.
  grouped.sort(
    (a, b) => b.going.length - a.going.length || b.suggesters.length - a.suggesters.length,
  );
  const ownCount = (suggestions ?? []).filter((s) => s.userId === you).length;
  const yourRsvpBarId = rsvps.find((r) => r.userId === you)?.barId ?? null;
  // Your RSVP on a bar nobody suggests anymore — needs its own way out.
  const orphanedRsvpBar =
    yourRsvpBarId !== null && !grouped.some((g) => g.bar.id === yourRsvpBarId)
      ? getBarById(yourRsvpBarId)
      : null;

  // busy is held THROUGH the refresh in all three write handlers (Opus
  // review HIGH): releasing it before the refetch lands re-enables the
  // buttons while derived state (yourRsvpBarId especially) is stale — a
  // second tap in that window would branch to the WRONG operation. The
  // hold also prevents overlapping refreshes racing each other's setState.
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
          ownCount >= 3
            ? "You've already suggested 3 bars tonight — remove one to swap."
            : "Couldn't save that suggestion — try again in a moment.",
        );
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (barId: string): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await unsuggestBar(supabase, you, barId, night);
      if (!ok) {
        setNotice("Couldn't remove that — try again in a moment.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRsvp = async (barId: string): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      // Tapping your current bar = "I'm out"; anywhere else = move there
      // (rsvp_bar's server-side single-RSVP semantics).
      const ok =
        yourRsvpBarId === barId
          ? await unrsvpBar(supabase, barId, night)
          : await rsvpBar(supabase, barId, night);
      if (!ok) {
        setNotice("Couldn't update your RSVP — try again in a moment.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted">
          Tonight&apos;s suggestions
        </h2>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-50"
        >
          + Suggest a bar
        </button>
      </div>

      {loadFailed ? (
        <p className="text-muted text-xs leading-relaxed">
          Couldn&apos;t load tonight&apos;s suggestions — pull to refresh or
          try again in a moment.
        </p>
      ) : suggestions === null ? (
        // Distinct loading branch (Opus review): rendering the empty-state
        // copy before the first fetch lands reads as "no suggestions" and
        // then pops — say nothing meaningful instead.
        <p className="text-muted text-xs">Loading…</p>
      ) : grouped.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          Nobody&apos;s pitched a spot for tonight yet. Know where you wanna
          go? Suggest it and your circle will see it here.
        </p>
      ) : (
        <ul aria-label="Tonight's suggestions" className="space-y-3">
          {grouped.map(({ bar, suggesters, going }) => {
            const youAreIn = yourRsvpBarId === bar.id;
            return (
              <li
                key={bar.id}
                className="bg-surface border border-border rounded-3xl p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base truncate">{bar.name}</p>
                    <p className="text-muted text-xs mt-0.5 truncate">
                      {bar.neighborhood} · suggested by{' '}
                      {suggesters.map((s) => s.label).join(', ')}
                    </p>
                    {going.length > 0 ? (
                      <p className="text-xs mt-1">
                        <span className="text-accent" aria-hidden="true">● </span>
                        {formatGoingList(going.map((g) => g.label))}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleRsvp(bar.id)}
                      disabled={busy}
                      aria-pressed={youAreIn}
                      aria-label={`I'm in at ${bar.name}`}
                      className={[
                        'font-display text-xs px-4 py-2 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 border transition-colors',
                        youAreIn
                          ? 'bg-accent text-bg border-accent'
                          : 'bg-transparent text-accent border-accent/40 hover:border-accent',
                      ].join(' ')}
                    >
                      {youAreIn ? "I'm in ✓" : "I'm in"}
                    </button>
                    {suggesters.some((s) => s.isYou) ? (
                      <button
                        type="button"
                        onClick={() => void handleRemove(bar.id)}
                        disabled={busy}
                        aria-label={`Remove your suggestion of ${bar.name}`}
                        className="text-muted text-xs underline-offset-4 hover:underline min-h-[36px] touch-manipulation disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {orphanedRsvpBar ? (
        <div className="mt-3 flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl p-4">
          <p className="text-muted text-xs min-w-0 truncate">
            You&apos;re still in at{' '}
            <span className="text-text">{orphanedRsvpBar.name}</span> — the
            suggestion was withdrawn.
          </p>
          <button
            type="button"
            onClick={() => void handleToggleRsvp(orphanedRsvpBar.id)}
            disabled={busy}
            className="text-accent text-xs font-display underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0 disabled:opacity-50"
          >
            I&apos;m out
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="text-accent text-xs mt-3" role="status">
          {notice}
        </p>
      ) : null}

      {pickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Suggest a bar"
          className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
        >
          <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-8 min-h-0">
            <header className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-2xl leading-tight">
                Suggest a bar
              </h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
              >
                Close
              </button>
            </header>
            <div className="flex-1 overflow-y-auto min-h-0">
              <BarPicker onPick={(bar) => void handlePick(bar)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
