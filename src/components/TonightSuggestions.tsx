'use client';

/**
 * TonightSuggestions — "Where should we go?" nominations (migration 0011).
 *
 * QA3 (operator): a clean TABULAR poll. Each People's Choice row is
 * photo tile + bar name + ▲ vote tally toggle — nothing else. The vote
 * keeps suggest_bar/unsuggest semantics (un-voting your own suggestion
 * withdraws it). RSVP ("I'm in") is gone from this surface; the ONE
 * remaining RSVP affordance is the stranded-RSVP escape row, because
 * without it a pre-existing RSVP would have no way out.
 *
 * Night-scoped (NYC 6am rollover via nycNightKey). Server-mode only: the
 * consensus page mounts this for signed-in users with a real circle.
 *
 * Cap UX: suggest_bar declines past 3/night — surfaced as an inline
 * message, not a silent no-op.
 */

import { useCallback, useEffect, useState } from 'react';
import BarPicker from '@/components/BarPicker';
import BarVisualTile from '@/components/BarVisualTile';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBarById } from '@/lib/catalog';
import { nycNightKey } from '@/lib/nightKey';
import {
  fetchCircleSuggestions,
  suggestBar,
  unsuggestBar,
  type CircleSuggestion,
} from '@/lib/suggestions.server';
import { fetchCircleRsvps, unrsvpBar } from '@/lib/rsvps.server';
import type { Bar } from '@/types';

type Grouped = {
  bar: Bar;
  suggesters: Array<{ userId: string; isYou: boolean }>;
};

export default function TonightSuggestions(): JSX.Element | null {
  const auth = useAuth();
  const [suggestions, setSuggestions] = useState<CircleSuggestion[] | null>(
    null,
  );
  // Only YOUR stranded RSVP matters here (the escape row) — but the read
  // returns the whole circle; we filter at render.
  const [yourRsvpBarId, setYourRsvpBarId] = useState<string | null>(null);
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
    const userId = auth.user.id;
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
    // RSVP load failure degrades quietly by KEEPING the previous value —
    // a transient read error must not hide (or fake) the escape row.
    if (rsvpRows !== null) {
      setYourRsvpBarId(
        rsvpRows.find((r) => r.userId === userId)?.barId ?? null,
      );
    }
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (auth.status !== 'signed-in') return null;

  const you = auth.user.id;

  const grouped: Grouped[] = [];
  for (const s of suggestions ?? []) {
    const bar = getBarById(s.barId);
    if (!bar) continue; // unknown/retired catalog id — never render
    const existing = grouped.find((g) => g.bar.id === s.barId);
    const suggester = { userId: s.userId, isYou: s.userId === you };
    if (existing) existing.suggesters.push(suggester);
    else grouped.push({ bar, suggesters: [suggester] });
  }
  // Most-backed first.
  grouped.sort((a, b) => b.suggesters.length - a.suggesters.length);
  const ownCount = (suggestions ?? []).filter((s) => s.userId === you).length;
  // With I'm-in gone, ANY of your RSVPs is stranded on this surface — the
  // escape row below is the only way out.
  const strandedRsvpBar =
    yourRsvpBarId !== null ? getBarById(yourRsvpBarId) : null;

  // busy is held THROUGH the refresh in all write handlers (Opus review
  // HIGH): releasing it before the refetch lands re-enables the buttons
  // while derived state is stale, and overlapping refreshes would race
  // each other's setState.
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
            ? 'You can back 3 bars a night — un-vote one to switch.'
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

  const handleRsvpOut = async (barId: string): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await unrsvpBar(supabase, barId, night);
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
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
        People&apos;s Choice
      </h2>

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
          Nobody&apos;s picked a spot yet — find one and your circle sees it
          here.
        </p>
      ) : (
        <ul aria-label="People's Choice" className="space-y-3">
          {grouped.map(({ bar, suggesters }) => {
            const youBack = suggesters.some((s) => s.isYou);
            return (
              <li
                key={bar.id}
                className="bg-surface border border-border rounded-3xl p-3"
              >
                <div className="flex items-center gap-3">
                  <BarVisualTile bar={bar} size={56} />
                  <p className="font-display text-base truncate flex-1 min-w-0">
                    {bar.name}
                  </p>
                  {/* THE VOTE — backing a bar IS the vote. Tally always
                      visible; tapping toggles your backing (your own
                      suggestion off = withdrawing it). */}
                  <button
                    type="button"
                    onClick={() =>
                      void (youBack ? handleRemove(bar.id) : handlePick(bar))
                    }
                    disabled={busy}
                    aria-pressed={youBack}
                    aria-label={`Vote for ${bar.name}`}
                    className={[
                      'shrink-0 font-display text-xs px-3 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 border transition-colors tabular-nums',
                      youBack
                        ? 'bg-accent text-bg border-accent'
                        : 'bg-transparent text-accent border-accent/40 hover:border-accent',
                    ].join(' ')}
                  >
                    ▲ {suggesters.length}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The suggest/search entry lives at the BOTTOM of the board — a
          full-width row, not a header link (operator QA3). */}
      {loadFailed || suggestions === null ? null : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="mt-3 w-full bg-surface border border-border rounded-3xl px-4 py-3 min-h-[44px] touch-manipulation text-accent font-display text-sm hover:border-accent transition-colors disabled:opacity-50"
        >
          + Find a bar
        </button>
      )}

      {strandedRsvpBar ? (
        <div className="mt-3 flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl p-4">
          <p className="text-muted text-xs min-w-0 truncate">
            You&apos;re still in at{' '}
            <span className="text-text">{strandedRsvpBar.name}</span> tonight.
          </p>
          <button
            type="button"
            onClick={() => void handleRsvpOut(strandedRsvpBar.id)}
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
